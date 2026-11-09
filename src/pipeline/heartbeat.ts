import { getDb } from "../db/client";

/**
 * Journal des réveils système.
 *
 * Sans cette trace, personne — ni l'utilisateur ni moi — ne peut dire si le
 * système réveille réellement l'application. On ne savait donc pas distinguer
 * « la tâche ne tourne pas » de « la tâche tourne et ne trouve rien à faire »,
 * alors que la correction n'est pas du tout la même. Les gestionnaires de
 * batterie de certains constructeurs empêchent purement et simplement ces
 * réveils : il faut pouvoir le constater.
 */

const KEY = "background.log";
const MAX_ENTRIES = 60;

export interface BackgroundRun {
  at: number;
  /** Ce que le réveil a produit, en une ligne lisible. */
  outcome: string;
  /** Ligne de suivi, remplacée par la suivante. */
  progress?: boolean;
  /** Même message répété : nombre de fois, et première fois. */
  repeat?: number;
  since?: number;
}

export async function readBackgroundLog(): Promise<BackgroundRun[]> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [KEY],
    );
    if (!row) return [];
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as BackgroundRun[]) : [];
  } catch {
    return [];
  }
}

/**
 * Écritures en file : la séance, le réveil Android et l'interface écrivent
 * parfois au même instant, et une lecture-écriture concurrente perdait une
 * ligne.
 */
let writes: Promise<void> = Promise.resolve();

export function recordBackgroundRun(outcome: string): Promise<void> {
  writes = writes.then(() => write(outcome, false));
  return writes;
}

/** Ligne de suivi d'une séance : remplace la précédente plutôt que de s'ajouter. */
export function recordProgress(outcome: string): Promise<void> {
  writes = writes.then(() => write(outcome, true));
  return writes;
}

async function write(outcome: string, progress: boolean): Promise<void> {
  try {
    const previous = await readBackgroundLog();
    // Un même message répété toute la journée (« analyses réservées à la
    // nuit ») ne doit pas chasser du journal ce qui s'est passé la nuit.
    const [last, ...rest] = previous;
    const next: BackgroundRun[] =
      progress && last?.progress
        ? [{ at: Date.now(), outcome, progress: true }, ...rest]
        : last && last.outcome === outcome
          ? [{ at: Date.now(), outcome, repeat: (last.repeat ?? 1) + 1, since: last.since ?? last.at }, ...rest]
          : [{ at: Date.now(), outcome, ...(progress ? { progress: true } : {}) }, ...previous].slice(0, MAX_ENTRIES);
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, JSON.stringify(next)],
    );
  } catch {
    // Un journal qui n'a pas pu s'écrire ne doit pas faire échouer le réveil.
  }
}
