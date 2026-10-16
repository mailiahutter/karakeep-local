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
