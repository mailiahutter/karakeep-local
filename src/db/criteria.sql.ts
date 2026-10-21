/**
 * Liens qui font foi pour apprendre les critères d'un tiroir. Isolé pour
 * être joué dans les tests contre un vrai SQLite.
 *
 * « Fait foi » : rangé à la main, validé dans « À vérifier », ou jugé bon
 * dans la relecture.
 */
const TRUSTED = `
  b.archived = 0
  AND (b.theme_source = 'human' OR b.verified_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM reviews r WHERE r.bookmark_id = b.id AND r.theme_verdict = 'good'))`;

export const TRUSTED_FOR_THEME = `
  SELECT COALESCE(b.subject, b.title) AS text FROM bookmarks b
   WHERE b.theme_id = ? AND ${TRUSTED} AND COALESCE(b.subject, b.title) IS NOT NULL
   ORDER BY b.updated_at DESC LIMIT ?`;

export const TRUSTED_FOR_SUBTHEME = `
  SELECT COALESCE(b.subject, b.title) AS text FROM bookmarks b
   WHERE b.subtheme_id = ? AND ${TRUSTED} AND COALESCE(b.subject, b.title) IS NOT NULL
   ORDER BY b.updated_at DESC LIMIT ?`;

export const COUNT_TRUSTED_BY_THEME = `
  SELECT b.theme_id AS id, COUNT(*) AS n FROM bookmarks b
   WHERE b.theme_id IS NOT NULL AND ${TRUSTED} GROUP BY b.theme_id`;

export const COUNT_TRUSTED_BY_SUBTHEME = `
  SELECT b.subtheme_id AS id, COUNT(*) AS n FROM bookmarks b
   WHERE b.subtheme_id IS NOT NULL AND ${TRUSTED} GROUP BY b.subtheme_id`;

/**
 * Ce que l'utilisateur a retiré d'un tiroir : l'IA l'y avait mis (la copie
 * figée dans l'avis le dit), il l'a jugé faux et rangé ailleurs.
 * `?` : le nom affiché du tiroir, tel qu'il apparaît au début de la copie.
 */
export const REMOVED_FROM = `
  SELECT COALESCE(b.subject, b.title) AS text FROM reviews r
    JOIN bookmarks b ON b.id = r.bookmark_id
   WHERE r.theme_verdict = 'bad'
     AND (json_extract(r.snapshot, '$.theme') = ? OR json_extract(r.snapshot, '$.theme') LIKE ? || ' › %')
     AND COALESCE(b.theme_id, '') <> ?
     AND COALESCE(b.subject, b.title) IS NOT NULL
   ORDER BY r.created_at DESC LIMIT ?`;
