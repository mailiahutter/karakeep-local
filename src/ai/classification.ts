import { complete } from "./llm";
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildChoicePrompt,
  buildSubthemeOptions,
  buildThemeOptions,
  parseChoice,
  resolveChoice,
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
}

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

/** Une question fermée : renvoie l'identifiant retenu, ou rien. */
async function choose(
  options: ReturnType<typeof buildThemeOptions>,
  document: string,
  noneLabel: string,
  step: "theme" | "subtheme",
  run: AnalyseRun,
): Promise<string | null> {
  if (options.length === 0) return null;
  const raw = await complete(run.modelPath, {
    system: CLASSIFY_SYSTEM_PROMPT,
    prompt: buildChoicePrompt(options, document, noneLabel),
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

  const themeOptions = buildThemeOptions(themes);
  const themeId = await choose(
    themeOptions,
    document,
    "Aucune de ces catégories",
    "theme",
    run,
  );
  if (!themeId) return { digest, themeId: null, subthemeId: null, classifiedFrom: document };

  const theme = themes.find((t) => t.id === themeId);
  if (!theme || theme.subthemes.length === 0) {
    return { digest, themeId, subthemeId: null, classifiedFrom: document };
  }

  const subthemeId = await choose(
    buildSubthemeOptions(theme),
    document,
    `Aucun sous-thème précis, laisser dans « ${theme.name} »`,
    "subtheme",
    run,
  );

  return { digest, themeId, subthemeId, classifiedFrom: document };
}
