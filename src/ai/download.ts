import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from "@kesha-antonov/react-native-background-downloader";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";

import type { ModelDescriptor } from "./models";

/**
 * Téléchargement des modèles, confié au gestionnaire de téléchargement
 * d'Android.
 *
 * Une tentative précédente s'appuyait sur `createDownloadResumable` d'Expo :
 * sa clé de reprise n'est produite que par un appel explicite à `pauseAsync`.
 * Sur une coupure réseau — « Software caused connection abort » — la promesse
 * est rejetée sans qu'aucune pause n'ait lieu, aucune clé n'est enregistrée, et
 * la tentative suivante repart de zéro. Le cas traité n'était pas celui qui
 * arrive.
 *
 * Le gestionnaire système, lui, reprend seul après une coupure, poursuit
 * application fermée, et sait se limiter au Wi-Fi.
 */

const MODEL_DIR = `${FileSystem.documentDirectory}models/`;

/** Identifiant stable : il permet de retrouver un transfert après redémarrage. */
const taskId = (model: ModelDescriptor) => `model-${model.id}`;

let configured = false;
function configureOnce(): void {
  if (configured) return;
  configured = true;
  setConfig({
    // Le gestionnaire signale l'avancement dans la zone de notifications :
    // l'utilisateur suit un transfert de plusieurs gigaoctets sans garder
    // l'application ouverte.
    showNotificationsEnabled: true,
    showCompletionNotification: true,
    showCancelAction: true,
    progressInterval: 1000,
    maxParallelDownloads: 1,
  });
}

export function modelPathFor(model: ModelDescriptor): string {
  return `${MODEL_DIR}${model.fileName}`;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
}

/**
 * Un fichier GGUF commence par ces quatre octets. Contrôle bien plus sûr
 * qu'une comparaison de taille : il distingue un modèle valide d'une page
 * d'erreur ou d'un portail réseau enregistrés par méprise.
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
 * La taille du catalogue n'est qu'un repère : elle peut différer de quelques
 * centaines d'octets d'une reconstruction amont à l'autre. Exiger l'égalité
 * stricte rendait un modèle parfaitement valide « absent ».
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
}

export async function partialBytes(model: ModelDescriptor): Promise<number> {
  const info = await FileSystem.getInfoAsync(modelPathFor(model));
  return info.exists && !info.isDirectory ? info.size : 0;
}

export interface DownloadProgress {
  ratio: number | null;
  written: number;
  total: number;
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

export interface ModelDownload {
  promise: Promise<string>;
  /** Suspend en conservant l'acquis. */
  pause: () => Promise<void>;
  /** Reprend un transfert suspendu. */
  resume: () => Promise<void>;
  /** Abandonne et efface le fichier partiel. */
  cancel: () => Promise<void>;
}

/**
 * Rattache le suivi à une tâche, qu'elle vienne d'être créée ou qu'elle
 * tournait déjà — le cas au retour dans l'application.
 */
function attach(
  task: DownloadTask,
  model: ModelDescriptor,
  onProgress: (p: DownloadProgress) => void,
): ModelDownload {
  const promise = new Promise<string>((resolve, reject) => {
    task
      .progress(({ bytesDownloaded, bytesTotal }) => {
        const total = bytesTotal > 0 ? bytesTotal : model.bytes;
        onProgress({
          ratio: total > 0 ? bytesDownloaded / total : null,
          written: bytesDownloaded,
          total,
        });
      })
      .done(() => {
        void (async () => {
          const path = modelPathFor(model);
          // Ce qui n'est pas un GGUF ne sera jamais exploitable — page
          // d'erreur, portail captif. Là seulement, effacer est justifié.
          if (!(await hasGgufHeader(path))) {
            await FileSystem.deleteAsync(path, { idempotent: true });
            reject(
              new Error(
                "Le fichier reçu n'est pas un modèle GGUF valide. Le téléchargement a probablement été intercepté par un portail réseau.",
              ),
            );
          } else {
            resolve(path);
          }
          // Signale au système que le traitement post-téléchargement est fini.
          completeHandler(task.id);
        })();
      })
      .error(({ error }) => {
        // Le fichier partiel est CONSERVÉ : le gestionnaire reprendra où il
        // s'est arrêté à la prochaine tentative.
        reject(new Error(error || "Téléchargement interrompu"));
      });
  });

  return {
    promise,
    pause: () => task.pause(),
    resume: () => task.resume(),
    cancel: async () => {
      try {
        await task.stop();
      } finally {
        await FileSystem.deleteAsync(modelPathFor(model), { idempotent: true });
      }
    },
  };
}

/**
 * Reprend le suivi d'un transfert déjà en cours, s'il en existe un.
 *
 * Le gestionnaire système poursuit application fermée : au retour, il faut se
 * rebrancher dessus plutôt que d'en lancer un second.
 */
export async function attachExistingDownload(
  model: ModelDescriptor,
  onProgress: (p: DownloadProgress) => void,
): Promise<ModelDownload | null> {
  configureOnce();
  try {
    const tasks = await getExistingDownloadTasks();
    const existing = tasks.find((t) => t.id === taskId(model));
    return existing ? attach(existing, model, onProgress) : null;
  } catch {
    return null;
  }
}

/**
 * Lance le téléchargement d'un modèle.
 *
 * `allowCellular` reste explicite et jamais implicite : plusieurs gigaoctets,
 * c'est un forfait mobile entier.
 */
export async function downloadModel(
  model: ModelDescriptor,
  onProgress: (p: DownloadProgress) => void,
  opts: { allowCellular?: boolean } = {},
): Promise<ModelDownload> {
  configureOnce();

  const connection = await connectionKind();
  if (connection === "none") throw new Error("Aucune connexion réseau.");
  if (connection === "cellular" && !opts.allowCellular) {
    throw new CellularBlockedError();
  }

  await ensureDir();

  // Un transfert déjà lancé ne doit pas être doublé.
  const existing = await attachExistingDownload(model, onProgress);
  if (existing) return existing;

  const task = createDownloadTask({
    id: taskId(model),
    url: model.url,
    destination: modelPathFor(model),
    // Contrainte appliquée par le système lui-même, pas seulement par nous.
    isAllowedOverMetered: opts.allowCellular ?? false,
    isAllowedOverRoaming: false,
    metadata: { modelId: model.id, label: model.label },
  });

  const handle = attach(task, model, onProgress);
  task.start();
  return handle;
}
