import { getDb } from "./client";
import { COUNT_DOUBTS, DOUBTS, DRAWERS, FILED_SINCE } from "./verify.sql";
import { assignTheme, createTheme } from "./themes";
import { saveReview, NO_VERDICT } from "./reviews";
import { buildSnapshot } from "../feedback/collect";
import {
  DEFAULT_THRESHOLD,
  adjustThreshold,
  type VerificationEvent,
} from "../ai/confidence";
import type { ThemeSuggestion } from "../ai/classify";
import type { Alternative } from "../ai/classification";

/**
 * Le tri du matin : ce dont l'IA doute, ce qu'elle a rangé seule, et le
 * seuil qui sépare les deux — ajusté par chaque vérification.
 */

const THRESHOLD_KEY = "review.threshold";

async function readSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function getThreshold(): Promise<number> {
  const raw = Number(await readSetting(THRESHOLD_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THRESHOLD;
}

export async function setThreshold(value: number): Promise<void> {
  await writeSetting(THRESHOLD_KEY, String(value));
}

const AUTO_KEY = "review.autoAdjust";

export async function getAutoAdjust(): Promise<boolean> {
  return (await readSetting(AUTO_KEY)) !== "false";
}

export async function setAutoAdjust(value: boolean): Promise<void> {
  await writeSetting(AUTO_KEY, value ? "true" : "false");
}

async function recordEvent(event: VerificationEvent): Promise<void> {
  if (!(await getAutoAdjust())) return;
  await setThreshold(adjustThreshold(await getThreshold(), event));
}

/** Nombre d'idées rangées par l'IA qui seraient montrées avec ce seuil. */
export async function countBelow(threshold: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(COUNT_DOUBTS, [threshold]);
  return row?.n ?? 0;
}

export async function listDoubtIds(limit = 50): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(DOUBTS, [await getThreshold(), limit]);
  return rows.map((r) => r.id);
}

export async function countDoubts(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(COUNT_DOUBTS, [await getThreshold()]);
  return row?.n ?? 0;
}

export async function listFiledSinceIds(since: number, limit = 100): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(FILED_SINCE, [await getThreshold(), since, limit]);
  return rows.map((r) => r.id);
}

export interface Drawer {
  id: string;
  name: string;
  icon: string | null;
  count: number;
  fresh: number;
  cover: string | null;
}

export async function listDrawers(since: number): Promise<Drawer[]> {
  const db = await getDb();
  return db.getAllAsync<Drawer>(DRAWERS, [since]);
}

export interface ClassificationMeta {
  confidence: number | null;
  alternatives: Alternative[];
  suggestion: ThemeSuggestion | null;
}

/** Ce que l'IA a mesuré en rangeant ; une nouvelle analyse rouvre la vérification. */
export async function saveClassificationMeta(id: string, meta: ClassificationMeta): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE bookmarks SET ai_confidence = ?, ai_alternatives = ?, theme_suggestion = ?,
       verified_at = CASE WHEN theme_source = 'human' THEN verified_at ELSE NULL END
     WHERE id = ?`,
    [
      meta.confidence,
      JSON.stringify(meta.alternatives),
      meta.suggestion ? JSON.stringify(meta.suggestion) : null,
      id,
    ],
  );
}

export interface ClassificationDetails {
  themeId: string | null;
  subthemeId: string | null;
  themeSource: "ai" | "human" | null;
  confidence: number | null;
  alternatives: Alternative[];
  suggestion: ThemeSuggestion | null;
}

export async function getClassificationDetails(id: string): Promise<ClassificationDetails | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    theme_id: string | null;
    subtheme_id: string | null;
    theme_source: "ai" | "human" | null;
    ai_confidence: number | null;
    ai_alternatives: string | null;
    theme_suggestion: string | null;
  }>(
    "SELECT theme_id, subtheme_id, theme_source, ai_confidence, ai_alternatives, theme_suggestion FROM bookmarks WHERE id = ?",
    [id],
  );
  if (!row) return null;
  const parse = <T,>(raw: string | null, fallback: T): T => {
    try {
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    themeId: row.theme_id,
    subthemeId: row.subtheme_id,
    themeSource: row.theme_source,
    confidence: row.ai_confidence,
    alternatives: parse<Alternative[]>(row.ai_alternatives, []).filter(
      (a) => a && typeof a.id === "string",
    ),
    suggestion: parse<ThemeSuggestion | null>(row.theme_suggestion, null),
  };
}

/**
 * L'utilisateur range une idée depuis « À vérifier » ou depuis la fiche.
 *
 * Trois effets : le rangement devient humain (jamais défait par l'IA), le
 * seuil s'ajuste selon que l'IA avait raison ou non, et un avis est noté
 * pour l'export des retours — vérifier, c'est juger le rangement.
 */
export async function fileByUser(
  id: string,
  themeId: string,
  subthemeId: string | null,
): Promise<void> {
  const before = await getClassificationDetails(id);
  const snapshot = await buildSnapshot(id);
  const threshold = await getThreshold();

  await assignTheme(id, themeId, subthemeId, "human");
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET verified_at = ? WHERE id = ?", [Date.now(), id]);

  if (!before || before.themeSource === "human") return;
  const aiWasRight = before.themeId === themeId;
  const wasDoubt = !before.themeId || (before.confidence !== null && before.confidence < threshold);
  const event: VerificationEvent | null = wasDoubt
    ? aiWasRight
      ? "kept"
      : "changed"
    : aiWasRight
      ? null
      : "missed";
  if (event) await recordEvent(event);
  if (snapshot && before.themeId) {
    await saveReview(id, { ...NO_VERDICT, theme: aiWasRight ? "good" : "bad" }, null, snapshot);
  }
}

/** Crée le tiroir proposé (éventuellement retouché) et y range l'idée. */
export async function acceptSuggestion(id: string, suggestion: ThemeSuggestion): Promise<string> {
  const themeId = await createTheme(suggestion.name, suggestion.emoji, suggestion.description);
  await fileByUser(id, themeId, null);
  return themeId;
}

export async function setDrawerCover(themeId: string, bookmarkId: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE themes SET cover_bookmark_id = ? WHERE id = ?", [bookmarkId, themeId]);
}
