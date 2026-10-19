/**
 * Ce qui s'est passé depuis la dernière visite. Isolé pour être joué dans
 * les tests contre un vrai SQLite.
 */
export const ACTIVITY_SINCE = `
  SELECT
    SUM(CASE WHEN analysed_at > ? AND theme_id IS NOT NULL THEN 1 ELSE 0 END) AS filed,
    SUM(CASE WHEN analysed_at > ? AND theme_id IS NULL THEN 1 ELSE 0 END) AS unfiled,
    SUM(CASE WHEN source_gone = 1 AND updated_at > ? THEN 1 ELSE 0 END) AS gone,
    SUM(CASE WHEN fetch_status IN ('pending', 'running') OR ai_status IN ('pending', 'running')
             THEN 1 ELSE 0 END) AS remaining
  FROM bookmarks
  WHERE archived = 0`;

/** Phrase de bilan, ou `null` s'il n'y a rien à dire. Pure. */
export function recapSentence(a: {
  filed: number;
  unfiled: number;
  gone: number;
  remaining: number;
}): string | null {
  const parts: string[] = [];
  if (a.filed > 0) parts.push(`${a.filed} lien${a.filed > 1 ? "s" : ""} rangé${a.filed > 1 ? "s" : ""}`);
  if (a.unfiled > 0) parts.push(`${a.unfiled} sans thème évident`);
  if (a.gone > 0) parts.push(`${a.gone} source${a.gone > 1 ? "s" : ""} disparue${a.gone > 1 ? "s" : ""} (sauvegarde conservée)`);
  if (parts.length === 0) return null;
  const tail = a.remaining > 0 ? ` · ${a.remaining} encore en file` : " · tout est à jour";
  return `Depuis ta dernière visite : ${parts.join(" · ")}${tail}`;
}
