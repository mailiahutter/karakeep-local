import { complete } from "./llm";
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildChoicePrompt,
  buildSubthemeOptions,
  arbitrate,
  buildThemeOptions,
  centroid,
  isThin,
  nearestVote,
  parseChoice,
  pickExamples,
  resolveChoice,
  shortlist,
  SUGGEST_JSON_SCHEMA,
  SUGGEST_SYSTEM_PROMPT,
  buildSuggestPrompt,
  parseSuggestion,
  type ClassifyExample,
  type ClassifyOption,
  type ThemeSuggestion,
  type ThemeTree,
} from "./classify";
import { choiceDistribution, type TokenProbs } from "./confidence";
import {
  DIGEST_JSON_SCHEMA,
  DIGEST_SYSTEM_PROMPT,
  buildDigestPrompt,
  describeForClassification,
  parseDigest,
  type Digest,
} from "./digest";
import type { TagStyle } from "./prompt";

/**
 * Analyse complète d'un favori : comprendre, puis ranger.
 *
 * Trois demandes courtes remplacent l'unique question à vingt et une options
 * qui donnait des rangements au hasard. Chacune est facile prise isolément, et
 * chacune peut échouer sans emporter les autres : sans analyse on classe sur
 * le titre et un extrait, sans sous-thème on range au moins dans le thème.
 *
 * La construction des prompts et la lecture des réponses vivent dans
 * `digest.ts` et `classify.ts`, sans import natif, et sont donc testables hors
 * appareil.
 */

export interface AnalyseInput {
  title: string | null;
  description: string | null;
  content: string | null;
  url: string;
  language: string;
  tagStyle: TagStyle;
}

export interface AnalyseRun {
  modelPath: string;
  digestTimeoutMs?: number;
  choiceTimeoutMs?: number;
  onToken?: (step: "digest" | "theme" | "subtheme", produced: number) => void;
  onLoadProgress?: (percent: number) => void;
  /** Rangements qui font foi, les plus récents d'abord. */
  examples?: KnownExample[];
  /**
   * Vecteur de sens d'un texte, mis en cache sous `key` quand elle est
   * fournie. Absent, ou renvoyant `null`, le pré-tri est simplement sauté.
   */
  embed?: (key: string | null, text: string) => Promise<number[] | null>;
}

export interface KnownExample {
  id: string;
  text: string;
  themeId: string;
  subthemeId: string | null;
}

/** Nombre de candidats laissés au modèle de langage après le pré-tri. */
const SHORTLIST_SIZE = 3;
/** Exemples pris en compte dans le centre de chaque thème. */
const EXAMPLES_PER_CENTROID = 5;
/** Liens rangés par l'utilisateur consultés pour le vote des voisins. */
const MAX_VOTERS = 60;

export interface Analysis {
  digest: Digest | null;
  themeId: string | null;
  subthemeId: string | null;
  /** Probabilité donnée au tiroir retenu, de 0 à 1 ; `null` si non mesurée. */
  confidence: number | null;
  /** Les autres tiroirs envisagés, du plus au moins probable. */
  alternatives: Alternative[];
  /** Tiroir à créer, quand aucun ne convenait. */
  suggestion: ThemeSuggestion | null;
  /** Ce qui a été soumis au classement : précieux pour comprendre un raté. */
  classifiedFrom: string;
}

/** Première étape : de quoi parle ce lien ? */
export async function summarizeSubject(
  input: AnalyseInput,
  run: AnalyseRun,
): Promise<Digest | null> {
  const raw = await complete(
    run.modelPath,
    {
      system: DIGEST_SYSTEM_PROMPT,
      prompt: buildDigestPrompt(input),
      jsonSchema: DIGEST_JSON_SCHEMA,
      maxTokens: 160,
      timeoutMs: run.digestTimeoutMs,
      onToken: (n) => run.onToken?.("digest", n),
    },
    { onProgress: run.onLoadProgress },
  );
  return parseDigest(raw);
}

/** Un vecteur sans jamais faire échouer l'analyse. */
async function safeEmbed(
  run: AnalyseRun,
  key: string | null,
  text: string,
): Promise<number[] | null> {
  if (!run.embed || !text.trim()) return null;
  try {
    return await run.embed(key, text);
  } catch {
    return null;
  }
}

/**
 * Centre de chaque option : sa propre définition, plus les liens que
 * l'utilisateur y a rangés. Les exemples comptent autant que la définition —
 * ce sont eux qui disent ce qu'il range vraiment là.
 */
async function optionVectors(
  run: AnalyseRun,
  options: ClassifyOption[],
  examples: { id: string; text: string; optionId: string }[],
  prefix: string,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const o of options) {
    const vectors: number[][] = [];
    const own = await safeEmbed(
      run,
      `${prefix}:${o.id}`,
      [o.name, o.description, o.learned].filter(Boolean).join(". "),
    );
    if (own) vectors.push(own);
    for (const e of examples.filter((x) => x.optionId === o.id).slice(0, EXAMPLES_PER_CENTROID)) {
      const v = await safeEmbed(run, `b:${e.id}`, e.text);
      if (v) vectors.push(v);
    }
    const c = centroid(vectors);
    if (c) out.set(o.id, c);
  }
  return out;
}

export interface Alternative {
  id: string;
  p: number;
}

interface Choice {
  id: string | null;
  confidence: number | null;
  alternatives: Alternative[];
}

