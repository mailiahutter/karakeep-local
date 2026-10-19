import { initLlama, type LlamaContext } from "llama.rn";

import { connectionKind, downloadModel, isModelInstalled, modelPathFor } from "./download";
import type { ModelDescriptor } from "./models";
import { readEmbedding, writeEmbedding } from "../db/embeddings";
import { textHash } from "./textHash";

/**
 * Modèle de proximité de sens.
 *
 * Il ne rédige rien : il transforme un texte en une liste de nombres, et deux
 * textes qui parlent de la même chose — dans n'importe quelle langue —
 * donnent des listes voisines. C'est exactement ce qu'il faut pour écarter
 * d'emblée les thèmes sans rapport, et c'est cent fois plus rapide qu'une
 * question posée au modèle de langage.
 *
 * EmbeddingGemma (Google, 300 millions de paramètres, plus de cent langues),
 * dans la conversion officielle de ggml-org. Facultatif : sans lui, le
 * classement fonctionne comme avant.
 */
export const EMBEDDING_MODEL: ModelDescriptor = {
  id: "embeddinggemma-300m-q8",
  label: "EmbeddingGemma 300M",
  bytes: 333_590_944,
  ramHint: "4 Go",
  speedHint: "moins d'une seconde par lien",
  url: "https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf",
  fileName: "embeddinggemma-300M-Q8_0.gguf",
  notes:
    "Compare le sens de chaque lien à celui de tes thèmes, toutes langues confondues, pour ne soumettre au modèle principal que les plus proches.",
};

/** Consigne attendue par EmbeddingGemma pour une tâche de classement. */
const PREFIX = "task: classification | query: ";

/** Au-delà, le texte n'apporte plus rien au sens global et ralentit. */
const MAX_CHARS = 1500;

const IDLE_RELEASE_MS = 3 * 60 * 1000;

let ctx: LlamaContext | null = null;
let loading: Promise<LlamaContext> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void releaseEmbedder(), IDLE_RELEASE_MS);
}

export async function releaseEmbedder(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const current = ctx;
  ctx = null;
  if (current) await current.release().catch(() => {});
}

export async function isEmbedderInstalled(): Promise<boolean> {
  return isModelInstalled(EMBEDDING_MODEL);
}

async function context(): Promise<LlamaContext> {
  if (ctx) return ctx;
  loading ??= initLlama({
    model: modelPathFor(EMBEDDING_MODEL),
    embedding: true,
    pooling_type: "mean",
    n_ctx: 1024,
    n_gpu_layers: 0,
    n_threads: 4,
    use_mlock: false,
  })
    .then((c) => {
      ctx = c;
      loading = null;
      return c;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** Vecteur de sens d'un texte, ou `null` si le modèle est absent. */
export async function embed(text: string): Promise<number[] | null> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean || !(await isEmbedderInstalled())) return null;
  const c = await context();
  try {
    const result = await c.embedding(PREFIX + clean, { embd_normalize: 2 });
    return result.embedding.length > 0 ? result.embedding : null;
  } finally {
    scheduleRelease();
  }
}

/**
 * Même chose, avec mise en cache : un thème ou un exemple ne change pas d'un
 * lien à l'autre, inutile de le recalculer.
 */
export async function embedCached(key: string, text: string): Promise<number[] | null> {
  const hash = textHash(`${EMBEDDING_MODEL.id}\n${text}`);
  const cached = await readEmbedding(key, hash);
  if (cached) return cached;
  const vector = await embed(text);
  if (vector) await writeEmbedding(key, EMBEDDING_MODEL.id, hash, vector);
  return vector;
}

/**
 * Lance le téléchargement du modèle de proximité s'il manque, en Wi-Fi
 * seulement. L'utilisateur n'ouvre pas l'application : on n'attend pas qu'il
 * appuie sur un bouton. Le gestionnaire système poursuit application fermée,
 * et ne double jamais un transfert déjà en cours.
 */
export async function ensureEmbedderDownloaded(): Promise<void> {
  try {
    if (await isEmbedderInstalled()) return;
    if ((await connectionKind()) !== "wifi") return;
    const task = await downloadModel(EMBEDDING_MODEL, () => {});
    task.promise.catch(() => {});
  } catch {
    // Réessayé au prochain cycle.
  }
}
