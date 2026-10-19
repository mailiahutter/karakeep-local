import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { getDb } from "../db/client";
import { zipFiles } from "../../modules/karakeep-worker/src";

const LAST_KEY = "backup.lastAt";

/**
 * Sauvegarde complète vers Proton Drive (ou tout autre service), décidée au
 * tour 1 : à la demande, sans rappel automatique.
 *
 * Une archive ZIP réunit une copie cohérente de la base (`VACUUM INTO`, sûre
 * même si la file travaille) et toutes les pièces conservées — photos,
 * vidéos, pages archivées. Les modèles d'IA n'y sont pas : ils se
 * retéléchargent. L'archive part ensuite par le menu de partage d'Android,
 * où l'on choisit Proton Drive.
 */
export async function backupAndShare(): Promise<{ files: number; size: number }> {
  const dir = `${FileSystem.cacheDirectory}sauvegarde/`;
  await FileSystem.deleteAsync(dir, { idempotent: true });
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const dbCopy = `${dir}karakeep.db`;
  const db = await getDb();
  await db.execAsync(`VACUUM INTO '${dbCopy.replace(/^file:\/\//, "").replace(/'/g, "''")}'`);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const zipPath = `${dir}karakeep-sauvegarde-${stamp}.zip`;
  const result = await zipFiles(
    [dbCopy, `${FileSystem.documentDirectory}assets`],
    zipPath,
  );
  await FileSystem.deleteAsync(dbCopy, { idempotent: true });

  await Sharing.shareAsync(zipPath.startsWith("file://") ? zipPath : `file://${result.path}`, {
    mimeType: "application/zip",
    dialogTitle: "Envoyer la sauvegarde vers Proton Drive",
  });
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [LAST_KEY, String(Date.now())],
  );
  return { files: result.files, size: result.size };
}

export async function lastBackupAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [LAST_KEY],
  );
  const at = row ? Number(row.value) : NaN;
  return Number.isFinite(at) ? at : null;
}
