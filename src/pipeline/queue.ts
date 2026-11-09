import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { captureBookmark } from "./capture";
import { connectionKind } from "../ai/download";
import { beat, releaseHeartbeat } from "./lock";
import { isNetworkFailure } from "./retry";
import {
  AI_TIMEOUTS,
  budgetExhausted,
  isReadyForAi,
  shouldSkipSummary,
  type WorkPhase,
} from "./policy";
import { MIN_CONTENT_FOR_SUMMARY, generateSummary } from "../ai/summary";
import { analyseBookmark } from "../ai/classification";
import { assignTheme, isHumanClassified, listThemes } from "../db/themes";
import { isModelInstalled } from "../ai/download";
import { findModel } from "../ai/models";
import { downloadModel, modelPathFor } from "../ai/download";
import {
  clearFetchAttempts,
  deferFetch,
  failFetch,
  promoteDueRetries,
  getBookmark,
  lightlyCaptured,
  pendingBookmarks,
  resetInterruptedWork,
  setAiStatus,
  setFetchStatus,
  setSubject,
  setSummary,
} from "../db/bookmarks";
import { replaceAiTags } from "../db/tags";
import { loadSettings } from "../db/settings";
import { listClassificationExamples } from "../db/examples";
import { withOcr } from "../archive/ocrText";
import { ensureOcr } from "./ocr";
import { ensurePerception } from "./perceive";
import { recordBackgroundRun, recordProgress } from "./heartbeat";
import { recordModelFailure, recordModelSuccess } from "../ai/modelHealth";
import { isOpaqueEngineError } from "../ai/llm";
import { restartSoon } from "../../modules/karakeep-worker/src";
import { projectorDescriptor } from "../ai/models";
import { withPerception } from "../ai/perception";
import { refreshYtdlpWeekly } from "./ytdlpUpdate";
import { saveClassificationMeta } from "../db/verify";
import { embed, embedCached, ensureEmbedderDownloaded } from "../ai/embed";
import { upgradeModelIfNeeded } from "../ai/upgrade";
import { refreshLearnedCriteria } from "./learnCriteria";

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

/** Pannes du moteur d'affilée avant d'arrêter l'analyse (voir `runTagStage`). */
const ENGINE_FAILURE_LIMIT = 3;

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

/** Un cycle tourne-t-il dans ce processus ? */
export function isProcessing(): boolean {
  return running;
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
  // Sans réseau, chaque tentative échouerait et condamnerait le lien. Une
  // séance de nuit en mode avion suffisait à griller la file entière : on
  // s'abstient, et l'étape suivante — entièrement locale — travaille quand
  // même sur ce qui est déjà extrait.
  if ((await connectionKind()) === "none") return 0;
  await refreshYtdlpWeekly();
  await promoteDueRetries();

  const batch = await pendingBookmarks("fetch_status", 20);
  let done = 0;

  for (const bookmark of batch) {
    if (deadline()) break;
    await beat();
    setPhase("fetching", bookmark.id);
    emit({ type: "fetching", bookmarkId: bookmark.id, url: bookmark.url });
    try {
      const outcome = await captureBookmark(bookmark.id, bookmark.url);
      await clearFetchAttempts(bookmark.id);
      for (const note of outcome.notes) {
        emit({ type: "error", bookmarkId: bookmark.id, message: note });
      }
    } catch (err) {
      const message = (err as Error).message;
      // Une coupure réseau laisse le lien en attente ; une page qui répond mal
      // le condamne. Le compteur de tentatives évite qu'un lien réellement
      // mort soit repris indéfiniment.
      if (isNetworkFailure(message)) {
        await deferFetch(bookmark.id, message);
      } else {
        await failFetch(bookmark.id, message);
      }
      emit({ type: "error", bookmarkId: bookmark.id, message });
    }
    emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
    done++;
    emit({ type: "progress", done, total: batch.length });
  }
  return done;
}

