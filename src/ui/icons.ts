/**
 * Icônes de thème : emoji du clavier, ou nom d'Ionicons hérité.
 *
 * Une liste fermée d'icônes ne couvrira jamais ce que les gens rangent — il y
 * manquait les animaux, la tente, et tout le reste. Le clavier emoji est déjà
 * complet et déjà connu. Les thèmes créés avant ce changement portent un nom
 * d'Ionicons : ils doivent continuer de s'afficher.
 */

/**
 * Un nom d'Ionicons ne contient que des minuscules et des tirets
 * (`bus-outline`). Tout le reste est du texte à afficher tel quel.
 */
export function isIoniconName(icon: string | null | undefined): boolean {
  return typeof icon === "string" && /^[a-z][a-z0-9-]*$/.test(icon);
}

/** Quelques départs rapides ; le clavier reste la vraie bibliothèque. */
export const QUICK_EMOJI = [
  "📁", "🍽️", "🥗", "🍰", "🗺️", "⛺", "🏕️", "🏍️", "🚐", "🚗",
  "🏠", "🔧", "🪛", "🌱", "🐕", "🐈", "🐴", "🐔", "🎣", "🚴",
  "🏋️", "🎸", "📷", "✈️", "💰", "💡", "📚", "🧵", "🍺", "⚡",
];

/**
 * Ne garde qu'une icône affichable à partir d'une saisie libre.
 *
 * Un emoji peut occuper plusieurs unités de code — drapeaux, familles, teintes
 * de peau — donc on ne peut pas simplement couper au premier caractère. On
 * borne, et on refuse ce qui n'est manifestement pas une icône : du texte.
 */
export function normalizeIconInput(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  // Une suite de lettres ou de chiffres est un mot, pas une icône.
  if (/^[\p{L}\p{N}\s]+$/u.test(text)) return null;
  return text.length <= 12 ? text : Array.from(text)[0];
}
