/**
 * Empreinte courte d'un texte (FNV-1a sur 32 bits). Sert à savoir si un texte
 * a changé depuis un calcul mis en cache — pas à la sécurité.
 *
 * Module pur : testable hors appareil.
 */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
