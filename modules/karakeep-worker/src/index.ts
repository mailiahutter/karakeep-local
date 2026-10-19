import { requireOptionalNativeModule } from "expo";

/**
 * Service de travail en arrière-plan.
 *
 * `requireOptionalNativeModule` plutôt que `requireNativeModule` : sous Expo
 * Go ou sur une version de l'application antérieure au module, l'absence doit
 * se constater, pas faire planter l'écran.
 */
interface KarakeepWorkerNative {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  scheduleDaily(hour: number, minute: number): number;
  cancelDaily(): void;
  scheduledWindow(): { hour: number; minute: number } | null;
  diagnostics(): WorkerDiagnostics;
  recognizeText(path: string): Promise<string>;
  ytdlpDownload(url: string, dir: string): Promise<{ files: string[]; info: string }>;
  ytdlpUpdate(): Promise<string>;
  ytdlpVersion(): Promise<string | null>;
}

export interface WorkerDiagnostics {
  /** Android autorise-t-il les alarmes exactes ? Sans elles, pas de séance. */
  canScheduleExact: boolean;
  /** L'application échappe-t-elle à l'optimisation de batterie ? */
  ignoringBatteryOptimizations: boolean;
  /** Résultat du dernier déclenchement : « ok », ou le refus du système. */
  lastAlarmResult: string | null;
  lastAlarmAt: number;
}

const native = requireOptionalNativeModule<KarakeepWorkerNative>("KarakeepWorker");

export const isWorkerAvailable = (): boolean => native !== null;

export function startWorker(): boolean {
  if (!native) return false;
  native.start();
  return true;
}

export function stopWorker(): void {
  native?.stop();
}

export function isWorkerRunning(): boolean {
  try {
    return native?.isRunning() ?? false;
  } catch {
    return false;
  }
}

/** Programme la séance quotidienne. Renvoie l'instant du prochain départ. */
export function scheduleDailyWork(hour: number, minute: number): number | null {
  if (!native) return null;
  return native.scheduleDaily(hour, minute);
}

export function cancelDailyWork(): void {
  native?.cancelDaily();
}

export function scheduledWindow(): { hour: number; minute: number } | null {
  try {
    return native?.scheduledWindow() ?? null;
  } catch {
    return null;
  }
}

/**
 * Pourquoi la séance de nuit ne démarre pas, le cas échéant.
 *
 * Deux refus possibles côté Android, tous deux silencieux : les alarmes
 * exactes interdites, ou l'application soumise à l'optimisation de batterie.
 */
export function workerDiagnostics(): WorkerDiagnostics | null {
  try {
    return native?.diagnostics() ?? null;
  } catch {
    return null;
  }
}

/** Les fonctions de capture et d'analyse natives sont-elles présentes ? */
export function hasMediaTools(): boolean {
  return typeof native?.recognizeText === "function";
}

/** Texte lu dans une image (ML Kit, hors ligne). `null` si indisponible. */
export async function recognizeText(path: string): Promise<string | null> {
  if (!hasMediaTools()) return null;
  return native!.recognizeText(path);
}

export interface YtdlpResult {
  files: string[];
  /** Métadonnées JSON de yt-dlp, une ligne par élément téléchargé. */
  info: Record<string, unknown>[];
}

/** Téléchargement par yt-dlp dans `dir`. Lève une erreur en cas d'échec. */
export async function ytdlpDownload(url: string, dir: string): Promise<YtdlpResult> {
  if (!hasMediaTools()) throw new Error("yt-dlp absent de cette version");
  const raw = await native!.ytdlpDownload(url, dir);
  const info: Record<string, unknown>[] = [];
  for (const line of raw.info.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      info.push(JSON.parse(trimmed));
    } catch {
      // Ligne de progression ou d'avertissement : ignorée.
    }
  }
  return { files: raw.files, info };
}

export async function ytdlpUpdate(): Promise<string | null> {
  if (!hasMediaTools()) return null;
  return native!.ytdlpUpdate();
}

export async function ytdlpVersion(): Promise<string | null> {
  if (!hasMediaTools()) return null;
  try {
    return await native!.ytdlpVersion();
  } catch {
    return null;
  }
}
