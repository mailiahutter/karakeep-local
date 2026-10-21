/**
 * Classement d'un favori dans l'arborescence de thèmes.
 *
 * Le premier essai aplatissait toute l'arborescence en une liste unique — vingt
 * et une entrées avec leurs descriptions — et demandait un numéro. Deux
 * difficultés se cumulaient : tenir vingt et une définitions à la fois, et
 * décider. Un modèle de trois milliards de paramètres n'y arrive pas de façon
 * fiable, et c'est précisément le point qui compte le plus pour l'usage.
 *
 * On descend l'arbre à la place. D'abord le thème parmi six, puis le
 * sous-thème parmi trois ou quatre. Deux questions faciles valent mieux
 * qu'une question difficile, et le prompt de chacune tient en quelques lignes.
 *
 * Module pur : testable hors appareil.
 */

export interface ClassifyOption {
  /** Numéro présenté au modèle, à partir de 1. */
  index: number;
  id: string;
  name: string;
  description: string | null;
  /**
   * Ce que contient la catégorie (ses sous-thèmes). Un intitulé seul est
   * souvent ambigu ; « Chien (harnais, éducation, santé) » ne l'est plus.
   */
  contains?: string[];
}

export interface ThemeTree {
  id: string;
  name: string;
  description?: string | null;
  subthemes: { id: string; name: string; description?: string | null }[];
}

/**
 * Une description trop longue noie la liste et éloigne le document de la
 * consigne finale. On garde une phrase.
 */
export const MAX_DESCRIPTION_CHARS = 140;

