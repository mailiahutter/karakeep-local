import { getDb } from "../db/client";
import { rankMethods, recordAttempt, type CaptureMethod, type MethodStats } from "./igParse";

/**
 * Mémoire de la fiabilité de chaque méthode de capture Instagram, sur cet
 * appareil. Sert à essayer d'abord celle qui marche le mieux en ce moment.
 */

const KEY = "instagram.methods";
type Stats = Partial<Record<CaptureMethod, MethodStats>>;

export async function readMethodStats(): Promise<Stats> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [KEY],
    );
    return row ? (JSON.parse(row.value) as Stats) : {};
  } catch {
    return {};
  }
}

export async function rankedMethods(): Promise<CaptureMethod[]> {
  return rankMethods(await readMethodStats());
}

export async function noteAttempt(method: CaptureMethod, ok: boolean): Promise<void> {
  try {
    const next = recordAttempt(await readMethodStats(), method, ok);
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, JSON.stringify(next)],
    );
  } catch {
    // Une statistique perdue ne doit pas faire échouer une capture.
  }
}
