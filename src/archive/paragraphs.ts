/**
 * Découpe d'un texte extrait en passages surlignables.
 *
 * Module pur : testable hors appareil.
 */

/** Un passage trop court (« Partager », « 3 min ») ne vaut pas d'être surligné. */
const MIN_CHARS = 2;

export function splitParagraphs(text: string | null): string[] {
  return (text ?? "")
    .split(/\n{2,}|\r\n\r\n/)
    .flatMap((block) => {
      const t = block.trim();
      // Un bloc très long sans saut de paragraphe est recoupé ligne à ligne.
      return t.length > 1200 ? t.split(/\n/) : [t];
    })
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length >= MIN_CHARS);
}

/** Clé de comparaison stable : un surlignage survit aux espaces modifiés. */
export function passageKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
