import { captureBookmark } from "./capture";
import { generateTags } from "../ai/tagging";
import { generateSummary } from "../ai/summary";
import { isModelInstalled } from "../ai/download";
import { findModel } from "../ai/models";
import { modelPathFor } from "../ai/download";
import {
  getBookmark,
  pendingBookmarks,
  setAiStatus,
  setFetchStatus,
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
 */

export type QueueEvent =
  | { type: "idle" }
  | { type: "fetching"; bookmarkId: string; url: string }
  | { type: "tagging"; bookmarkId: string; url: string }
  | { type: "loading-model"; percent: number }
  | { type: "progress"; done: number; total: number }
  | { type: "bookmark-updated"; bookmarkId: string }
  | { type: "error"; bookmarkId: string; message: string };

type Listener = (event: QueueEvent) => void;

const listeners = new Set<Listener>();
let running = false;
/** Une nouvelle demande arrivée pendant un cycle relance un tour de plus. */
let rerun = false;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: QueueEvent): void {
  for (const l of listeners) l(event);
}

async function runFetchStage(): Promise<number> {
  const batch = await pendingBookmarks("fetch_status", 20);
  let done = 0;

  for (const bookmark of batch) {
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

async function runTagStage(): Promise<number> {
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
    // L'extraction a pu compléter le favori depuis la lecture du lot.
    const bookmark = (await getBookmark(stale.id)) ?? stale;

    // Tant que l'extraction n'a pas abouti, le tagging travaillerait à vide.
    if (bookmark.fetchStatus === "pending" || bookmark.fetchStatus === "running") {
      continue;
    }

    emit({ type: "tagging", bookmarkId: bookmark.id, url: bookmark.url });
    await setAiStatus(bookmark.id, "running");
    try {
      const tags = await generateTags(bookmark, {
        modelPath,
        language: settings.aiLanguage,
        tagStyle: settings.tagStyle,
        onLoadProgress: (percent) =>
          emit({ type: "loading-model", percent }),
      });
      if (tags.length > 0) {
        await attachTags(bookmark.id, tags, "ai");
      }

      // Le résumé suit le tagging : le modèle est déjà chargé en mémoire, la
      // seconde inférence coûte donc bien moins que la première.
      if (bookmark.content && bookmark.content.trim().length > 0) {
        const summary = await generateSummary(
          bookmark.title,
          bookmark.content,
          { modelPath, language: settings.aiLanguage },
        );
        if (summary) await setSummary(bookmark.id, summary);
      }

      await setAiStatus(bookmark.id, "success");
    } catch (err) {
      const message = `Tagging impossible : ${(err as Error).message}`;
      await setAiStatus(bookmark.id, "error", message);
      emit({ type: "error", bookmarkId: bookmark.id, message });
    }
    emit({ type: "bookmark-updated", bookmarkId: bookmark.id });
    done++;
    emit({ type: "progress", done, total: batch.length });
  }
  return done;
}

/**
 * Traite tout ce qui est en attente. Appelable à volonté : les appels
 * concurrents sont fusionnés, un seul cycle tourne à la fois.
 */
export async function processPending(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const settings = await loadSettings();
      const fetched = settings.autoFetch ? await runFetchStage() : 0;
      const tagged = await runTagStage();
      // Rien n'a bougé et rien de neuf n'est arrivé : le cycle est terminé.
      if (fetched === 0 && tagged === 0 && !rerun) break;
    } while (true);
  } finally {
    running = false;
    emit({ type: "idle" });
  }
}

/** Force le retraitement d'un favori (bouton « relancer » de la fiche). */
export async function retryBookmark(id: string): Promise<void> {
  await setFetchStatus(id, "pending");
  await setAiStatus(id, "pending");
  await processPending();
}
