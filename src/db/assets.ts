import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import type { AssetKind } from "../archive/types";
import { getDb } from "./client";

/**
 * Pièces conservées d'un favori : archive HTML autonome, capture d'écran, PDF,
 * images, vidéos.
 *
 * Elles vivent dans le répertoire documents — jamais le cache, qu'Android vide
 * sous pression de stockage. C'est précisément ce qui doit survivre à la
 * disparition du site.
 */
const ASSET_DIR = `${FileSystem.documentDirectory}assets/`;

export interface Asset {
  id: string;
  bookmarkId: string;
  kind: AssetKind;
  path: string;
  bytes: number;
  sourceUrl: string | null;
  createdAt: number;
}

interface AssetRow {
  id: string;
  bookmark_id: string;
  kind: AssetKind;
  path: string;
  bytes: number;
  source_url: string | null;
  created_at: number;
}

const EXTENSION: Record<AssetKind, string> = {
  screenshot: "jpg",
  pdf: "pdf",
  archive: "html",
  image: "img",
  video: "mp4",
};

async function ensureDir(bookmarkId: string): Promise<string> {
  const dir = `${ASSET_DIR}${bookmarkId}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function rowToAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    bookmarkId: r.bookmark_id,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    sourceUrl: r.source_url,
    createdAt: r.created_at,
  };
}

async function record(
  bookmarkId: string,
  kind: AssetKind,
  path: string,
  sourceUrl: string | null,
): Promise<Asset> {
  const info = await FileSystem.getInfoAsync(path);
  const bytes = info.exists && !info.isDirectory ? info.size : 0;
  const id = Crypto.randomUUID();
  const now = Date.now();

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO assets (id, bookmark_id, kind, path, bytes, source_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, bookmarkId, kind, path, bytes, sourceUrl, now],
  );
  return {
    id,
    bookmarkId,
    kind,
    path,
    bytes,
    sourceUrl,
    createdAt: now,
  };
}

/** Enregistre un contenu textuel (archive HTML). */
export async function saveText(
  bookmarkId: string,
  kind: AssetKind,
  content: string,
  sourceUrl: string | null = null,
): Promise<Asset> {
  const dir = await ensureDir(bookmarkId);
  const path = `${dir}${kind}-${Date.now()}.${EXTENSION[kind]}`;
  await FileSystem.writeAsStringAsync(path, content);
  return record(bookmarkId, kind, path, sourceUrl);
}

/** Déplace un fichier temporaire (capture, PDF) vers le stockage durable. */
export async function adoptFile(
  bookmarkId: string,
  kind: AssetKind,
  tempUri: string,
  sourceUrl: string | null = null,
): Promise<Asset> {
  const dir = await ensureDir(bookmarkId);
  const path = `${dir}${kind}-${Date.now()}.${EXTENSION[kind]}`;
  // `moveAsync` échoue entre volumes différents ; on retombe sur une copie.
  try {
    await FileSystem.moveAsync({ from: tempUri, to: path });
  } catch {
    await FileSystem.copyAsync({ from: tempUri, to: path });
    await FileSystem.deleteAsync(tempUri, { idempotent: true });
  }
  return record(bookmarkId, kind, path, sourceUrl);
}

/** Télécharge une ressource distante et la conserve. */
export async function downloadAsset(
  bookmarkId: string,
  kind: AssetKind,
  url: string,
  maxBytes = 20 * 1024 * 1024,
  /**
   * Poids minimal accepté. Les dimensions annoncées par le DOM valent zéro
   * tant que l'image n'est pas chargée : le poids du fichier est le seul
   * critère fiable pour écarter icônes et avatars.
   */
  minBytes = 0,
): Promise<Asset | null> {
  const dir = await ensureDir(bookmarkId);
  const path = `${dir}${kind}-${Date.now()}.${EXTENSION[kind]}`;
  try {
    const result = await FileSystem.downloadAsync(url, path);
    if (result.status !== 200) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return null;
    }
    const info = await FileSystem.getInfoAsync(path);
    if (
      !info.exists ||
      info.isDirectory ||
      info.size > maxBytes ||
      info.size < minBytes
    ) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      return null;
    }
    return await record(bookmarkId, kind, path, url);
  } catch {
    await FileSystem.deleteAsync(path, { idempotent: true });
    return null;
  }
}

export async function listAssets(bookmarkId: string): Promise<Asset[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AssetRow>(
    "SELECT * FROM assets WHERE bookmark_id = ? ORDER BY created_at",
    [bookmarkId],
  );
  return rows.map(rowToAsset);
}

export async function deleteAssetsFor(bookmarkId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<AssetRow>(
    "SELECT * FROM assets WHERE bookmark_id = ?",
    [bookmarkId],
  );
  for (const row of rows) {
    await FileSystem.deleteAsync(row.path, { idempotent: true });
  }
  await FileSystem.deleteAsync(`${ASSET_DIR}${bookmarkId}/`, {
    idempotent: true,
  });
  await db.runAsync("DELETE FROM assets WHERE bookmark_id = ?", [bookmarkId]);
}

/** Place occupée par les pièces conservées, pour l'écran de réglages. */
export async function totalAssetBytes(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number | null }>(
    "SELECT SUM(bytes) AS total FROM assets",
  );
  return row?.total ?? 0;
}
