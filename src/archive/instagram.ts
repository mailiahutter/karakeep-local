/**
 * Traitement spécifique aux publications Instagram.
 *
 * Instagram sert un mur de connexion aux visiteurs non identifiés, et ses
 * balises `og:` ne contiennent PAS la légende : elles portent une phrase du
 * type « 472 likes, 1 comments - compte le 29 janvier 2021 ». S'en servir
 * comme description produit un favori vide de sens, sans tags ni résumé.
 *
 * Module pur : testable hors appareil.
 */

/** Repère le code d'une publication, quelle que soit la forme de l'adresse. */
export function instagramShortcode(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Page d'intégration officielle. Elle est prévue pour être affichée sur des
 * sites tiers et sert donc la légende sans exiger de compte — contrairement à
 * la page normale.
 */
export function instagramEmbedUrl(url: string): string | null {
  const code = instagramShortcode(url);
  return code
    ? `https://www.instagram.com/p/${code}/embed/captioned/`
    : null;
}

/**
 * Reconnaît la phrase de statistiques qu'Instagram place dans `og:description`.
 * Ce n'est pas une légende : il faut l'écarter plutôt que l'enregistrer.
 */
export function isStatsBoilerplate(text: string | null): boolean {
  if (!text) return false;
  return /^\s*[\d\s.,kmKM]+\s*likes?\s*,\s*[\d\s.,kmKM]+\s*comments?\s*-/i.test(
    text,
  );
}

/** Signes d'un mur de connexion plutôt que du contenu attendu. */
export function looksLikeLoginWall(
  title: string | null,
  content: string,
): boolean {
  const haystack = `${title ?? ""}\n${content}`.toLowerCase();
  const markers = [
    "découvrez cette publication dans l",
    "voir cette publication dans l",
    "see this post in",
    "view this post on instagram",
    "connectez-vous pour voir",
    "log in to see",
    "sign up to see",
    "identifiez-vous",
  ];
  if (markers.some((m) => haystack.includes(m))) return true;
  // Une page Instagram réduite à « Instagram » et quelques mots n'a rien servi.
  return haystack.trim().length < 40;
}

/**
 * Les hashtags d'une légende sont des tags déjà choisis par l'auteur : plus
 * fiables que ce qu'un petit modèle déduirait, et gratuits.
 */
export function hashtagsFrom(caption: string): string[] {
  const found = caption.match(/#[\p{L}\p{N}_]{2,40}/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const tag = raw.slice(1);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Légende débarrassée de ses hashtags et de ses espaces superflus. */
export function captionWithoutHashtags(caption: string): string {
  return caption
    .replace(/#[\p{L}\p{N}_]{2,40}/gu, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Instagram sert la même image en plusieurs résolutions et y ajoute avatars et
 * icônes. On ne veut ni doublons ni vignettes de profil.
 */
export function isJunkMedia(url: string): boolean {
  // Avatars et miniatures de profil : tailles carrées imposées dans le chemin.
  if (/\/s(?:150x150|320x320|[0-9]{2}x[0-9]{2})\//.test(url)) return true;
  if (/profile_pic|_a\.jpg|\/t51\.2885-19\//.test(url)) return true;
  return false;
}

/**
 * Identité d'un média, indépendante de sa résolution : Instagram place
 * l'identifiant dans le nom de fichier, entouré de variantes de taille.
 */
export function mediaIdentity(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() ?? u.pathname;
    // 123456789_987654321_1234567890123456789_n.jpg -> on garde les nombres
    const m = file.match(/(\d{10,})_(\d{10,})/);
    if (m) return `${m[1]}_${m[2]}`;
    return file;
  } catch {
    return url;
  }
}

export interface MediaCandidate {
  url: string;
  width: number;
  height: number;
}

/** Dédoublonne un carrousel en gardant la plus haute résolution de chaque média. */
export function pickCarousel(
  candidates: MediaCandidate[],
  max = 10,
): MediaCandidate[] {
  const best = new Map<string, MediaCandidate>();
  for (const c of candidates) {
    if (!c.url || isJunkMedia(c.url)) continue;
    const key = mediaIdentity(c.url);
    const current = best.get(key);
    if (!current || c.width * c.height > current.width * current.height) {
      best.set(key, c);
    }
  }
  return [...best.values()].slice(0, max);
}
