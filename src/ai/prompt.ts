/**
 * Construction du prompt de tagging et lecture de la réponse du modèle.
 *
 * Les consignes sont adaptées de `packages/shared/prompts.ts` et
 * `packages/shared/utils/tag.ts` de Karakeep (AGPL-3.0), resserrées pour un
 * petit modèle quantifié tournant sur téléphone.
 *
 * Module pur : testable hors appareil.
 */

export type TagStyle =
  | "as-generated"
  | "lowercase-hyphens"
  | "lowercase-spaces"
  | "lowercase-underscores"
  | "titlecase-spaces"
  | "titlecase-hyphens"
  | "camelCase";

export function tagStyleInstruction(style: TagStyle): string {
  switch (style) {
    case "lowercase-hyphens":
      return "- Écris les tags en minuscules avec des traits d'union entre les mots (ex. « apprentissage-automatique »).";
    case "lowercase-spaces":
      return "- Écris les tags en minuscules avec des espaces entre les mots (ex. « apprentissage automatique »).";
    case "lowercase-underscores":
      return "- Écris les tags en minuscules avec des tirets bas entre les mots (ex. « apprentissage_automatique »).";
    case "titlecase-spaces":
      return "- Écris les tags avec une majuscule initiale et des espaces (ex. « Apprentissage Automatique »).";
    case "titlecase-hyphens":
      return "- Écris les tags avec une majuscule initiale et des traits d'union (ex. « Apprentissage-Automatique »).";
    case "camelCase":
      return "- Écris les tags en camelCase (ex. « apprentissageAutomatique »).";
    case "as-generated":
    default:
      return "";
  }
}

/** Réduit les suites d'espaces, qui gonflent le nombre de jetons pour rien. */
export function preprocessContent(content: string): string {
  return content.replace(/(\s)\1{3,}/g, "$1").trim();
}

export interface TaggingPromptInput {
  title: string | null;
  description: string | null;
  content: string | null;
  url: string;
  language: string;
  tagStyle: TagStyle;
  /** Tags déjà utilisés, pour encourager la réutilisation du vocabulaire. */
  existingTags?: string[];
  /** Budget de caractères pour l'extrait de contenu. */
  maxContentChars?: number;
}

export const SYSTEM_PROMPT =
  "Tu es un assistant de classement documentaire. Tu réponds uniquement par un objet JSON valide, sans texte autour et sans bloc de code.";

export function buildTaggingPrompt(input: TaggingPromptInput): string {
  const {
    title,
    description,
    content,
    url,
    language,
    tagStyle,
    existingTags = [],
    // ~4 caractères par jeton : 6 000 caractères tiennent largement dans une
    // fenêtre de 4096 jetons avec la consigne et la réponse.
    maxContentChars = 6000,
  } = input;

  const style = tagStyleInstruction(tagStyle);
  const reuse =
    existingTags.length > 0
      ? `- Réutilise en priorité ces tags déjà présents dans la bibliothèque quand ils conviennent : ${existingTags.join(", ")}.`
      : "";

  const body = preprocessContent(
    [
      title ? `Titre : ${title}` : "",
      description ? `Description : ${description}` : "",
      `Adresse : ${url}`,
      content ? `\n${content.slice(0, maxContentChars)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `Analyse le DOCUMENT ci-dessous et propose des tags décrivant ses thèmes principaux.

Règles :
- Privilégie les tags concrets et durables : technologies, produits, projets, domaines, concepts importants.
- Les tags doivent être en ${language}.
- Chaque tag fait 1 à 3 mots. Pas de phrase, pas de parenthèses, pas d'exemples entre virgules dans un tag.
- Ignore tout ce qui relève de la page elle-même : menus, bandeau cookies, mentions légales, pied de page.
- Si le document est une page d'erreur, une vérification anti-robot, un mur de connexion ou une page vide, renvoie une liste vide.
- Vise 3 à 5 tags. S'il n'y a rien de pertinent, renvoie une liste vide.
${style}
${reuse}

<DOCUMENT>
${body}
</DOCUMENT>

Réponds exclusivement par un objet JSON de la forme {"tags": ["…", "…"]}.`;
}

/** Schéma imposé au décodeur pour que la sortie soit du JSON exploitable. */
export const TAGS_JSON_SCHEMA = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
  },
  required: ["tags"],
} as const;

/**
 * Isole un objet JSON dans une réponse potentiellement bavarde.
 *
 * Même avec une grammaire imposée, un petit modèle peut préfixer sa réponse ou
 * l'entourer d'un bloc de code : on ne veut pas perdre un tagging pour ça.
 */
export function parseTagsResponse(raw: string): string[] {
  const candidates: string[] = [];

  const trimmed = raw.trim();
  candidates.push(trimmed);

  // Bloc de code markdown éventuel.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  // Première région accolades équilibrées.
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(trimmed.slice(start, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const tags = extractTagArray(parsed);
      if (tags) return tags;
    } catch {
      // On essaie le candidat suivant.
    }
  }

  return [];
}

function extractTagArray(parsed: unknown): string[] | null {
  if (Array.isArray(parsed)) {
    return parsed.filter((t): t is string => typeof t === "string");
  }
  if (parsed && typeof parsed === "object") {
    const tags = (parsed as { tags?: unknown }).tags;
    if (Array.isArray(tags)) {
      return tags.filter((t): t is string => typeof t === "string");
    }
  }
  return null;
}

/** Nettoyage final avant écriture en base. */
export function sanitizeTags(tags: string[], max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/^["'«»\s]+|["'«»\s.,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (tag.length === 0 || tag.length > 60) continue;
    // Une « phrase » n'est pas un tag : le modèle a débordé de la consigne.
    if (tag.split(/\s+/).length > 4) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
