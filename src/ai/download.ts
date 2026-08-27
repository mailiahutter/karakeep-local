import * as FileSystem from "expo-file-system/legacy";
import * as KeepAwake from "expo-keep-awake";
import * as Network from "expo-network";

import { getDb } from "../db/client";
import type { ModelDescriptor } from "./models";

/**
 * Téléchargement et vérification des modèles.
 *
 * Un modèle pèse plusieurs gigaoctets : le transfert doit survivre à une
 * coupure, ne pas dévorer un forfait mobile, et ne jamais effacer ce qui est
 * déjà acquis sur un simple écart de taille.
 */

/**
 * Les modèles vivent dans le répertoire documents — jamais le cache, qu'Android
 * vide sous pression de stockage.
 */
const MODEL_DIR = `${FileSystem.documentDirectory}models/`;

/** Clé de reprise conservée en base, pour repartir d'où la coupure a eu lieu. */
const RESUME_KEY = (modelId: string) => `download.resume.${modelId}`;

export function modelPathFor(model: ModelDescriptor): string {
  return `${MODEL_DIR}${model.fileName}`;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
}

async function readResume(modelId: string): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [RESUME_KEY(modelId)],
  );
  return row?.value || undefined;
}

async function writeResume(
  modelId: string,
  data: string | null,
): Promise<void> {
  const db = await getDb();
  if (data === null) {
    await db.runAsync("DELETE FROM settings WHERE key = ?", [
      RESUME_KEY(modelId),
    ]);
    return;
  }
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [RESUME_KEY(modelId), data],
  );
}

/**
 * Un fichier GGUF commence par ces quatre octets. Contrôle bien plus sûr
 * qu'une comparaison de taille : il distingue un modèle valide d'un
 * téléchargement tronqué ou d'une page d'erreur enregistrée par méprise.
 */
async function hasGgufHeader(path: string): Promise<boolean> {
  try {
    const head = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 4,
    });
    return head.startsWith("R0dVRg"); // "GGUF" en base64
  } catch {
    return false;
  }
}

/**
 * Le modèle est-il présent et exploitable ?
 *
 * La taille du catalogue n'est qu'un ordre de grandeur : elle peut différer de
 * quelques centaines d'octets d'une reconstruction à l'autre en amont. Exiger
 * l'égalité stricte rendait un modèle parfaitement valide « absent ».
 */
export async function isModelInstalled(
  model: ModelDescriptor,
): Promise<boolean> {
  const path = modelPathFor(model);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory) return false;
  if (info.size < model.bytes * 0.98) return false;
  return hasGgufHeader(path);
}

export async function deleteModel(model: ModelDescriptor): Promise<void> {
  await FileSystem.deleteAsync(modelPathFor(model), { idempotent: true });
  await writeResume(model.id, null);
}

/** Octets déjà acquis d'un téléchargement interrompu. */
export async function partialBytes(model: ModelDescriptor): Promise<number> {
  const info = await FileSystem.getInfoAsync(modelPathFor(model));
  return info.exists && !info.isDirectory ? info.size : 0;
}

export interface DownloadProgress {
  /** Entre 0 et 1, ou null si la taille totale est inconnue. */
  ratio: number | null;
  written: number;
  total: number;
  /** Vrai si le transfert a repris là où il s'était arrêté. */
  resumed: boolean;
}

export interface ModelDownload {
  promise: Promise<string>;
  /** Interrompt en conservant l'acquis : la reprise repartira de là. */
  pause: () => Promise<void>;
  /** Abandonne et efface le fichier partiel. */
  cancel: () => Promise<void>;
}

export type ConnectionKind = "wifi" | "cellular" | "other" | "none";

export async function connectionKind(): Promise<ConnectionKind> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected) return "none";
    if (state.type === Network.NetworkStateType.WIFI) return "wifi";
    if (state.type === Network.NetworkStateType.CELLULAR) return "cellular";
    return "other";
  } catch {
    return "other";
  }
}

