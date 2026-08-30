import {
  jsonCandidates,
  preprocessContent,
  sanitizeTags,
  stripBoilerplate,
  tagStyleInstruction,
  type TagStyle,
} from "./prompt.ts";

/**
 * Première étape de l'analyse : « de quoi parle ce document ? »
 *
 * Le classement demandait au modèle de choisir un numéro parmi vingt et une
 * catégories en lisant directement le texte brut d'une page web — menus,
 * mentions légales, bandeaux de cookies compris. C'est deux tâches
 * difficiles d'un coup : comprendre le sujet, et le situer dans une
 * arborescence.
 *
 * On les sépare. Ici, une seule question, facile pour un petit modèle :
 * résumer le sujet en une phrase et donner des mots-clés. Le résultat sert
 * ensuite d'entrée au classement — court, propre, sans bruit — et fournit au
 * passage les tags, qui n'ont jamais eu d'autre raison d'être que d'aider au
 * rangement.
 *
 * Module pur : testable hors appareil.
 */

export interface Digest {
  /** Une phrase disant de quoi il s'agit concrètement. */
  subject: string;
  keywords: string[];
}

export const DIGEST_SYSTEM_PROMPT =
  "Tu analyses des pages web et des publications. Tu réponds uniquement par " +
  "un objet JSON, sans phrase d'introduction.";

export const DIGEST_JSON_SCHEMA = {
  type: "object",
  properties: {
    sujet: { type: "string" },
    motscles: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: ["sujet", "motscles"],
} as const;

export function buildDigestPrompt(input: {
  title: string | null;
  description: string | null;
  content: string | null;
  url: string;
  language: string;
  tagStyle: TagStyle;
  maxContentChars?: number;
}): string {
  const {
    title,
    description,
    content,
    url,
    language,
    tagStyle,
    maxContentChars = 2000,
  } = input;

  const document = [
    title ? `Titre : ${title}` : "",
    description ? `Description : ${description}` : "",
    `Adresse : ${url}`,
    content
      ? preprocessContent(stripBoilerplate(content)).slice(0, maxContentChars)
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Lis le DOCUMENT et dis de quoi il parle.

<DOCUMENT>
${document}
</DOCUMENT>

Réponds par un objet JSON :
{"sujet": "…", "motscles": ["…", "…", "…"]}

- "sujet" : une seule phrase en ${language}, qui nomme la chose concrète dont
  il est question — l'animal, le véhicule, le plat, la pièce de la maison,
  l'outil, le lieu. Pas « un article de blog », pas « une page de boutique » :
  ce dont l'article parle.
- "motscles" : de trois à six mots ou expressions courtes, **en ${language}**.
  Traduis ceux qui apparaissent dans une autre langue dans le document : deux
  liens sur le même sujet doivent porter les mêmes mots. Garde tels quels les
  noms propres — marques, modèles, lieux.
  ${tagStyleInstruction(tagStyle)}

N'écris rien d'autre que l'objet JSON.`;
}

/** Le sujet tient en une phrase : au-delà, le modèle a repris la page. */
const MAX_SUBJECT_CHARS = 220;

export function parseDigest(raw: string): Digest | null {
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const digest = readDigest(parsed);
      if (digest) return digest;
    } catch {
      // On essaie le candidat suivant.
    }
  }
  return null;
}

function readDigest(parsed: unknown): Digest | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;

  // Un petit modèle glisse volontiers vers l'anglais malgré la consigne.
  const rawSubject = record.sujet ?? record.subject ?? record.resume;
  const rawKeywords = record.motscles ?? record.keywords ?? record.tags;

  const subject =
    typeof rawSubject === "string"
      ? rawSubject.replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT_CHARS)
      : "";
  const keywords = Array.isArray(rawKeywords)
    ? sanitizeTags(rawKeywords.filter((k): k is string => typeof k === "string"))
    : [];

  // Sans sujet ni mot-clé, il n'y a rien à transmettre à l'étape suivante.
  if (subject.length === 0 && keywords.length === 0) return null;
  return { subject, keywords };
}

/**
 * Ce que voit l'étape de classement.
 *
 * Le titre est conservé tel quel : il est souvent le signal le plus net, et
 * n'a pas transité par le modèle.
 */
export function describeForClassification(
  title: string | null,
  digest: Digest | null,
  fallbackContent: string,
  maxFallbackChars = 800,
): string {
  const parts = [title ? `Titre : ${title}` : ""];
  if (digest) {
    if (digest.subject) parts.push(`Sujet : ${digest.subject}`);
    if (digest.keywords.length > 0) {
      parts.push(`Mots-clés : ${digest.keywords.join(", ")}`);
    }
  } else {
    // L'analyse a échoué : mieux vaut un extrait brut que rien du tout.
    const raw = stripBoilerplate(fallbackContent).slice(0, maxFallbackChars);
    if (raw.trim().length > 0) parts.push(`Extrait : ${raw}`);
  }
  return parts.filter(Boolean).join("\n");
}
