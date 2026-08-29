/**
 * Requêtes des avis, isolées du reste pour être jouées telles quelles dans les
 * tests contre un vrai SQLite. Une erreur de syntaxe ou une jointure fautive
 * ne se verrait sinon qu'à l'exécution sur l'appareil.
 */

/** Favoris analysés qui n'ont pas encore été jugés. */
export const PENDING_REVIEWS = `
  SELECT b.id FROM bookmarks b
  LEFT JOIN reviews r ON r.bookmark_id = b.id
  WHERE b.archived = 0
    AND b.ai_status IN ('success', 'error', 'skipped')
    AND r.id IS NULL
  ORDER BY b.created_at DESC
  LIMIT ?`;

export const COUNT_PENDING_REVIEWS = `
  SELECT COUNT(*) AS n FROM bookmarks b
  LEFT JOIN reviews r ON r.bookmark_id = b.id
  WHERE b.archived = 0
    AND b.ai_status IN ('success', 'error', 'skipped')
    AND r.id IS NULL`;

/**
 * Un second avis sur le même favori remplace le premier — et redevient à
 * transmettre : se raviser doit pouvoir m'être signalé.
 */
export const UPSERT_REVIEW = `
  INSERT INTO reviews
    (id, bookmark_id, created_at, theme_verdict, tags_verdict,
     media_verdict, summary_verdict, comment, snapshot, exported_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(bookmark_id) DO UPDATE SET
    created_at      = excluded.created_at,
    theme_verdict   = excluded.theme_verdict,
    tags_verdict    = excluded.tags_verdict,
    media_verdict   = excluded.media_verdict,
    summary_verdict = excluded.summary_verdict,
    comment         = excluded.comment,
    snapshot        = excluded.snapshot,
    exported_at     = NULL`;

export const UNEXPORTED_REVIEWS =
  "SELECT * FROM reviews WHERE exported_at IS NULL ORDER BY created_at ASC";

export const ALL_REVIEWS = "SELECT * FROM reviews ORDER BY created_at ASC";

export const REVIEW_COUNTS = `
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN exported_at IS NULL THEN 1 ELSE 0 END) AS unexported
  FROM reviews`;
