/**
 * Remise en file de tout ce qui n'a pas abouti.
 *
 * Isolé pour être joué dans les tests contre un vrai SQLite, comme les
 * requêtes des avis.
 *
 * Pour l'extraction : un échec, un arrêt en plein travail, une réussite qui
 * n'a rien rapporté — ni texte ni média —, une source déclarée disparue, ou
 * une publication Instagram sans photo ni vidéo.
 * Pour l'analyse : un échec, une étape sautée faute de modèle, un arrêt, ou
 * une réussite à laquelle il manque le rangement, le résumé ou la lecture du
 * sujet. Tout lien dont l'extraction repart est aussi réanalysé : son
 * contenu va changer.
 *
 * Un rangement fait à la main ne risque rien : la file ne le défait jamais.
 */

export const REQUEUE_FETCH = `
  UPDATE bookmarks
     SET fetch_status = 'pending', fetch_attempts = 0, fetch_error = NULL,
         retry_days = 0, next_fetch_at = NULL, source_gone = 0
   WHERE archived = 0
     AND (
       fetch_status IN ('error', 'running')
       OR (fetch_status = 'success'
           AND (content IS NULL OR trim(content) = '')
           AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.bookmark_id = bookmarks.id))
       OR source_gone = 1
       -- Une publication Instagram sans photo ni vidéo n'a pas été vraiment lue.
       OR (source_kind = 'instagram'
           AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.bookmark_id = bookmarks.id
                             AND a.kind IN ('image', 'video')))
     )`;

export const REQUEUE_AI = `
  UPDATE bookmarks
     SET ai_status = 'pending', ai_error = NULL
   WHERE archived = 0
     AND (
       fetch_status = 'pending'
       OR ai_status IN ('error', 'skipped', 'running')
       OR (ai_status = 'success'
           AND (theme_id IS NULL
                OR summary IS NULL OR trim(summary) = ''
                OR subject IS NULL OR trim(subject) = ''))
     )`;
