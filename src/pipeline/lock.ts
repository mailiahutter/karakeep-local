import { getDb } from "../db/client";
import { lockIsHeld } from "./policy";

/**
 * Battement de cœur du cycle de traitement, partagé entre le contexte de
 * l'interface et celui du réveil système. Voir `lockIsHeld`.
 */

const KEY = "queue.heartbeat";

export async function readHeartbeat(): Promise<number | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [KEY],
    );
    if (!row) return null;
    const parsed = Number(row.value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function beat(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, String(Date.now())],
    );
  } catch {
    // Le verrou est une précaution, pas une condition : son échec ne doit pas
    // empêcher le traitement.
  }
}

export async function releaseHeartbeat(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("DELETE FROM settings WHERE key = ?", [KEY]);
  } catch {
    // Le battement expirera de lui-même.
  }
}

/**
 * Un cycle tourne-t-il dans un autre contexte ?
 *
 * Seul le réveil système consulte ce verrou. L'interface, elle, passe outre :
 * un battement laissé par un processus tué bloquerait sinon le traitement
 * pendant plusieurs minutes au moment précis où l'utilisateur rouvre
 * l'application pour comprendre pourquoi rien n'avance.
 */
export async function isQueueLockHeld(): Promise<boolean> {
  return lockIsHeld(await readHeartbeat(), Date.now());
}
