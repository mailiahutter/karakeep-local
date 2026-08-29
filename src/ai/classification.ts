import { complete } from "./llm";
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildClassifyPrompt,
  buildOptions,
  parseChoice,
  resolveChoice,
  type ThemeTree,
} from "./classify";
import { stripBoilerplate } from "./prompt";

/**
 * Range un favori dans l'arborescence, en interrogeant le modèle embarqué.
 *
 * La construction du prompt et la lecture de la réponse vivent dans
 * `classify.ts`, sans import natif, et sont donc testables hors appareil.
 */
export interface ClassifyRunOptions {
  timeoutMs?: number;
  onToken?: (produced: number) => void;
  onLoadProgress?: (percent: number) => void;
}

export async function classifyBookmark(
  themes: ThemeTree[],
  title: string | null,
  content: string,
  modelPath: string,
  run: ClassifyRunOptions = {},
): Promise<{ themeId: string; subthemeId: string | null } | null> {
  const options = buildOptions(themes);
  if (options.length === 0) return null;

  const raw = await complete(
    modelPath,
    {
      system: CLASSIFY_SYSTEM_PROMPT,
      // Le classement se joue sur le sujet, pas sur le détail : un extrait
      // court suffit, et la lecture du prompt est ce qui coûte le plus cher
      // sur un processeur de téléphone.
      prompt: buildClassifyPrompt(options, title, stripBoilerplate(content), 1200),
      // Un numéro tient en quelques jetons ; brider la sortie décourage les
      // justifications qu'un petit modèle ajoute volontiers.
      maxTokens: 12,
      timeoutMs: run.timeoutMs,
      onToken: run.onToken,
    },
    { onProgress: run.onLoadProgress },
  );

  return resolveChoice(options, parseChoice(raw, options.length));
}
