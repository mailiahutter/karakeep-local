import * as Crypto from "expo-crypto";

import { getDb } from "./client";
import type { Tag, TagSource } from "./types";

/** Retire les `#` de tête et compresse les espaces, comme le fait Karakeep. */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

export interface TagWithCount extends Tag {
  count: number;
}

export async function listTags(): Promise<TagWithCount[]> {
  const db = await getDb();
  return db.getAllAsync<TagWithCount>(
    `SELECT t.id, t.name, COUNT(bt.bookmark_id) AS count
     FROM tags t
     LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
     GROUP BY t.id, t.name
     ORDER BY count DESC, t.name COLLATE NOCASE`,
  );
}

/**
 * Récupère ou crée les tags par nom, puis les rattache au favori.
 *
 * Insensible à la casse : `tags.name` est en COLLATE NOCASE avec un index
 * unique, donc « Docker » et « docker » ne peuvent pas coexister.
 */
export async function attachTags(
  bookmarkId: string,
  names: string[],
  source: TagSource,
): Promise<void> {
  const cleaned = [
    ...new Set(
      names.map(normalizeTagName).filter((n) => n.length > 0 && n.length <= 60),
    ),
  ];
  if (cleaned.length === 0) return;

  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    for (const name of cleaned) {
      let tag = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
        [name],
      );
      if (!tag) {
        const id = Crypto.randomUUID();
        await db.runAsync(
          "INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)",
          [id, name, now],
        );
        tag = { id };
      }
      // Un tag posé à la main l'emporte sur une suggestion du modèle : on ne
      // remplace jamais 'human' par 'ai'.
      await db.runAsync(
        `INSERT INTO bookmark_tags (bookmark_id, tag_id, source)
         VALUES (?, ?, ?)
         ON CONFLICT(bookmark_id, tag_id) DO UPDATE SET
           source = CASE WHEN excluded.source = 'human' THEN 'human' ELSE source END`,
        [bookmarkId, tag.id, source],
      );
    }
  });
}

/**
 * Remplace les tags proposés par le modèle, sans toucher à ceux posés à la
 * main.
 *
 * `attachTags` ajoute seulement. Une nouvelle analyse empilait donc ses tags
 * sur les précédents : une publication en portait vingt-neuf, en trois
 * langues, dont la plupart venaient d'une version antérieure de
 * l'application. Ce que le modèle propose aujourd'hui doit remplacer ce qu'il
 * proposait hier.
 */
export async function replaceAiTags(
  bookmarkId: string,
  names: string[],
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM bookmark_tags WHERE bookmark_id = ? AND source = 'ai'",
    [bookmarkId],
  );
  await attachTags(bookmarkId, names, "ai");
  await pruneOrphanTags();
}

export async function detachTag(
  bookmarkId: string,
  tagId: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?",
    [bookmarkId, tagId],
  );
}

/** Supprime les tags qui ne sont plus rattachés à aucun favori. */
export async function pruneOrphanTags(): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)`,
  );
  return res.changes;
}

/**
 * Tags les plus utilisés, injectés dans le prompt pour que le modèle réutilise
 * le vocabulaire existant au lieu d'en inventer un à chaque fois.
 */
export async function frequentTagNames(limit = 40): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT t.name FROM tags t
     JOIN bookmark_tags bt ON bt.tag_id = t.id
     GROUP BY t.id, t.name
     ORDER BY COUNT(bt.bookmark_id) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.name);
}