export class CellularBlockedError extends Error {
  constructor() {
    super(
      "Téléchargement bloqué en données mobiles. Un modèle pèse plusieurs " +
        "gigaoctets : passe en Wi-Fi, ou autorise explicitement les données mobiles.",
    );
    this.name = "CellularBlockedError";
  }
}

/**
 * Télécharge un modèle, en reprenant un transfert interrompu si possible.
 *
 * `allowCellular` reste explicite et jamais implicite : plusieurs gigaoctets,
 * c'est un forfait mobile entier.
 */
export function downloadModel(
  model: ModelDescriptor,
  onProgress: (p: DownloadProgress) => void,
  opts: { allowCellular?: boolean } = {},
): ModelDownload {
  const target = modelPathFor(model);
  let resumable: FileSystem.DownloadResumable | null = null;
  let abandoned = false;

  const promise = (async () => {
    const connection = await connectionKind();
    if (connection === "none") throw new Error("Aucune connexion réseau.");
    if (connection === "cellular" && !opts.allowCellular) {
      throw new CellularBlockedError();
    }

    await ensureDir();

    // Un fichier déjà complet et valide n'a pas à être retéléchargé.
    if (await isModelInstalled(model)) {
      await writeResume(model.id, null);
      return target;
    }

    const resumeData = await readResume(model.id);
    const already = await partialBytes(model);

    // Empêche Android d'endormir le processus pendant le transfert : une mise
    // en veille prolongée l'interromprait.
    KeepAwake.activateKeepAwakeAsync("model-download").catch(() => {});

    try {
      resumable = FileSystem.createDownloadResumable(
        model.url,
        target,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          const total =
            totalBytesExpectedToWrite > 0
              ? totalBytesExpectedToWrite
              : model.bytes;
          onProgress({
            ratio: total > 0 ? totalBytesWritten / total : null,
            written: totalBytesWritten,
            total,
            resumed: already > 0,
          });
        },
        resumeData,
      );

      const result = resumeData
        ? await resumable.resumeAsync()
        : await resumable.downloadAsync();

      if (abandoned) throw new Error("Téléchargement annulé");
      if (!result) throw new Error("Téléchargement interrompu");

      const info = await FileSystem.getInfoAsync(target);
      const size = info.exists && !info.isDirectory ? info.size : 0;

      // Ce qui n'est pas un GGUF ne sera jamais exploitable : page d'erreur,
      // portail captif… là, effacer est justifié.
      if (!(await hasGgufHeader(target))) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        await writeResume(model.id, null);
        throw new Error(
          "Le fichier reçu n'est pas un modèle GGUF valide. Le téléchargement a probablement été intercepté par un portail réseau.",
        );
      }

      // Incomplet : on CONSERVE l'acquis. Effacer plusieurs gigaoctets pour
      // quelques octets manquants était le défaut le plus coûteux de la
      // version précédente.
      if (size < model.bytes * 0.98) {
        throw new Error(
          `Téléchargement incomplet : ${Math.round((size / model.bytes) * 100)} % reçus. Relance pour reprendre où ça s'est arrêté.`,
        );
      }

      await writeResume(model.id, null);
      return target;
    } finally {
      KeepAwake.deactivateKeepAwake("model-download");
    }
  })();

  return {
    promise,
    pause: async () => {
      try {
        const data = await resumable?.pauseAsync();
        // La clé de reprise permet de repartir de l'octet atteint plutôt que
        // de recommencer les gigaoctets déjà transférés.
        if (data?.resumeData) await writeResume(model.id, data.resumeData);
      } catch {
        // Sans clé de reprise, le fichier partiel demeure : la relance
        // repartira du début, mais rien n'est perdu.
      }
    },
    cancel: async () => {
      abandoned = true;
      try {
        await resumable?.cancelAsync();
      } finally {
        await FileSystem.deleteAsync(target, { idempotent: true });
        await writeResume(model.id, null);
      }
    },
  };
}