function trimDescription(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.length <= MAX_DESCRIPTION_CHARS
    ? text
    : `${text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

/** Premier niveau : les grands thèmes. */
export function buildThemeOptions(themes: ThemeTree[]): ClassifyOption[] {
  return themes.map((theme, i) => ({
    index: i + 1,
    id: theme.id,
    name: theme.name,
    description: trimDescription(theme.description),
    contains: theme.subthemes.map((s) => s.name),
  }));
}

/**
 * Second niveau : les sous-thèmes du thème retenu.
 *
 * Le thème hérite sa description aux sous-thèmes qui n'en ont pas : sans
 * consigne, un intitulé comme « Ma sélection » ne dit rien.
 */
export function buildSubthemeOptions(theme: ThemeTree): ClassifyOption[] {
  return theme.subthemes.map((sub, i) => ({
    index: i + 1,
    id: sub.id,
    name: sub.name,
    description:
      trimDescription(sub.description) ?? trimDescription(theme.description),
  }));
}

export const CLASSIFY_SYSTEM_PROMPT =
  "Tu es un assistant de classement. Tu réponds uniquement par un numéro, " +
  "sans phrase, sans explication.";

/**
 * Construit la question posée au modèle.
 *
 * `noneLabel` change de sens d'un niveau à l'autre : au premier, zéro veut
 * dire « aucun thème ne convient » ; au second, « le thème est bon mais aucun
 * sous-thème ne va ». C'est une issue nécessaire : forcer un choix produit un
 * rangement faux, plus coûteux qu'une absence de rangement.
 */
export function buildChoicePrompt(
  options: ClassifyOption[],
  document: string,
  noneLabel: string,
  examples: ClassifyExample[] = [],
): string {
  const list = options
    .map((o) => {
      const contains = o.contains?.length ? ` (contient : ${o.contains.join(", ")})` : "";
      return o.description
        ? `${o.index}. ${o.name}${contains} — ${o.description}`
        : `${o.index}. ${o.name}${contains}`;
    })
    .join("\n");

  const byId = new Map(options.map((o) => [o.id, o]));
  const shown = examples
    .map((e) => {
      const o = byId.get(e.optionId);
      return o ? `- « ${oneLine(e.text, MAX_EXAMPLE_CHARS)} » → ${o.index}. ${o.name}` : null;
    })
    .filter((line): line is string => line !== null);
  const guide = shown.length
    ? `\nPour t'aider, voici des liens que l'utilisateur a déjà rangés lui-même :\n${shown.join("\n")}\n`
    : "";

  return `Voici la description d'un lien mis de côté.
${guide}
<LIEN>
${document}
</LIEN>

Dans laquelle de ces catégories le ranger ?

${list}
0. ${noneLabel}

Réponds par le seul numéro. N'écris rien d'autre.`;
}

/**
 * Lit le numéro choisi dans une réponse potentiellement bavarde.
 *
 * Un petit modèle préfixe volontiers sa réponse (« La catégorie est : 4 ») ou
 * la justifie. On prend le premier entier plausible.
 */
export function parseChoice(raw: string, maxIndex: number): number | null {
  const cleaned = raw.trim().replace(/```[a-z]*|```/gi, "");
  const match = cleaned.match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isInteger(n) || n < 0 || n > maxIndex) return null;
  return n;
}

/** Traduit le numéro renvoyé en identifiant, ou en absence de choix. */
export function resolveChoice(
  options: ClassifyOption[],
  choice: number | null,
): string | null {
  if (choice === null || choice === 0) return null;
  return options.find((o) => o.index === choice)?.id ?? null;
}

// --- Exemples tirés des corrections --------------------------------------

/**
 * Un lien déjà rangé par l'utilisateur — corrigé à la main, ou proposé par le
 * modèle et validé dans le récapitulatif.
 *
 * C'est la seule source de vérité sur ce qu'il entend par chaque thème : la
 * description d'un thème dit l'intention, les exemples disent l'usage. Les
 * montrer au modèle est le moyen le plus direct de le faire classer comme lui.
 */
export interface ClassifyExample {
  /** Ce que le lien raconte : sujet compris par le modèle, ou titre. */
  text: string;
  /** Option (thème ou sous-thème) où l'utilisateur l'a rangé. */
  optionId: string;
}

export const MAX_EXAMPLE_CHARS = 110;

function oneLine(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Choisit les exemples à montrer : les plus récents d'abord, au plus
 * `perOption` par catégorie pour qu'un thème très fourni n'écrase pas les
 * autres, et `max` en tout pour que le prompt reste court.
 */
export function pickExamples(
  examples: ClassifyExample[],
  options: ClassifyOption[],
  max = 8,
  perOption = 2,
): ClassifyExample[] {
  const allowed = new Set(options.map((o) => o.id));
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const out: ClassifyExample[] = [];
  for (const e of examples) {
    if (out.length >= max) break;
    const text = e.text.trim();
    if (!text || !allowed.has(e.optionId)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    const n = counts.get(e.optionId) ?? 0;
    if (n >= perOption) continue;
    counts.set(e.optionId, n + 1);
    seen.add(key);
    out.push({ text, optionId: e.optionId });
  }
  return out;
}

// --- Pré-tri par proximité de sens ---------------------------------------

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Moyenne de plusieurs vecteurs : le « centre » d'un thème. */
export function centroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  return out.map((x) => x / vectors.length);
}

/**
 * Ne garde que les catégories les plus proches du document.
 *
 * Le petit modèle de langage hésite quand la liste s'allonge ; le modèle de
 * proximité, lui, compare sans fatigue. On lui confie le tri grossier, et on
 * ne pose au modèle de langage qu'un choix entre `keep` candidats, renumérotés
 * à partir de 1. Sans vecteur pour une option, on la garde : mieux vaut une
 * question un peu plus longue qu'un bon thème écarté d'office.
 */
export function shortlist(
  options: ClassifyOption[],
  documentVector: number[] | null,
  optionVectors: Map<string, number[]>,
  keep = 3,
): ClassifyOption[] {
  if (!documentVector || options.length <= keep + 1) return options;
  const scored = options.map((o) => {
    const v = optionVectors.get(o.id);
    return { o, score: v ? cosine(documentVector, v) : Number.POSITIVE_INFINITY };
  });
  const kept = new Set(
    [...scored].sort((a, b) => b.score - a.score).slice(0, keep).map((s) => s.o.id),
  );
  for (const s of scored) if (s.score === Number.POSITIVE_INFINITY) kept.add(s.o.id);
  return options
    .filter((o) => kept.has(o.id))
    .map((o, i) => ({ ...o, index: i + 1 }));
}

// --- Proposer un tiroir --------------------------------------------------

/** Tiroir proposé quand aucun ne convient : à accepter ou modifier. */
export interface ThemeSuggestion {
  name: string;
  emoji: string;
  description: string;
}

export const SUGGEST_SYSTEM_PROMPT =
  "Tu proposes des catégories de rangement courtes et générales. Tu réponds en JSON.";

export const SUGGEST_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    emoji: { type: "string" },
    description: { type: "string" },
  },
  required: ["name", "emoji", "description"],
};

export function buildSuggestPrompt(document: string, existing: string[]): string {
  return `Ce lien ne rentre dans aucune des catégories existantes : ${existing.join(", ") || "aucune"}.

<LIEN>
${document}
</LIEN>

Propose UNE nouvelle catégorie assez large pour accueillir d'autres liens du même genre plus tard — pas un intitulé taillé pour ce seul lien.
- name : un à trois mots, en français, avec une majuscule ;
- emoji : un seul emoji qui l'illustre ;
- description : une phrase qui dit ce qu'on y range.`;
}

