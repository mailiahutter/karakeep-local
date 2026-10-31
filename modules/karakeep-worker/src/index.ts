import { requireOptionalNativeModule } from "expo";

/**
 * Service de travail en arrière-plan.
 *
 * `requireOptionalNativeModule` plutôt que `requireNativeModule` : sous Expo
 * Go ou sur une version de l'application antérieure au module, l'absence doit
 * se constater, pas faire planter l'écran.
 */
interface KarakeepWorkerNative {
  start(kind?: string | null): void;
  scheduleDayPasses(enabled: boolean): number;
  isCharging(): boolean;
  modeStatus(): ModeStatus;
  requestModePermission(): boolean;
  setModeActive(active: boolean): boolean;
  setModeAuto(auto: boolean): void;
  requestAddTile(): boolean;
  requestCallBlocking(): boolean;
  requestQuietAccess(): boolean;
  stop(): void;
  isRunning(): boolean;
  scheduleDaily(hour: number, minute: number): number;
  cancelDaily(): void;
  scheduledWindow(): { hour: number; minute: number } | null;
  diagnostics(): WorkerDiagnostics;
  recognizeText(path: string): Promise<string>;
  ytdlpDownload(url: string, dir: string, cookie: string | null): Promise<{ files: string[]; info: string }>;
  cookieFor(url: string): string | null;
  extractFrames(videoPath: string, count: number, outDir: string): Promise<string[]>;
  extractAudio(videoPath: string, outPath: string, maxSeconds: number): Promise<string | null>;
  ytdlpUpdate(): Promise<string>;
  ytdlpVersion(): Promise<string | null>;
  zip(sources: string[], dest: string): Promise<{ path: string; files: number; bytes: number; size: number }>;
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

export type SessionKind = "night" | "day" | "share";

export function startWorker(kind: SessionKind = "night"): boolean {
  if (!native) return false;
  try {
    native.start(kind);
  } catch {
    // Version native antérieure, sans argument.
    (native as unknown as { start(): void }).start();
  }
  return true;
}

/** Passages de jour toutes les deux heures. Renvoie le prochain, ou `null`. */
export function scheduleDayPasses(enabled: boolean): number | null {
  try {
    return typeof native?.scheduleDayPasses === "function" ? native.scheduleDayPasses(enabled) || null : null;
  } catch {
    return null;
  }
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
export async function ytdlpDownload(
  url: string,
  dir: string,
  cookie: string | null = null,
): Promise<YtdlpResult> {
  if (!hasMediaTools()) throw new Error("yt-dlp absent de cette version");
  const raw = await native!.ytdlpDownload(url, dir, cookie);
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

/** Archive ZIP (sauvegarde). Lève une erreur si le module natif manque. */
export async function zipFiles(
  sources: string[],
  dest: string,
): Promise<{ path: string; files: number; bytes: number; size: number }> {
  if (typeof native?.zip !== "function") throw new Error("Sauvegarde indisponible dans cette version");
  return native.zip(sources, dest);
}

/** Cookies de la WebView pour cette adresse (session Instagram), ou `null`. */
export function cookieFor(url: string): string | null {
  try {
    return typeof native?.cookieFor === "function" ? native.cookieFor(url) || null : null;
  } catch {
    return null;
  }
}

/** Images-clés d'une vidéo ; liste vide si indisponible. */
export async function extractFrames(videoPath: string, count: number, outDir: string): Promise<string[]> {
  if (typeof native?.extractFrames !== "function") return [];
  return native.extractFrames(videoPath, count, outDir);
}

/** Son d'une vidéo en WAV 16 kHz mono ; `null` si muette ou indisponible. */
export async function extractAudio(videoPath: string, outPath: string, maxSeconds: number): Promise<string | null> {
  if (typeof native?.extractAudio !== "function") return null;
  return native.extractAudio(videoPath, outPath, maxSeconds);
}

/** Branché sur secteur ? Faux si on ne sait pas : l'analyse ne part pas au hasard. */
export function isCharging(): boolean {
  try {
    return typeof native?.isCharging === "function" ? native.isCharging() : false;
  } catch {
    return false;
  }
}

// --- Mode Karakeep : internet pour Karakeep seulement -------------------------

export interface ModeStatus {
  /** L'utilisateur a autorisé l'application à être le VPN du téléphone. */
  permitted: boolean;
  active: boolean;
  /** Activé seul à l'heure de la séance de nuit, coupé à 7 h. */
  auto: boolean;
  /** Rôle de filtre d'appels accordé : les appels entrants sont refusés. */
  blocksCalls?: boolean;
  /** Accès à « Ne pas déranger » accordé : silence, réveil excepté. */
  quietAccess?: boolean;
}

export function modeStatus(): ModeStatus | null {
  try {
    return typeof native?.modeStatus === "function" ? native.modeStatus() : null;
  } catch {
    return null;
  }
}

/** Ouvre la fenêtre d'autorisation d'Android ; faux si déjà accordée. */
export function requestModePermission(): boolean {
  return native?.requestModePermission?.() ?? false;
}

export function setModeActive(active: boolean): boolean {
  return native?.setModeActive?.(active) ?? false;
}

export function setModeAuto(auto: boolean): void {
  native?.setModeAuto?.(auto);
}

export function requestAddTile(): boolean {
  try {
    return native?.requestAddTile?.() ?? false;
  } catch {
    return false;
  }
}

export function requestCallBlocking(): boolean {
  try {
    return native?.requestCallBlocking?.() ?? false;
  } catch {
    return false;
  }
}

export function requestQuietAccess(): boolean {
  try {
    return native?.requestQuietAccess?.() ?? false;
  } catch {
    return false;
  }
}
