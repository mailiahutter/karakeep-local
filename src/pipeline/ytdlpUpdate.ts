import { connectionKind } from "../ai/download";
import { getDb } from "../db/client";
import { ytdlpUpdate } from "../../modules/karakeep-worker/src";

const KEY = "ytdlp.updatedAt";
const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * Met yt-dlp à jour une fois par semaine, en Wi-Fi.
 *
 * Les sites changent leurs adresses sans prévenir ; yt-dlp publie un
 * correctif en quelques jours. Sans mise à jour, la méthode se dégraderait
 * peu à peu jusqu'à ne plus rien rapporter.
 */
export async function refreshYtdlpWeekly(): Promise<void> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [KEY],
    );
    if (row && Date.now() - Number(row.value) < WEEK_MS) return;
    if ((await connectionKind()) !== "wifi") return;
    const status = await ytdlpUpdate();
    if (status === null) return;
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [KEY, String(Date.now())],
    );
  } catch {
    // Réessayé au prochain cycle.
  }
}
