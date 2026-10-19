import { getDb } from "../db/client";

const KEY = "recap.lastSeenAt";

/**
 * Instant de la visite précédente, figé pour toute la durée du lancement.
 *
 * Sert de repère à « cette nuit » : ce qui a été rangé depuis, les badges
 * « +3 » des tiroirs. La date de visite est avancée dès la première lecture,
 * pour que la prochaine ouverture ne reprenne que la nouveauté. À la toute
 * première ouverture, on prend les dernières vingt-quatre heures.
 */
let previous: Promise<{ at: number; first: boolean }> | null = null;

export function previousVisit(): Promise<{ at: number; first: boolean }> {
  previous ??= (async () => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [KEY],
    );
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, String(Date.now())],
    );
    const at = row ? Number(row.value) : NaN;
    return Number.isFinite(at)
      ? { at, first: false }
      : { at: Date.now() - 24 * 3_600_000, first: true };
  })().catch(() => ({ at: Date.now() - 24 * 3_600_000, first: true }));
  return previous;
}
