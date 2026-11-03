import * as Notifications from "expo-notifications";

import { getDb } from "../db/client";
import { checkForUpdate } from "./updater";

/**
 * Prévient d'une nouvelle version par une notification.
 *
 * Le 3 novembre, le journal venait encore de la 3.5.0 alors que la 3.5.2,
 * qui corrigeait la panne, était publiée depuis la veille : rien ne le
 * signalait hors de l'écran des réglages. Les passages en arrière-plan
 * vérifient désormais, au plus toutes les six heures, et notifient une seule
 * fois par version. Toucher la notification ouvre l'écran de mise à jour.
 */

const CHANNEL = "updates";
const LAST_CHECK = "update.lastCheck";
const NOTIFIED = "update.notified";
const EVERY_MS = 6 * 60 * 60_000;

async function read(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

async function write(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Renvoie la version annoncée, ou `null` s'il n'y avait rien à annoncer. */
export async function notifyIfUpdateAvailable(): Promise<string | null> {
  const last = Number((await read(LAST_CHECK)) ?? "0");
  if (Date.now() - last < EVERY_MS) return null;
  await write(LAST_CHECK, String(Date.now()));

  const check = await checkForUpdate();
  if (check.status !== "available") return null;
  const version = check.release.version;
  if ((await read(NOTIFIED)) === version) return null;

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Mises à jour",
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Karakeep Local ${version} est prête`,
      body: "Touche pour l'installer.",
      data: { route: "/settings/update" },
    },
    trigger: { channelId: CHANNEL },
  });
  await write(NOTIFIED, version);
  return version;
}
