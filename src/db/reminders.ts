import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";

import { getDb } from "./client";

/**
 * Rappels : « jette un œil à cette idée tel jour à telle heure ».
 *
 * La notification est programmée auprès d'Android, qui la délivre même
 * application fermée. La table garde la trace pour l'afficher sur la fiche
 * et pouvoir l'annuler.
 */

const CHANNEL = "reminders";
let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Rappels",
    importance: Notifications.AndroidImportance.HIGH,
  });
  channelReady = true;
}

export interface Reminder {
  id: string;
  bookmarkId: string;
  dueAt: number;
}

export async function listReminders(bookmarkId: string): Promise<Reminder[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; bookmark_id: string; due_at: number }>(
    "SELECT id, bookmark_id, due_at FROM reminders WHERE bookmark_id = ? AND done = 0 AND due_at > ? ORDER BY due_at",
    [bookmarkId, Date.now()],
  );
  return rows.map((r) => ({ id: r.id, bookmarkId: r.bookmark_id, dueAt: r.due_at }));
}

/** Programme la notification. Lève une erreur si l'autorisation est refusée. */
export async function addReminder(
  bookmarkId: string,
  dueAt: number,
  title: string,
  body: string,
): Promise<void> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      "Les notifications sont désactivées pour Karakeep Local. Autorise-les dans les réglages d'Android, ou ajoute le rappel à ton agenda.",
    );
  }
  await ensureChannel();
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { bookmarkId } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(dueAt),
      channelId: CHANNEL,
    },
  });
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO reminders (id, bookmark_id, due_at, notification_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [Crypto.randomUUID(), bookmarkId, dueAt, notificationId, Date.now()],
  );
}

export async function cancelReminder(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ notification_id: string | null }>(
    "SELECT notification_id FROM reminders WHERE id = ?",
    [id],
  );
  if (row?.notification_id) {
    await Notifications.cancelScheduledNotificationAsync(row.notification_id).catch(() => {});
  }
  await db.runAsync("UPDATE reminders SET done = 1 WHERE id = ?", [id]);
}
