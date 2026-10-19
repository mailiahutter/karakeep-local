/**
 * Liens dont le rangement fait foi : corrigés à la main, ou proposés par le
 * modèle et validés dans le récapitulatif. Les plus récents d'abord — ils
 * reflètent l'idée que l'utilisateur se fait aujourd'hui de ses thèmes.
 *
 * Isolé pour être joué dans les tests contre un vrai SQLite.
 */
export const CLASSIFICATION_EXAMPLES = `
  SELECT b.id, b.title, b.subject, b.theme_id, b.subtheme_id
    FROM bookmarks b
    LEFT JOIN reviews r ON r.bookmark_id = b.id
   WHERE b.theme_id IS NOT NULL
     AND b.id <> ?
     AND (b.theme_source = 'human' OR r.theme_verdict = 'good')
   ORDER BY COALESCE(r.created_at, b.updated_at) DESC
   LIMIT ?`;
