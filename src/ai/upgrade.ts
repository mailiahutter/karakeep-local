import { releaseModel } from "./llm";
import {
  connectionKind,
  deleteModel,
  downloadModel,
  isModelInstalled,
  modelPathFor,
} from "./download";
import { RECOMMENDED_MODEL_ID, SUPERSEDED_MODEL_IDS, findModel } from "./models";
import { loadSettings, saveSetting } from "../db/settings";

/**
 * Passage automatique au modèle recommandé.
 *
 * Demande du 21 octobre : « il faut une IA plus puissante ». L'utilisateur
 * n'ouvre presque jamais l'application ; attendre qu'il aille dans les
 * réglages, c'était ne jamais changer. Si l'ancien modèle par défaut est en
 * service, le nouveau se télécharge seul en Wi-Fi (le gestionnaire système
 * poursuit application fermée), puis prend le relais dès qu'il est complet.
 * L'ancien est alors effacé pour libérer ses deux gigaoctets.
 *
 * Un modèle choisi exprès par l'utilisateur (autre que l'ancien défaut)
 * n'est jamais remplacé.
 */
export async function upgradeModelIfNeeded(): Promise<void> {
  try {
    const settings = await loadSettings();
    if (!SUPERSEDED_MODEL_IDS.includes(settings.modelId)) return;
    const target = findModel(RECOMMENDED_MODEL_ID);
    if (!target) return;

    if (await isModelInstalled(target)) {
      const old = findModel(settings.modelId);
      await releaseModel();
      await saveSetting("modelId", target.id);
      await saveSetting("modelPath", modelPathFor(target));
      if (old) await deleteModel(old).catch(() => {});
      return;
    }
    if ((await connectionKind()) !== "wifi") return;
    const task = await downloadModel(target, () => {});
    task.promise.catch(() => {});
  } catch {
    // Retenté au prochain cycle.
  }
}
