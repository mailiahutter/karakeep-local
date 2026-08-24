import * as Crypto from "expo-crypto";

import { getDb } from "./client";
import { toFtsQuery } from "./fts";
import { normalizeUrl } from "./urls";
import {
  type AiStatus,
  type Bookmark,
  type BookmarkRow,
  type FetchStatus,
  type Tag,
  type TagSource,
  rowToBookmark,
} from "./types";

async function tagsFor(ids: string[]): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<{
    bookmark_id: string;
    id: string;
    name: string;
    source: TagSource;
  }>(
    `SELECT bt.bookmark_id, t.id, t.name, bt.source
     FROM bookmark_tags bt
     JOIN tags t ON t.id = bt.tag_id
     WHERE bt.bookmark_id IN (${placeholders})
     ORDER BY t.name COLLATE NOCASE`,
    ids,
  );
  for (const r of rows) {
    const list = out.get(r.bookmark_id) ?? [];
    list.push({ id: r.id, name: r.name, source: r.source });
    out.set(r.bookmark_id, list);
  }
  return out;
}

async function hydrate(rows: BookmarkRow[]): Promise<Bookmark[]> {
  const tagMap = await tagsFor(rows.map((r) => r.id));
  return rows.map((r) => rowToBookmark(r, tagMap.get(r.id) ?? []));
}

export interface CreateResult {
  bookmark: Bookmark;
  /** false si l'URL était déjà enregistrée : l'appelant peut le signaler. */
  created: boolean;
}

/**
 * Enregistre une URL. Le contenu et les tags sont remplis ensuite, en tâche de
 * fond, pour que le partage rende la main immédiatement.
 */
export async function createBookmark(
  rawUrl: string,
  opts: { note?: string; title?: string } = {},
): Promise<CreateResult> {
  const db = await getDb();
  const url = normalizeUrl(rawUrl);
  const now = Date.now();

  const existing = await db.getFirstAsync<BookmarkRow>(
    "SELECT * FROM bookmarks WHERE url = ?",
    [url],
  );
  if (existing) {
    const [hydrated] = await hydrate([existing]);
    return { bookmark: hydrated, created: false };
  }

  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO bookmarks (id, url, title, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, url, opts.title ?? null, opts.note ?? null, now, now],
  );
  const row = await db.getFirstAsync<BookmarkRow>(
    "SELECT * FROM bookmarks WHERE id = ?",
    [id],
  );
  const [hydrated] = await hydrate([row!]);
  return { bookmark: hydrated, created: true };
}

export interface ListOptions {
  archived?: boolean;
  favourited?: boolean;
  tagId?: string;
  limit?: number;
  offset?: number;
}

export async function listBookmarks(
  opts: ListOptions = {},
): Promise<Bookmark[]> {
  const db = await getDb();
  const { archived = false, favourited, tagId, limit = 50, offset = 0 } = opts;

  const where: string[] = ["b.archived = ?"];
  const params: (string | number)[] = [archived ? 1 : 0];

  if (favourited !== undefined) {
    where.push("b.favourited = ?");
    params.push(favourited ? 1 : 0);
  }
  const join = tagId
    ? "JOIN bookmark_tags bt ON bt.bookmark_id = b.id AND bt.tag_id = ?"
    : "";
  if (tagId) params.unshift(tagId);

  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT b.* FROM bookmarks b ${join}
     WHERE ${where.join(" AND ")}
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return hydrate(rows);
}

export async function getBookmark(id: string): Promise<Bookmark | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<BookmarkRow>(
    "SELECT * FROM bookmarks WHERE id = ?",
    [id],
  );
  if (!row) return null;
  const [hydrated] = await hydrate([row]);
  return hydrated;
}

export async function searchBookmarks(
  query: string,
  limit = 50,
): Promise<Bookmark[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT b.* FROM bookmarks_fts f
     JOIN bookmarks b ON b.id = f.bookmark_id
     WHERE bookmarks_fts MATCH ?
     ORDER BY bm25(bookmarks_fts, 0.0, 10.0, 5.0, 1.0, 3.0)
     LIMIT ?`,
    [fts, limit],
  );
  return hydrate(rows);
}

export interface ExtractedContent {
  title?: string | null;
  description?: string | null;
  content?: string | null;
  author?: string | null;
  siteName?: string | null;
  imageUrl?: string | null;
  faviconUrl?: string | null;
  publishedAt?: number | null;
}

export async function saveExtractedContent(
  id: string,
  data: ExtractedContent,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE bookmarks SET
       title        = COALESCE(?, title),
       description  = COALESCE(?, description),
       content      = COALESCE(?, content),
       author       = COALESCE(?, author),
       site_name    = COALESCE(?, site_name),
       image_url    = COALESCE(?, image_url),
       favicon_url  = COALESCE(?, favicon_url),
       published_at = COALESCE(?, published_at),
       fetch_status = 'success',
       fetch_error  = NULL,
       updated_at   = ?
     WHERE id = ?`,
    [
      data.title ?? null,
      data.description ?? null,
      data.content ?? null,
      data.author ?? null,
      data.siteName ?? null,
      data.imageUrl ?? null,
      data.faviconUrl ?? null,
      data.publishedAt ?? null,
      Date.now(),
      id,
    ],
  );
}

export async function setFetchStatus(
  id: string,
  status: FetchStatus,
  error?: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE bookmarks SET fetch_status = ?, fetch_error = ?, updated_at = ? WHERE id = ?",
    [status, error ?? null, Date.now(), id],
  );
}

export async function setAiStatus(
  id: string,
  status: AiStatus,
  error?: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE bookmarks SET ai_status = ?, ai_error = ?, updated_at = ? WHERE id = ?",
    [status, error ?? null, Date.now(), id],
  );
}

export async function setFavourite(id: string, value: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE bookmarks SET favourited = ?, updated_at = ? WHERE id = ?",
    [value ? 1 : 0, Date.now(), id],
  );
}

export async function setArchived(id: string, value: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE bookmarks SET archived = ?, updated_at = ? WHERE id = ?",
    [value ? 1 : 0, Date.now(), id],
  );
}

export async function setNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE bookmarks SET note = ?, updated_at = ? WHERE id = ?",
    [note, Date.now(), id],
  );
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM bookmarks WHERE id = ?", [id]);
}

/** Favoris en attente d'une étape de traitement, pour la file d'arrière-plan. */
export async function pendingBookmarks(
  column: "fetch_status" | "ai_status",
  limit = 10,
): Promise<Bookmark[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT * FROM bookmarks WHERE ${column} = 'pending' ORDER BY created_at ASC LIMIT ?`,
    [limit],
  );
  return hydrate(rows);
}

export async function countBookmarks(): Promise<{
  total: number;
  archived: number;
  favourited: number;
}> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    total: number;
    archived: number;
    favourited: number;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(archived)   AS archived,
            SUM(favourited) AS favourited
     FROM bookmarks`,
  );
  return {
    total: row?.total ?? 0,
    archived: row?.archived ?? 0,
    favourited: row?.favourited ?? 0,
  };
}
