import { getDb } from "../db/client";
import { loadSettings, saveSetting } from "../db/settings";
import { releaseModel } from "./llm";
import { downloadModel, isModelInstalled, modelPathFor } from "./download";
import { FALLBACK_MODEL_ID, findModel, projectorDescriptor } from "./models";

/**
 * Santé du modèle sur cet appareil.
 *
 * Le 1er novembre, Gemma 4 a échoué sur 40 analyses sur 40 sans que rien ne
 * change : la file avançait, les fiches passaient en erreur, et la nuit était
 * perdue. Désormais, deux échecs « moteur » d'affilée suffisent à déclarer le
 * modèle incompatible avec ce téléphone ; l'application passe alors seule
 * sur Gemma 3 4B — éprouvé, qui voit lui aussi les images — et ne revient
 * jamais d'elle-même vers le modèle en panne.
 */

const BROKEN = "model.broken";
const FAILURES = "model.failures";
const THRESHOLD = 2;

async function read(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

async function write(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function brokenModels(): Promise<string[]> {
  try {
    return JSON.parse((await read(BROKEN)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function recordModelSuccess(modelId: string): Promise<void> {
  if ((await read(`${FAILURES}.${modelId}`)) !== "0") await write(`${FAILURES}.${modelId}`, "0");
}

/**
 * Note un échec du moteur. Renvoie le message à journaliser si l'application
 * vient de basculer sur le modèle de relève, `null` sinon.
 */
export async function recordModelFailure(modelId: string, reason: string): Promise<string | null> {
  const n = Number((await read(`${FAILURES}.${modelId}`)) ?? "0") + 1;
  await write(`${FAILURES}.${modelId}`, String(n));
  if (n < THRESHOLD || modelId === FALLBACK_MODEL_ID) return null;

  const broken = await brokenModels();
  if (!broken.includes(modelId)) await write(BROKEN, JSON.stringify([...broken, modelId]));

  const fallback = findModel(FALLBACK_MODEL_ID);
  if (!fallback) return null;
  await releaseModel();
  await saveSetting("modelId", fallback.id);
  await saveSetting("modelPath", modelPathFor(fallback));
  for (const file of [fallback, projectorDescriptor(fallback)]) {
    if (!file || (await isModelInstalled(file))) continue;
    downloadModel(file, () => {})
      .then((task) => task.promise.catch(() => {}))
      .catch(() => {});
  }
  const failed = findModel(modelId)?.label ?? modelId;
  return `${failed} échoue sur ce téléphone (${reason}) : bascule sur ${fallback.label}, téléchargé si besoin.`;
}

/** Le modèle choisi est-il connu pour échouer ici ? */
export async function currentModelBroken(): Promise<boolean> {
  const { modelId } = await loadSettings();
  return (await brokenModels()).includes(modelId);
}
