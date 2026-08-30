import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { captureBookmark } from "./capture";
import { beat, releaseHeartbeat } from "./lock";
import {
  AI_TIMEOUTS,
  budgetExhausted,
  isReadyForAi,
  shouldSkipSummary,
  type WorkPhase,
} from "./policy";
import { generateSummary } from "../ai/summary";
import { analyseBookmark } from "../ai/classification";
import { assignTheme, isHumanClassified, listThemes } from "../db/themes";
import { isModelInstalled } from "../ai/download";
import { findModel } from "../ai/models";
import { modelPathFor } from "../ai/download";
import {
  getBookmark,
  pendingBookmarks,
  resetInterruptedWork,
  setAiStatus,
  setFetchStatus,
  setSubject,
  setSummary,
} from "../db/bookmarks";
import { attachTags } from "../db/tags";
import { loadSettings } from "../db/settings";

/**
 * File de traitement d'arrière-plan.
 *
 * Karakeep confie ce travail à des workers serveur alimentés par une file
 * persistante. Ici tout se passe dans le processus de l'application : la file
 * est l'ensemble des favoris dont `fetch_status` ou `ai_status` vaut 'pending',
 * ce qui la rend naturellement reprenable après une fermeture de l'app.
 *
 * Deux points de contact avec le système la font vraiment avancer :
 * `QueueRunner` la relance à chaque retour au premier plan, et une tâche
 * WorkManager (voir `background.ts`) la reprend application fermée.
 */

export type QueueEvent =
  | { type: "idle" }
  | { type: "fetching"; bookmarkId: string; url: string }
  | { type: "tagging"; bookmarkId: string; url: string }
  | { type: "loading-model"; percent: number }
  /** Le modèle écrit : la seule preuve de vie pendant une longue inférence. */
  | { type: "generating"; step: AiStep; tokens: number }
  | { type: "progress"; done: number; total: number }
  | { type: "bookmark-updated"; bookmarkId: string }
  | { type: "error"; bookmarkId: string; message: string };

/** Les demandes faites au modèle pour un même favori. */
export type AiStep = "digest" | "theme" | "subtheme" | "summary";

type Listener = (event: QueueEvent) => void;

const KEEP_AWAKE_TAG = "karakeep-queue";

const listeners = new Set<Listener>();
let running = false;
/** Une nouvelle demande arrivée pendant un cycle relance un tour de plus. */
let rerun = false;

/** Ce que la file fait à l'instant, pour que l'interface cesse de deviner. */
let phase: WorkPhase = "idle";
let currentId: string | null = null;

export interface QueueState {
  phase: WorkPhase;
  /** Favori en cours de traitement, s'il y en a un. */
  bookmarkId: string | null;
}

export function queueState(): QueueState {
  return { phase, bookmarkId: currentId };
}

function setPhase(next: WorkPhase, bookmarkId: string | null): void {
  phase = next;
  currentId = bookmarkId;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: QueueEvent): void {
  for (const l of listeners) l(event);
}

/**
 * Les lignes laissées en `running` par un arrêt brutal repassent en attente,
 * une seule fois par processus.
 */
let recovered = false;
async function recoverOnce(): Promise<void> {
  if (recovered) return;
  recovered = true;
  try {
    await resetInterruptedWork();
  } catch {
    // Une base momentanément indisponible ne doit pas empêcher le cycle : la
    // récupération sera retentée au prochain démarrage.
    recovered = false;
  }
}

async function runFetchStage(deadline: () => boolean): Promise<number> {
  const batch = await pendingBookmarks("fetch_status", 20);
  let done = 0;

  for (const bookmark of batch) {
    if (deadline()) break;
    await beat();
    setPhase("fetching", bookmark.id);
    emit({ type: "fetching", bookmarkId: bookmark.id, url: bookmark.url });
    try {
      const outcome = await captureBookmark(bookmark.id, bookmark.url);
      for (const note of outcome.notes) {
        emit({ type: "error", bookmarkId: bookmark.id, message: note });
      }
    } catch (err) {
      const message = (err as Error).message;
      await setFetchStatus(bookmark.id, "error", message);
      emit({ type: "error", bookmarkId: bookmark.id, message });
    }
    emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
    done++;
    emit({ type: "progress", done, total: batch.length });
  }
  return done;
}

