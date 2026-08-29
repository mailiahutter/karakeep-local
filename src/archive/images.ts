/**
 * Choix des images à conserver pour une page web.
 *
 * Deux défauts constatés sur une même fiche : un bandeau de moyens de paiement
 * (« 3D Secure », Visa, Mastercard) enregistré comme illustration, et la photo
 * mise en avant par le site — celle qui sert de vignette — absente des images.
 *
 * La cause est commune : on triait `document.images` par surface, sans regarder
 * ni d'où venait l'image ni ce qu'elle représentait, et l'image d'ouverture
 * déclarée en `og:image` n'était pas une balise `<img>` du document, donc
 * n'entrait jamais dans le tri.
 *
 * Module pur : testable hors appareil.
 */

/** Où se trouvait l'image dans la page. */
export type ImageZone = "main" | "chrome" | "other";

export interface ImageCandidate {
  url: string;
  width: number;
  height: number;
  alt: string | null;
  /** `chrome` : en-tête, pied de page, navigation — jamais le sujet. */
  zone?: ImageZone;
}

/**
 * Mots qui trahissent un ornement plutôt qu'une illustration : logos, badges
 * de paiement, boutons de partage, avatars, pixels de suivi.
 *
 * Ils sont cherchés dans l'adresse et dans le texte alternatif, entre
 * séparateurs, pour qu'un nom de dossier comme `/logos/` compte mais qu'un
 * article sur les « logos » n'écarte pas sa propre photo.
 */
const JUNK_WORDS = [
  "logo",
  "logos",
  "icon",
  "icone",
  "icones",
  "favicon",
  "sprite",
  "badge",
  "badges",
  "picto",
  "pictogramme",
  "avatar",
  "placeholder",
  "spacer",
  "pixel",
  "tracking",
  "share",
  "partage",
  "social",
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "whatsapp",
  "pinterest",
  "tiktok",
  "youtube",
  "paiement",
  "payment",
  "paypal",
  "visa",
  "mastercard",
  "maestro",
  "amex",
  "cb",
  "3dsecure",
  "3d-secure",
  "securecode",
  "verifiedby",
  "trustpilot",
  "stripe",
  "klarna",
  "livraison",
  "shipping",
  "colissimo",
  "chronopost",
  "dhl",
  "ups",
  "banniere",
  "banner",
  "watermark",
  "flag",
  "drapeau",
];

/** Découpe une adresse ou un texte en mots comparables. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isJunkImage(url: string, alt: string | null): boolean {
  // Seul le chemin compte : un nom de domaine comme `cdn.visa-shop.fr`
  // n'indique rien sur l'image elle-même.
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Adresse relative ou malformée : on la prend telle quelle.
  }
  const found = new Set([...words(path), ...words(alt ?? "")]);
  // « 3dsecure » et « 3d-secure » se réduisent tous deux à « 3d » + « secure ».
  if (found.has("3d") && found.has("secure")) return true;
  return JUNK_WORDS.some((w) => found.has(w));
}

/**
 * Une illustration a des proportions raisonnables. Un bandeau très allongé ou
 * une colonne très étroite sont des éléments de mise en page.
 */
export function hasUsableShape(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return true; // dimensions inconnues : on n'exclut pas
  if (width < 200 || height < 150) return false;
  const ratio = width / height;
  return ratio <= 4 && ratio >= 0.25;
}

/** Deux adresses désignent-elles la même image ? */
function identity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export interface PickOptions {
  /** Image d'ouverture déclarée par le site (`og:image`). */
  ogImage?: string | null;
  max: number;
}

/**
 * Retient les images qui valent d'être conservées, la plus représentative
 * d'abord.
 *
 * L'`og:image` passe en tête sans condition de taille ou de zone : c'est le
 * choix explicite du site, et c'est déjà celle que l'application affiche en
 * vignette. Ne pas la conserver revenait à montrer une photo qui disparaît si
 * le site ferme — exactement ce que l'archivage doit empêcher.
 */
export function pickImages(
  candidates: ImageCandidate[],
  { ogImage, max }: PickOptions,
): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();

  const take = (image: ImageCandidate): void => {
    const key = identity(image.url);
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(image);
  };

  if (ogImage) {
    take({ url: ogImage, width: 0, height: 0, alt: null, zone: "main" });
  }

  const usable = candidates.filter(
    (c) =>
      c.zone !== "chrome" &&
      !isJunkImage(c.url, c.alt) &&
      hasUsableShape(c.width, c.height),
  );

  // Le corps de l'article d'abord, puis la surface : une petite image dans
  // l'article dit plus du sujet qu'une grande image de barre latérale.
  const ranked = [...usable].sort((a, b) => {
    const zone = Number(b.zone === "main") - Number(a.zone === "main");
    if (zone !== 0) return zone;
    return b.width * b.height - a.width * a.height;
  });

  for (const image of ranked) take(image);
  return out;
}