/** Un emoji, pas une phrase : on garde le premier graphème non alphabétique. */
function firstEmoji(raw: string): string {
  const match = raw.match(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u);
  return match ? match[0] : "📁";
}

export function parseSuggestion(raw: string): ThemeSuggestion | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2 || name.length > 40) return null;
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      emoji: firstEmoji(typeof o.emoji === "string" ? o.emoji : ""),
      description: typeof o.description === "string" ? o.description.trim().slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}

// --- Vote des plus proches voisins ---------------------------------------

export interface Vote {
  optionId: string;
  /** Part des voisins, pondérée par la proximité, qui désignent cette option. */
  share: number;
  /** Proximité du voisin le plus proche. */
  best: number;
}

/**
 * Où l'utilisateur a-t-il rangé les liens qui ressemblent le plus à celui-ci ?
 *
 * C'est la mémoire de ses corrections, appliquée sans passer par le modèle de
 * langage : si les cinq liens les plus proches sont tous dans « Chien », ce
 * lien y va très probablement aussi — quelle que soit la langue ou la façon
 * dont le petit modèle a résumé.
 */
export function nearestVote(
  documentVector: number[] | null,
  examples: { vector: number[]; optionId: string }[],
  k = 5,
): Vote | null {
  if (!documentVector || examples.length === 0) return null;
  const scored = examples
    .map((e) => ({ optionId: e.optionId, sim: cosine(documentVector, e.vector) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  const weights = new Map<string, number>();
  let total = 0;
  for (const s of scored) {
    const w = Math.max(0, s.sim);
    weights.set(s.optionId, (weights.get(s.optionId) ?? 0) + w);
    total += w;
  }
  if (total <= 0) return null;
  const [optionId, weight] = [...weights.entries()].sort((a, b) => b[1] - a[1])[0];
  return { optionId, share: weight / total, best: scored[0].sim };
}

/** Seuils au-delà desquels le vote des voisins l'emporte sur un modèle hésitant. */
export const VOTE_MIN_SHARE = 0.6;
export const VOTE_MIN_SIMILARITY = 0.55;
export const VOTE_MIN_NEIGHBOURS = 3;

/**
 * Arbitrage entre le modèle de langage et le vote des voisins.
 *
 * Le vote ne remplace le choix du modèle que s'il est net (majorité claire,
 * voisins vraiment proches, assez d'exemples) et que le modèle, lui, hésite
 * ou n'a rien choisi. La certitude retenue est alors celle du vote.
 */
export function arbitrate(
  llm: { id: string | null; confidence: number | null },
  vote: Vote | null,
  neighbours: number,
): { id: string | null; confidence: number | null; byVote: boolean } {
  const strong =
    vote !== null &&
    neighbours >= VOTE_MIN_NEIGHBOURS &&
    vote.share >= VOTE_MIN_SHARE &&
    vote.best >= VOTE_MIN_SIMILARITY;
  if (!strong) return { ...llm, byVote: false };
  if (llm.id === vote.optionId) {
    // Les deux s'accordent : c'est la meilleure garantie dont on dispose.
    return { id: llm.id, confidence: Math.max(llm.confidence ?? 0, vote.share), byVote: false };
  }
  if (llm.id === null || (llm.confidence ?? 0) < 0.6) {
    return { id: vote.optionId, confidence: Math.round(vote.share * 0.9 * 1000) / 1000, byVote: true };
  }
  return { ...llm, byVote: false };
}

/**
 * Le lien en dit-il assez pour être rangé ? Un titre seul (« Instagram »,
 * « Publication de @x ») ne suffit pas : mieux vaut le soumettre à
 * l'utilisateur que le ranger au hasard.
 */
export function isThin(document: string): boolean {
  const body = document
    .split("\n")
    .filter((l) => !/^Titre\s*:/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return body.length < 40;
}