async function runTagStage(deadline: () => boolean): Promise<number> {
  const settings = await loadSettings();
  if (!settings.autoTag) return 0;

  const model = findModel(settings.modelId);
  if (!model || !(await isModelInstalled(model))) {
    // Aucun modèle installé : on marque les favoris comme non traités plutôt
    // que de les laisser en 'pending' et de rejouer indéfiniment.
    const batch = await pendingBookmarks("ai_status", 50);
    for (const b of batch) {
      await setAiStatus(b.id, "skipped", "Aucun modèle installé");
    }
    return 0;
  }

  const modelPath = modelPathFor(model);
  const batch = await pendingBookmarks("ai_status", 10);
  let done = 0;

  for (const stale of batch) {
    if (deadline()) break;

    // L'extraction a pu compléter le favori depuis la lecture du lot.
    const bookmark = (await getBookmark(stale.id)) ?? stale;
    if (!isReadyForAi(bookmark.fetchStatus)) continue;

    await beat();
    setPhase("tagging", bookmark.id);
    emit({ type: "tagging", bookmarkId: bookmark.id, url: bookmark.url });
    await setAiStatus(bookmark.id, "running");

    const startedAt = Date.now();
    const onLoadProgress = (percent: number) =>
      emit({ type: "loading-model", percent });

    try {
      // Comprendre, puis ranger — trois demandes courtes au lieu d'une seule
      // question à vingt et une options. Le rangement est ce que
      // l'utilisateur vient chercher : il passe avant le résumé, qui ne
      // s'exécute que s'il reste du temps.
      const themes = await listThemes();
      const analysis = await analyseBookmark(
        themes.map((t) => ({
          id: t.id,
          name: t.name,
          // La consigne écrite par l'utilisateur suit jusqu'au prompt : sans
          // elle, le modèle ne dispose que d'un intitulé ambigu.
          description: t.description,
          subthemes: t.subthemes.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
        })),
        {
          title: bookmark.title,
          description: bookmark.description,
          content: bookmark.content,
          url: bookmark.url,
          language: settings.aiLanguage,
          tagStyle: settings.tagStyle,
        },
        {
          modelPath,
          digestTimeoutMs: AI_TIMEOUTS.digest,
          choiceTimeoutMs: AI_TIMEOUTS.choice,
          onToken: (step, produced) =>
            emit({ type: "generating", step, tokens: produced }),
          onLoadProgress,
        },
      );

      if (analysis.digest?.subject) {
        await setSubject(bookmark.id, analysis.digest.subject);
      }

      // Les mots-clés de l'analyse deviennent les tags : ils disent ce que le
      // modèle a compris du document, et c'est à cela seul que les tags
      // servent ici — aider au rangement, puis se relire.
      if (analysis.digest && analysis.digest.keywords.length > 0) {
        await attachTags(bookmark.id, analysis.digest.keywords, "ai");
      }

      // Un rangement corrigé à la main n'est jamais défait par le modèle.
      if (analysis.themeId && !(await isHumanClassified(bookmark.id))) {
        await assignTheme(
          bookmark.id,
          analysis.themeId,
          analysis.subthemeId,
          "ai",
        );
      }
      emit({ type: "bookmark-updated", bookmarkId: bookmark.id });

      await beat();
      // Le résumé en dernier : c'est la réponse la plus longue à produire,
      // donc la seule qu'on puisse sacrifier sans perdre l'essentiel.
      const elapsed = Date.now() - startedAt;
      if (
        bookmark.content &&
        bookmark.content.trim().length > 0 &&
        !shouldSkipSummary(elapsed)
      ) {
        const summary = await generateSummary(bookmark.title, bookmark.content, {
          modelPath,
          language: settings.aiLanguage,
          timeoutMs: AI_TIMEOUTS.summary,
          onToken: (n) =>
            emit({ type: "generating", step: "summary", tokens: n }),
        });
        if (summary) await setSummary(bookmark.id, summary);
      }

      await setAiStatus(bookmark.id, "success");
    } catch (err) {
      // Le rangement et les tags déjà obtenus sont conservés : l'échec d'une
      // étape ne doit pas effacer celles qui ont abouti.
      const message = `Analyse incomplète : ${(err as Error).message}`;
      await setAiStatus(bookmark.id, "error", message);
      emit({ type: "error", bookmarkId: bookmark.id, message });
    }
    emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
    done++;
    emit({ type: "progress", done, total: batch.length });
  }
  return done;
}

export interface ProcessOptions {
  /**
   * N'exécuter que l'étape IA. C'est le seul choix possible hors interface :
   * l'extraction a besoin de la WebView de `WebArchiver`, qui n'existe que
   * dans un arbre React monté.
   */
  aiOnly?: boolean;
  /** Temps maximal accordé au cycle, pour tenir dans une fenêtre système. */
  budgetMs?: number;
}

/**
 * Traite tout ce qui est en attente. Appelable à volonté : les appels
 * concurrents sont fusionnés, un seul cycle tourne à la fois.
 */
export async function processPending(opts: ProcessOptions = {}): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;

  const startedAt = Date.now();
  const deadline = () =>
    opts.budgetMs !== undefined &&
    budgetExhausted(startedAt, Date.now(), opts.budgetMs);

  // Une inférence dure des dizaines de secondes : sans cela, l'écran s'éteint
  // au milieu et Android suspend le fil JavaScript. Hors interface, il n'y a
  // pas d'activité à maintenir éveillée.
  const keepAwake = !opts.aiOnly;
  if (keepAwake) {
    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } catch {
      // Rien de bloquant : le traitement peut simplement être interrompu par
      // la mise en veille, et il reprendra au réveil.
    }
  }

  try {
    await recoverOnce();
    do {
      rerun = false;
      const settings = await loadSettings();
      const fetched =
        !opts.aiOnly && settings.autoFetch ? await runFetchStage(deadline) : 0;
      const tagged = await runTagStage(deadline);
      if (deadline()) break;
      // Rien n'a bougé et rien de neuf n'est arrivé : le cycle est terminé.
      if (fetched === 0 && tagged === 0 && !rerun) break;
    } while (true);
  } finally {
    running = false;
    setPhase("idle", null);
    await releaseHeartbeat();
    if (keepAwake) {
      // La promesse est rejetée si le verrou a déjà été relâché : sans le
      // `catch`, ce rejet non traité remonterait jusqu'à l'écran rouge.
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
    emit({ type: "idle" });
  }
}

/** Force le retraitement d'un favori (bouton « relancer » de la fiche). */
export async function retryBookmark(id: string): Promise<void> {
  await setFetchStatus(id, "pending");
  await setAiStatus(id, "pending");
  await processPending();
}

/** Relance la seule étape IA d'un favori déjà extrait. */
export async function retryAi(id: string): Promise<void> {
  await setAiStatus(id, "pending");
  await processPending();
}
