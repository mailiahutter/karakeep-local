/**
 * Normalisation d'URL et repérage d'un lien dans un texte partagé.
 *
 * Module pur : testable hors appareil, aucun import React Native.
 */

/** Paramètres de suivi publicitaire, retirés pour que le dédoublonnage marche. */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref_src",
  "ref_url",
];

/**
 * Normalise une URL pour que deux partages de la même page se retrouvent sur un
 * seul favori. Volontairement conservateur : ni le chemin ni la casse de la
 * query ne sont touchés, seulement le bruit connu.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Pas une URL absolue : on tente en https, sinon on rend la chaîne telle quelle.
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return trimmed;
    }
  }
  parsed.hash = "";
  for (const p of TRACKING_PARAMS) {
    parsed.searchParams.delete(p);
  }
  parsed.hostname = parsed.hostname.toLowerCase();

  let out = parsed.toString();
  // Une barre oblique finale sur la racine ne distingue pas deux pages.
  if (parsed.pathname === "/" && !parsed.search && out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

/** Extrait la première URL d'un texte partagé (souvent « titre — https://… »). */
export function extractUrl(shared: string): string | null {
  const match = shared.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (match) {
    // La ponctuation finale d'une phrase n'appartient pas au lien.
    return match[0].replace(/[.,;:!?]+$/, "");
  }
  const bare = shared.trim();
  // Un domaine nu partagé sans schéma reste exploitable.
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(bare)) return bare;
  return null;
}

/** Nom d'hôte lisible, pour afficher la source d'un favori. */
export function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
