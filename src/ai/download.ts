import * as FileSystem from "expo-file-system/legacy";

import type { ModelDescriptor } from "./models";

/**
 * Les modèles vivent dans le répertoire documents : contrairement au cache, il
 * n'est pas vidé par Android sous pression de stockage — on ne veut pas
 * retélécharger 1,8 Go sans prévenir.
 */
const MODEL_DIR = `${FileSystem.documentDirectory}models/`;

export function modelPathFor(model: ModelDescriptor): string {
  return `${MODEL_DIR}${model.fileName}`;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
}

export interface DownloadProgress {
  /** Entre 0 et 1, ou null si le serveur n'annonce pas la taille. */
  ratio: number | null;
  written: number;
  total: number;
}

export interface ModelDownload {
  promise: Promise<string>;
  cancel: () => Promise<void>;
}

/**
 * Vérifie qu'un modèle est déjà présent et complet.
 *
 * La taille attendue sert de contrôle d'intégrité minimal : un téléchargement
 * interrompu laisse un fichier tronqué que llama.cpp refuserait avec une erreur
 * peu parlante.
 */
export async function isModelInstalled(
  model: ModelDescriptor,
): Promise<boolean> {
  const path = modelPathFor(model);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory) return false;

  // Exiger la taille exacte du catalogue rendait le modèle « absent » pour un
  // octet d'écart — et le tagging échouait alors en silence, définitivement.
  // Une tolérance couvre les rebuilds amont ; l'entête GGUF garantit qu'il
  // s'agit bien d'un modèle et non d'un téléchargement tronqué.
  if (info.size < model.bytes * 0.9) return false;

  try {
    const head = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 4,
    });
    // "GGUF" encodé en base64.
    return head.startsWith("R0dVRg");
  } catch {
    // Illisible : mieux vaut tenter le chargement que déclarer le modèle absent.
    return true;
  }
}

export async function deleteModel(model: ModelDescriptor): Promise<void> {
  await FileSystem.deleteAsync(modelPathFor(model), { idempotent: true });
}

/**
 * Télécharge un modèle. L'appelant peut annuler ; le fichier partiel est alors
 * effacé pour ne pas laisser un modèle inutilisable qui passerait le test de
 * présence.
 */
export function downloadModel(
  model: ModelDescriptor,
  onProgress: (p: DownloadProgress) => void,
): ModelDownload {
  const target = modelPathFor(model);
  let cancelled = false;

  const resumable = FileSystem.createDownloadResumable(
    model.url,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total =
        totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : model.bytes;
      onProgress({
        ratio: total > 0 ? totalBytesWritten / total : null,
        written: totalBytesWritten,
        total,
      });
    },
  );

  const promise = (async () => {
    await ensureDir();
    const result = await resumable.downloadAsync();
    if (cancelled) throw new Error("Téléchargement annulé");
    if (!result) throw new Error("Téléchargement interrompu");

    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists || info.isDirectory || info.size !== model.bytes) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw new Error(
        `Fichier incomplet : ${info.exists && !info.isDirectory ? info.size : 0} octets reçus sur ${model.bytes} attendus.`,
      );
    }
    return target;
  })();

  return {
    promise,
    cancel: async () => {
      cancelled = true;
      try {
        await resumable.cancelAsync();
      } finally {
        await FileSystem.deleteAsync(target, { idempotent: true });
      }
    },
  };
}
