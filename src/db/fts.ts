/**
 * Construction des expressions FTS5.
 *
 * Module pur : testable hors appareil.
 */

/**
 * Transforme une saisie libre en expression FTS5 valide.
 *
 * Indispensable : une apostrophe, un guillemet ou un `AND` isolé tapé par
 * l'utilisateur ferait échouer le MATCH et la recherche renverrait une erreur
 * SQLite au lieu de résultats.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  return tokens
    .map((t, i) => {
      const quoted = `"${t.replace(/"/g, '""')}"`;
      // Préfixe sur le dernier terme : les résultats réagissent pendant la frappe.
      return i === tokens.length - 1 ? `${quoted}*` : quoted;
    })
    .join(" AND ");
}
