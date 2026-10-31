/**
 * Ce que montrent les images et ce que dit le son d'une publication.
 *
 * Demande du 31 octobre : « dès que la légende est vide ou pas bonne, le
 * lien atterrit au mauvais endroit ». Une publication Instagram, c'est
 * d'abord une image ou une vidéo ; la légende n'en est qu'un commentaire,
 * souvent absent. Le modèle multimodal regarde donc les photos et quelques
 * images-clés des vidéos, écoute leur son, et en écrit une description qui
 * rejoint le texte soumis au classement et au résumé.
 *
 * Module pur : testable hors appareil.
 */

export const MAX_PERCEPTION_CHARS = 1200;
export const MAX_IMAGES = 3;
export const MAX_FRAMES = 3;
export const MAX_AUDIO_SECONDS = 30;

export const PERCEIVE_SYSTEM_PROMPT =
  "Tu décris des contenus enregistrés par l'utilisateur, en français, de façon factuelle et concrète. " +
  "Tu ne commences jamais par une formule d'introduction.";

export function buildPerceivePrompt(input: {
  caption: string | null;
  images: number;
  frames: number;
  audio: boolean;
}): string {
  const what = [
    input.images > 0 ? `${input.images} photo${input.images > 1 ? "s" : ""}` : "",
    input.frames > 0 ? `${input.frames} image${input.frames > 1 ? "s" : ""} tirée${input.frames > 1 ? "s" : ""} d'une vidéo` : "",
    input.audio ? "le son de cette vidéo" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const caption = (input.caption ?? "").trim();
  return `Voici ${what} d'un lien que l'utilisateur a mis de côté.${
    caption ? `\nSa légende, peut-être incomplète ou hors sujet : « ${caption.slice(0, 400)} »` : "\nIl n'a pas de légende."
  }

Décris en 3 à 6 phrases ce dont il s'agit vraiment :
- le sujet principal, les objets, produits, animaux, plats ou lieux visibles, avec leur nom précis si tu le reconnais ;
- le texte écrit sur les images, s'il apporte quelque chose ;${input.audio ? "\n- ce qui est dit dans la vidéo, résumé (pas la musique) ;" : ""}
- à quoi cela peut servir à l'utilisateur (idée de recette, achat, voyage, bricolage…).`;
}

export function parsePerception(raw: string): string | null {
  const text = raw
    .replace(/```[a-z]*|```/gi, "")
    .replace(/^\s*(voici|il s'agit d'|description\s*:)\s*/i, (m) => (m.toLowerCase().startsWith("il s'agit") ? m : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 20) return null;
  return text.length <= MAX_PERCEPTION_CHARS ? text : `${text.slice(0, MAX_PERCEPTION_CHARS - 1).trimEnd()}…`;
}

/** Contenu soumis au modèle : le texte, puis ce que montrent images et vidéo. */
export function withPerception(content: string | null, perception: string | null | undefined): string | null {
  if (!perception) return content;
  const base = (content ?? "").trim();
  return `${base}${base ? "\n\n" : ""}Ce que montrent les images et la vidéo :\n${perception}`;
}