async function runTagStage(deadline: () => boolean): Promise<number> {
  // Avant de lire les réglages : le changement de modèle les modifie.
  await upgradeModelIfNeeded();
  const settings = await loadSettings();
  if (!settings.autoTag) return 0;

  const model = findModel(settings.modelId);
  if (!model || !(await isModelInstalled(model))) {
    // Modèle pas encore là (téléchargement en cours, relève qui arrive) : les
    // liens restent en attente. Les marquer « sautés » les faisait sortir de
    // la file, et il fallait ensuite tout relancer à la main.
    if (model) {
      downloadModel(model, () => {})
        .then((task) => task.promise.catch(() => {}))
        .catch(() => {});
    }
    await recordBackgroundRun(
      `Analyse reportée : le modèle ${model?.label ?? settings.modelId} n'est pas encore téléchargé.`,
    );
    return 0;
  }

  void ensureEmbedderDownloaded();

  // Un modèle qui sait regarder et écouter, mais dont le projecteur n'est
  // pas encore téléchargé, rangerait à l'aveugle — c'est exactement ce qui a
  // mis des bons plans Amazon dans « Desserts ». On attend qu'il soit là.
  const projector = projectorDescriptor(model);
  if (projector && !(await isModelInstalled(projector))) {
    await recordBackgroundRun(
      "Analyse reportée : la partie « vision et son » du modèle n'est pas encore téléchargée.",
    );
    downloadModel(projector, () => {})
      .then((task) => task.promise.catch(() => {}))
      .catch(() => {});
    return 0;
  }

  const modelPath = modelPathFor(model);
  // Les critères appris d'abord : les liens rangés juste après en profitent.
  await refreshLearnedCriteria(modelPath, deadline).catch(() => 0);
  const batch = await pendingBookmarks("ai_status", 10);
  let done = 0;
  // Pannes du moteur d'affilée. Une panne qui touche tous les liens n'est pas
  // la faute des liens : après trois, on s'arrête et ils restent en file,
  // au lieu de passer tous en erreur en quelques secondes comme le 2
  // novembre.
  let engineFailures = 0;

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
      // Ce que disent la légende, le texte des images, et — si le modèle sait
      // regarder et écouter — ce que montrent les photos et la vidéo.
      const perception = await ensurePerception(bookmark, model, AI_TIMEOUTS.perception).catch(
        async (err: Error) => {
          // Visible dans le journal : sans cela, une vision en panne passait
          // pour une analyse normale, rangée à l'aveugle.
          await recordBackgroundRun(`Vision et son impossibles : ${err.message}`);
          return null;
        },
      );
      const enriched = withPerception(
        withOcr(bookmark.content, await ensureOcr(bookmark.id).catch(() => null)),
        perception,
      );
      const themes = await listThemes();
      const analysis = await analyseBookmark(
        themes.map((t) => ({
          id: t.id,
          name: t.name,
          // La consigne écrite par l'utilisateur suit jusqu'au prompt : sans
          // elle, le modèle ne dispose que d'un intitulé ambigu. Les critères
          // appris de ses rangements la complètent.
          description: t.description,
          learnedCriteria: t.learnedCriteria ?? null,
          subthemes: t.subthemes.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            learnedCriteria: s.learnedCriteria ?? null,
          })),
        })),
        {
          title: bookmark.title,
          description: bookmark.description,
          content: enriched,
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
          examples: await listClassificationExamples(bookmark.id),
          embed: (key, text) => (key ? embedCached(key, text) : embed(text)),
        },
      );

      if (analysis.digest?.subject) {
        await setSubject(bookmark.id, analysis.digest.subject);
      }

      // Les mots-clés de l'analyse deviennent les tags : ils disent ce que le
      // modèle a compris du document, et c'est à cela seul que les tags
      // servent ici — aider au rangement, puis se relire.
      if (analysis.digest && analysis.digest.keywords.length > 0) {
        await replaceAiTags(bookmark.id, analysis.digest.keywords);
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
      // La certitude décide de ce qui sera montré le matin : sans elle, tout
      // serait soit à vérifier, soit invisible.
      await saveClassificationMeta(bookmark.id, {
        confidence: analysis.confidence,
        alternatives: analysis.alternatives,
        suggestion: analysis.suggestion,
      });
      emit({ type: "bookmark-updated", bookmarkId: bookmark.id });

      await beat();
      // Le résumé en dernier : c'est la réponse la plus longue à produire,
      // donc la seule qu'on puisse sacrifier sans perdre l'essentiel.
      const content = enriched ?? "";
      const elapsed = Date.now() - startedAt;
      const worthSummarising =
        content.trim().length >= MIN_CONTENT_FOR_SUMMARY &&
        !shouldSkipSummary(elapsed);

      let summary: string | null = null;
      if (worthSummarising) {
        summary = await generateSummary(bookmark.title, content, {
          modelPath,
          language: settings.aiLanguage,
          timeoutMs: AI_TIMEOUTS.summary,
          onToken: (n) =>
            emit({ type: "generating", step: "summary", tokens: n }),
        }).catch((err: Error) => {
          // Le rangement est fait : un résumé trop long à écrire ne le
          // remet pas en cause. La phrase de l'étape « de quoi ça parle »
          // le remplace.
          if (err.name === "InferenceTimeoutError") return null;
          throw err;
        });
      }
      // Sur une publication courte, il n'y a rien à condenser — mais la phrase
      // produite par l'étape de compréhension dit déjà de quoi il s'agit.
      // Laisser la fiche sans résumé était un manque, pas une décision.
      if (!summary && analysis.digest?.subject) {
        summary = analysis.digest.subject;
      }
      if (summary) await setSummary(bookmark.id, summary);

      await setAiStatus(bookmark.id, "success");
      await recordModelSuccess(model.id);
      engineFailures = 0;
    } catch (err) {
      if ((err as Error).name === "EngineWedgedError") {
        await setAiStatus(bookmark.id, "pending");
        await recordBackgroundRun(`${(err as Error).message} Redémarrage de l'application, la séance reprend dans 2 min.`);
        restartSoon();
        break;
      }
      if ((err as Error).name !== "ModelIncompatibleError" && isOpaqueEngineError(err)) {
        await setAiStatus(bookmark.id, "pending");
        engineFailures++;
        if (engineFailures >= ENGINE_FAILURE_LIMIT) {
          await recordBackgroundRun(
            `Moteur IA en panne ${engineFailures} fois de suite (${(err as Error).message}) : analyse arrêtée pour cette séance, les liens restent en file.`,
          );
          break;
        }
        continue;
      }
      if ((err as Error).name === "ModelIncompatibleError") {
        // Ce n'est pas la faute du lien : il repassera avec un modèle qui
        // fonctionne. Au deuxième échec, on change de modèle et on s'arrête
        // là pour cette séance — le nouveau doit d'abord être chargé.
        await setAiStatus(bookmark.id, "pending");
        const switched = await recordModelFailure(model.id, (err as Error).message);
        await recordBackgroundRun(switched ?? `Échec du moteur avec ${model.label} : ${(err as Error).message}`);
        if (switched || ++engineFailures >= ENGINE_FAILURE_LIMIT) break;
        continue;
      }
      // Le rangement et les tags déjà obtenus sont conservés : l'échec d'une
      // étape ne doit pas effacer celles qui ont abouti.
      const message = `Analyse incomplète : ${(err as Error).message}`;
      await setAiStatus(bookmark.id, "error", message);
      emit({ type: "error", bookmarkId: bookmark.id, message });
    }
    emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
    done++;
    emit({ type: "progress", done, total: batch.length });
    // Une ligne de suivi, remplacée à chaque lien : la nuit se lit d'un coup
    // d'œil dans le journal, sans en chasser le reste.
    await recordProgress(
      `Analyse en cours : ${done} lien(s) traité(s) cette séance, le dernier en ${Math.round((Date.now() - startedAt) / 60_000)} min.`,
    );
  }
  return done;
}

