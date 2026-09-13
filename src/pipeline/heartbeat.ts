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
const MAX_ENTRIES = 20;

export interface BackgroundRun {
  at: number;
  /** Ce que le réveil a produit, en une ligne lisible. */
  outcome: string;
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

export async function recordBackgroundRun(outcome: string): Promise<void> {
  try {
    const previous = await readBackgroundLog();
    const next = [{ at: Date.now(), outcome }, ...previous].slice(0, MAX_ENTRIES);
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, JSON.stringify(next)],
    );
  } catch {
    // Un journal qui n'a pas pu s'écrire ne doit pas faire échouer le réveil.
  }
}
