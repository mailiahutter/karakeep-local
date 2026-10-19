import { complete } from "./llm";
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildChoicePrompt,
  buildSubthemeOptions,
  buildThemeOptions,
  centroid,
  parseChoice,
  pickExamples,
  resolveChoice,
  shortlist,
  type ClassifyExample,
  type ClassifyOption,
  type ThemeTree,
} from "./classify";
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

export interface Analysis {
  digest: Digest | null;
  themeId: string | null;
  subthemeId: string | null;
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
      o.description ? `${o.name}. ${o.description}` : o.name,
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

/** Une question fermée : renvoie l'identifiant retenu, ou rien. */
async function choose(
  options: ClassifyOption[],
  document: string,
  noneLabel: string,
  step: "theme" | "subtheme",
  run: AnalyseRun,
  examples: ClassifyExample[],
): Promise<string | null> {
  if (options.length === 0) return null;
  const raw = await complete(run.modelPath, {
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt: buildChoicePrompt(options, document, noneLabel, pickExamples(examples, options)),
    // Un numéro tient en quelques jetons ; brider la sortie décourage les
    // justifications qu'un petit modèle ajoute volontiers.
    maxTokens: 12,
    timeoutMs: run.choiceTimeoutMs,
    onToken: (n) => run.onToken?.(step, n),
  });
  return resolveChoice(options, parseChoice(raw, options.length));
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
  const themeId = await choose(
    themeOptions,
    document,
    "Aucune de ces catégories",
    "theme",
    run,
    themeExamples,
  );
  if (!themeId) return { digest, themeId: null, subthemeId: null, classifiedFrom: document };

  const theme = themes.find((t) => t.id === themeId);
  if (!theme || theme.subthemes.length === 0) {
    return { digest, themeId, subthemeId: null, classifiedFrom: document };
  }

  const allSubs = buildSubthemeOptions(theme);
  const subExamples = known
    .filter((e) => e.themeId === themeId && e.subthemeId)
    .map((e) => ({ id: e.id, text: e.text, optionId: e.subthemeId as string }));
  const subOptions = docVector
    ? shortlist(allSubs, docVector, await optionVectors(run, allSubs, subExamples, "s"), SHORTLIST_SIZE)
    : allSubs;
  const subthemeId = await choose(
    subOptions,
    document,
    `Aucun sous-thème précis, laisser dans « ${theme.name} »`,
    "subtheme",
    run,
    subExamples,
  );

  return { digest, themeId, subthemeId, classifiedFrom: document };
}