/**
 * Reprend les pages lues sans moteur de rendu maintenant qu'il y en a un.
 *
 * Le travail d'arrière-plan rend la fiche exploitable tout de suite, ce qui
 * est l'essentiel ; il lui manque la capture d'écran et l'archive autonome —
 * c'est-à-dire justement ce qui survit à la disparition du site. On les
 * complète dès qu'une session avec interface le permet, quelques-unes à la
 * fois pour ne pas monopoliser l'application au démarrage.
 */
async function runUpgradeStage(deadline: () => boolean): Promise<number> {
  const batch = await lightlyCaptured(3);
  let done = 0;
  for (const bookmark of batch) {
    if (deadline()) break;
    await beat();
    setPhase("fetching", bookmark.id);
    try {
      await captureBookmark(bookmark.id, bookmark.url);
      emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
      done++;
    } catch {
      // La version allégée reste en place : une reprise ratée ne doit pas
      // dégrader une fiche déjà utilisable.
    }
  }
  return done;
}

export interface ProcessOptions {
  /**
   * Cycle déclenché par le système, sans interface montée.
   *
   * L'extraction se fait alors sans moteur de rendu : moins fidèle, mais elle
   * a lieu. Auparavant ce mode n'exécutait que l'étape IA, laquelle refuse de
   * travailler sur une extraction inachevée — un lien enregistré puis jamais
   * rouvert ne pouvait donc jamais avancer.
   */
  headless?: boolean;
  /** Temps maximal accordé au cycle, pour tenir dans une fenêtre système. */
  budgetMs?: number;
  /**
   * Faire tourner le modèle d'IA. Faux par défaut : décision du 31 octobre,
   * l'analyse ne tourne QUE la nuit, téléphone sur secteur — elle vide la
   * batterie en une heure. Le jour, ouvrir l'application, partager un lien
   * ou un passage programmé ne font que lire les pages.
   */
  analyse?: boolean;
  /**
   * Interrompt l'analyse (pas la lecture des pages) dès qu'il répond vrai —
   * en pratique, quand le téléphone est débranché en pleine nuit.
   */
  stopAnalysis?: () => boolean;
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
  const keepAwake = !opts.headless;
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
      const fetched = settings.autoFetch ? await runFetchStage(deadline) : 0;
      const tagged = opts.analyse
        ? await runTagStage(() => deadline() || (opts.stopAnalysis?.() ?? false))
        : 0;
      // Les reprises passent en dernier : elles améliorent l'existant, alors
      // que les deux étapes précédentes débloquent des liens en attente.
      const upgraded =
        !opts.headless && fetched === 0 && tagged === 0
          ? await runUpgradeStage(deadline)
          : 0;
      if (deadline()) break;
      // Rien n'a bougé et rien de neuf n'est arrivé : le cycle est terminé.
      if (fetched === 0 && tagged === 0 && upgraded === 0 && !rerun) break;
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
