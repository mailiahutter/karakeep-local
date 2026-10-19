/**
 * Remise en file de tout ce qui n'a pas abouti.
 *
 * Isolé pour être joué dans les tests contre un vrai SQLite, comme les
 * requêtes des avis.
 *
 * Trois cas pour l'extraction : un échec, un arrêt en plein travail, ou une
 * réussite qui n'a rien rapporté — ni texte ni média, la fiche est vide.
 * Pour l'analyse : un échec, une étape sautée faute de modèle, un arrêt, ou
 * une réussite à laquelle il manque le rangement, le résumé ou la lecture du
 * sujet. Tout lien dont l'extraction repart est aussi réanalysé : son
 * contenu va changer.
 *
 * Un rangement fait à la main ne risque rien : la file ne le défait jamais.
 */

export const REQUEUE_FETCH = `
  UPDATE bookmarks
     SET fetch_status = 'pending', fetch_attempts = 0, fetch_error = NULL
   WHERE archived = 0
     AND (
       fetch_status IN ('error', 'running')
       OR (fetch_status = 'success'
           AND (content IS NULL OR trim(content) = '')
           AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.bookmark_id = bookmarks.id))
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
