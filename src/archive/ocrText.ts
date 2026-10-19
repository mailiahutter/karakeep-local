/**
 * Mise en forme du texte lu dans les images.
 *
 * Module pur : testable hors appareil.
 */

/** Au-delà, le texte des images noierait celui de la légende. */
export const MAX_OCR_CHARS = 2500;

/**
 * Assemble le texte des différentes images : lignes nettoyées, doublons
 * retirés — un carrousel répète souvent le même bandeau d'une image à
 * l'autre — et longueur bornée.
 */
export function mergeOcr(texts: (string | null | undefined)[], max = MAX_OCR_CHARS): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const text of texts) {
    for (const raw of (text ?? "").split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      // Une ligne d'un ou deux caractères est presque toujours du bruit :
      // un logo, une icône, un fragment de bordure.
      if (line.length < 3) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  const joined = lines.join("\n");
  return joined.length <= max ? joined : `${joined.slice(0, max - 1).trimEnd()}…`;
}

/** Contenu soumis au modèle : le texte de la page, puis celui des images. */
export function withOcr(content: string | null, ocr: string | null | undefined): string | null {
  if (!ocr) return content;
  const base = (content ?? "").trim();
  return `${base}${base ? "\n\n" : ""}Texte lu dans les images :\n${ocr}`;
}
