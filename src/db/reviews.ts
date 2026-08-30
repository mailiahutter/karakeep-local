import * as Crypto from "expo-crypto";

import { getDb } from "./client";
import {
  ALL_REVIEWS,
  COUNT_PENDING_REVIEWS,
  PENDING_REVIEWS,
  REVIEW_COUNTS,
  UNEXPORTED_REVIEWS,
  UPSERT_REVIEW,
} from "./reviews.sql";
import type { ReviewEntry, ReviewSnapshot, Verdict } from "../feedback/format";

/**
 * Avis de l'utilisateur sur ce que le modèle a proposé.
 *
 * L'application ne peut s'améliorer que si l'on sait où elle se trompe, et un
 * reproche formulé sur le moment vaut mieux qu'un souvenir. Chaque avis fige
 * la proposition jugée : une correction faite ensuite rendrait le retour
 * incompréhensible à la relecture.
 */

export interface Verdicts {
  theme: Verdict;
  tags: Verdict;
  media: Verdict;
  summary: Verdict;
}

export const NO_VERDICT: Verdicts = {
  theme: null,
  tags: null,
  media: null,
  summary: null,
};

interface ReviewRow {
  id: string;
  bookmark_id: string;
  created_at: number;
  theme_verdict: Verdict;
  tags_verdict: Verdict;
  media_verdict: Verdict;
  summary_verdict: Verdict;
  comment: string | null;
  snapshot: string;
}

function rowToEntry(row: ReviewRow): ReviewEntry {
  let snapshot: ReviewSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot) as ReviewSnapshot;
  } catch {
    // Une copie illisible ne doit pas faire échouer tout l'export : le
    // verdict et le commentaire, eux, restent exploitables.
    snapshot = {
      url: "",
      title: null,
      sourceKind: "inconnu",
      subject: null,
      theme: null,
      tags: [],
      assets: [],
      summary: null,
      modelId: "inconnu",
    };
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    themeVerdict: row.theme_verdict,
    tagsVerdict: row.tags_verdict,
    mediaVerdict: row.media_verdict,
    summaryVerdict: row.summary_verdict,
    comment: row.comment,
    snapshot,
  };
}

/**
 * Identifiants des favoris analysés qui n'ont pas encore été jugés.
 *
 * Un favori dont l'analyse n'a pas abouti est inclus : « le modèle n'a rien
 * proposé » est un retour aussi utile qu'un mauvais classement.
 */
export async function pendingReviewIds(limit = 20): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(PENDING_REVIEWS, [limit]);
  return rows.map((r) => r.id);
}

export async function countPendingReviews(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(COUNT_PENDING_REVIEWS);
  return row?.n ?? 0;
}

export async function saveReview(
  bookmarkId: string,
  verdicts: Verdicts,
  comment: string | null,
  snapshot: ReviewSnapshot,
): Promise<void> {
  const db = await getDb();
  const trimmed = (comment ?? "").trim();
  await db.runAsync(UPSERT_REVIEW,
    [
      Crypto.randomUUID(),
      bookmarkId,
      Date.now(),
      verdicts.theme,
      verdicts.tags,
      verdicts.media,
      verdicts.summary,
      trimmed.length > 0 ? trimmed : null,
      JSON.stringify(snapshot),
    ],
  );
}

/** Avis pas encore transmis, du plus ancien au plus récent. */
export async function unexportedReviews(): Promise<ReviewEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReviewRow>(UNEXPORTED_REVIEWS);
  return rows.map(rowToEntry);
}

export async function allReviews(): Promise<ReviewEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReviewRow>(ALL_REVIEWS);
  return rows.map(rowToEntry);
}

/**
 * Marque des avis comme transmis.
 *
 * Appelé seulement après un partage effectif : marquer avant laisserait un
 * retour perdu si l'utilisateur annule la feuille de partage.
 */
export async function markExported(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(
    `UPDATE reviews SET exported_at = ? WHERE id IN (${placeholders})`,
    [Date.now(), ...ids],
  );
}

export async function reviewCounts(): Promise<{
  total: number;
  unexported: number;
}> {
  const db = await getDb();
  const row =
    await db.getFirstAsync<{ total: number; unexported: number }>(REVIEW_COUNTS);
  return { total: row?.total ?? 0, unexported: row?.unexported ?? 0 };
}