/** Une question fermée : l'identifiant retenu, avec la certitude mesurée. */
async function choose(
  options: ClassifyOption[],
  document: string,
  noneLabel: string,
  step: "theme" | "subtheme",
  run: AnalyseRun,
  examples: ClassifyExample[],
): Promise<Choice> {
  if (options.length === 0) return { id: null, confidence: null, alternatives: [] };
  let probs: TokenProbs[] | null = null;
  const raw = await complete(run.modelPath, {
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt: buildChoicePrompt(options, document, noneLabel, pickExamples(examples, options)),
    // Un numéro tient en quelques jetons ; brider la sortie décourage les
    // justifications qu'un petit modèle ajoute volontiers.
    maxTokens: 12,
    timeoutMs: run.choiceTimeoutMs,
    onToken: (n) => run.onToken?.(step, n),
    nProbs: 10,
    onProbabilities: (p) => {
      probs = p;
    },
  });
  const id = resolveChoice(options, parseChoice(raw, options.length));
  const dist = choiceDistribution(probs, options.length);
  const byIndex = new Map(options.map((o) => [o.index, o.id]));
  const chosen = options.find((o) => o.id === id);
  const confidence = chosen && dist ? (dist.find((d) => d.index === chosen.index)?.p ?? 0) : null;
  const alternatives = (dist ?? [])
    .map((d) => ({ id: byIndex.get(d.index) ?? "", p: d.p }))
    .filter((a) => a.id && a.id !== id && a.p >= 0.02)
    .slice(0, 2);
  return { id, confidence, alternatives };
}

/** Aucun tiroir ne convient : en proposer un, prérempli. */
async function suggest(
  document: string,
  themes: ThemeTree[],
  run: AnalyseRun,
): Promise<ThemeSuggestion | null> {
  try {
    const raw = await complete(run.modelPath, {
      system: SUGGEST_SYSTEM_PROMPT,
      prompt: buildSuggestPrompt(document, themes.map((t) => t.name)),
      jsonSchema: SUGGEST_JSON_SCHEMA,
      maxTokens: 80,
      timeoutMs: run.choiceTimeoutMs,
    });
    return parseSuggestion(raw);
  } catch {
    return null;
  }
}

export async function analyseBookmark(
  themes: ThemeTree[],
  input: AnalyseInput,
  run: AnalyseRun,
): Promise<Analysis> {
  let digest: Digest | null = null;
  try {
    digest = await summarizeSubject(input, run);
  } catch {
    // Le classement reste possible sur le titre et un extrait brut : perdre
    // l'analyse ne doit pas faire perdre le rangement, qui est l'essentiel.
  }

  const document = describeForClassification(
    input.title,
    digest,
    input.content ?? "",
  );

  const known = run.examples ?? [];
  const docVector = await safeEmbed(run, null, document);

  // Premier niveau : pré-tri par proximité, puis choix par le modèle, guidé
  // par des exemples de l'utilisateur.
  const allThemes = buildThemeOptions(themes);
  const themeExamples = known.map((e) => ({ id: e.id, text: e.text, optionId: e.themeId }));
  const themeOptions = docVector
    ? shortlist(allThemes, docVector, await optionVectors(run, allThemes, themeExamples, "t"), SHORTLIST_SIZE)
    : allThemes;
  const themeChoice = await choose(
    themeOptions,
    document,
    "Aucune de ces catégories",
    "theme",
    run,
    themeExamples,
  );
  // La mémoire des corrections : où l'utilisateur a rangé les liens les plus
  // proches. Elle tranche quand le modèle hésite ou ne choisit rien.
  let decided: { id: string | null; confidence: number | null } = themeChoice;
  if (docVector && known.length > 0) {
    const neighbours: { vector: number[]; optionId: string }[] = [];
    for (const e of known.slice(0, MAX_VOTERS)) {
      const v = await safeEmbed(run, `b:${e.id}`, e.text);
      if (v && allThemes.some((o) => o.id === e.themeId)) neighbours.push({ vector: v, optionId: e.themeId });
    }
    decided = arbitrate(themeChoice, nearestVote(docVector, neighbours), neighbours.length);
  }

  // Un lien qui ne dit presque rien ne doit pas être rangé en silence : il
  // passe par « À vérifier », quelle que soit l'assurance du modèle.
  const thin = isThin(document);
  const themeId = decided.id;
  const base = {
    digest,
    confidence: thin ? Math.min(decided.confidence ?? 0.3, 0.3) : decided.confidence,
    alternatives: [
      // Choix du modèle écarté par le vote : il reste proposé.
      ...(themeChoice.id && themeChoice.id !== themeId
        ? [{ id: themeChoice.id, p: themeChoice.confidence ?? 0 }]
        : []),
      ...themeChoice.alternatives.filter((a) => a.id !== themeId),
    ].slice(0, 2),
    classifiedFrom: document,
  };
  if (!themeId) {
    return {
      ...base,
      themeId: null,
      subthemeId: null,
      suggestion: await suggest(document, themes, run),
    };
  }

  const theme = themes.find((t) => t.id === themeId);
  if (!theme || theme.subthemes.length === 0) {
    return { ...base, themeId, subthemeId: null, suggestion: null };
  }

  const allSubs = buildSubthemeOptions(theme);
  const subExamples = known
    .filter((e) => e.themeId === themeId && e.subthemeId)
    .map((e) => ({ id: e.id, text: e.text, optionId: e.subthemeId as string }));
  const subOptions = docVector
    ? shortlist(allSubs, docVector, await optionVectors(run, allSubs, subExamples, "s"), SHORTLIST_SIZE)
    : allSubs;
  const sub = await choose(
    subOptions,
    document,
    `Aucun sous-thème précis, laisser dans « ${theme.name} »`,
    "subtheme",
    run,
    subExamples,
  );

  return { ...base, themeId, subthemeId: sub.id, suggestion: null };
}
