/**
 * Requêtes du tri du matin. Isolées pour être jouées dans les tests contre
 * un vrai SQLite.
 */

/**
 * Idées à vérifier : rangées par l'IA sans assez de certitude, ou pas
 * rangées du tout. La plus douteuse d'abord. Une certitude non mesurée
 * (analyse antérieure) ne compte pas comme un doute : elle sera mesurée à la
 * prochaine analyse.
 */
export const DOUBTS = `
  SELECT id FROM bookmarks
   WHERE archived = 0
     AND ai_status = 'success'
     AND verified_at IS NULL
     AND (theme_source IS NULL OR theme_source <> 'human')
     AND (theme_id IS NULL OR (ai_confidence IS NOT NULL AND ai_confidence < ?))
   ORDER BY CASE WHEN theme_id IS NULL THEN -1 ELSE ai_confidence END ASC, created_at DESC
   LIMIT ?`;

export const COUNT_DOUBTS = `
  SELECT COUNT(*) AS n FROM bookmarks
   WHERE archived = 0
     AND ai_status = 'success'
     AND verified_at IS NULL
     AND (theme_source IS NULL OR theme_source <> 'human')
     AND (theme_id IS NULL OR (ai_confidence IS NOT NULL AND ai_confidence < ?))`;

/** Rangé seul par l'IA depuis un instant donné, avec assez de certitude. */
export const FILED_SINCE = `
  SELECT id FROM bookmarks
   WHERE archived = 0
     AND ai_status = 'success'
     AND theme_source = 'ai'
     AND theme_id IS NOT NULL
     AND (ai_confidence IS NULL OR ai_confidence >= ?)
     AND analysed_at > ?
   ORDER BY analysed_at DESC
   LIMIT ?`;

/**
 * Tiroirs pour l'accueil : nombre d'idées (hors doutes), nouveautés depuis
 * un instant donné, et photo de couverture — choisie, sinon celle de l'idée
 * la plus récente qui en a une.
 */
export const DRAWERS = `
  SELECT t.id, t.name, t.icon, t.position,
         (SELECT COUNT(*) FROM bookmarks b WHERE b.theme_id = t.id AND b.archived = 0) AS count,
         (SELECT COUNT(*) FROM bookmarks b WHERE b.theme_id = t.id AND b.archived = 0
                AND b.analysed_at > ?) AS fresh,
         COALESCE(
           (SELECT a.path FROM assets a WHERE a.bookmark_id = t.cover_bookmark_id
                AND a.kind IN ('image', 'screenshot') ORDER BY a.kind = 'screenshot', a.created_at LIMIT 1),
           (SELECT a.path FROM bookmarks b JOIN assets a ON a.bookmark_id = b.id
             WHERE b.theme_id = t.id AND b.archived = 0 AND a.kind = 'image'
             ORDER BY b.created_at DESC, a.created_at ASC LIMIT 1)
         ) AS cover
    FROM themes t
   ORDER BY t.position, t.name`;
