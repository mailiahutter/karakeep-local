import * as Crypto from "expo-crypto";

import { getDb } from "./client";
import { passageKey } from "../archive/paragraphs";

export interface Highlight {
  id: string;
  bookmarkId: string;
  text: string;
  note: string | null;
  position: number;
  createdAt: number;
}

interface Row {
  id: string;
  bookmark_id: string;
  text: string;
  note: string | null;
  position: number;
  created_at: number;
}

export async function listHighlights(bookmarkId: string): Promise<Highlight[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    "SELECT * FROM highlights WHERE bookmark_id = ? ORDER BY position, created_at",
    [bookmarkId],
  );
  return rows.map((r) => ({
    id: r.id,
    bookmarkId: r.bookmark_id,
    text: r.text,
    note: r.note,
    position: r.position,
    createdAt: r.created_at,
  }));
}

/** Surligne le passage, ou retire le surlignage s'il existait. */
export async function toggleHighlight(
  bookmarkId: string,
  text: string,
  position: number,
): Promise<void> {
  const existing = (await listHighlights(bookmarkId)).find(
    (h) => passageKey(h.text) === passageKey(text),
  );
  const db = await getDb();
  if (existing) {
    await db.runAsync("DELETE FROM highlights WHERE id = ?", [existing.id]);
    return;
  }
  await db.runAsync(
    "INSERT INTO highlights (id, bookmark_id, text, note, position, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
    [Crypto.randomUUID(), bookmarkId, text, position, Date.now()],
  );
}

export async function setHighlightNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE highlights SET note = ? WHERE id = ?", [
    note.trim() || null,
    id,
  ]);
}
