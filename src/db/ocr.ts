import { getDb } from "./client";

/** `undefined` : jamais lu ; chaîne vide : lu, rien trouvé. */
export async function getOcrText(id: string): Promise<string | null | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ ocr_text: string | null }>(
    "SELECT ocr_text FROM bookmarks WHERE id = ?",
    [id],
  );
  if (!row) return undefined;
  return row.ocr_text === null ? undefined : row.ocr_text;
}

export async function setOcrText(id: string, text: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET ocr_text = ? WHERE id = ?", [text, id]);
}
