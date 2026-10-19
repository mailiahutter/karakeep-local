import { getDb } from "./client";
import { CLASSIFICATION_EXAMPLES } from "./examples.sql";

export interface StoredExample {
  id: string;
  text: string;
  themeId: string;
  subthemeId: string | null;
}

/** Rangements qui font foi, pour guider le modèle (voir `examples.sql.ts`). */
export async function listClassificationExamples(
  excludeId: string,
  limit = 60,
): Promise<StoredExample[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string | null;
    subject: string | null;
    theme_id: string;
    subtheme_id: string | null;
  }>(CLASSIFICATION_EXAMPLES, [excludeId, limit]);
  return rows
    .map((r) => ({
      id: r.id,
      text: (r.subject ?? r.title ?? "").trim(),
      themeId: r.theme_id,
      subthemeId: r.subtheme_id,
    }))
    .filter((e) => e.text.length > 0);
}
