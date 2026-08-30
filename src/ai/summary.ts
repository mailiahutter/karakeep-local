import { complete } from "./llm";
import {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
  cleanSummary,
  type SummaryOptions,
} from "./prompt";

/**
 * Longueur en deçà de laquelle il n'y a rien à résumer. Une légende plus
 * courte est déjà son propre résumé — et la phrase produite par l'étape de
 * compréhension en tient lieu.
 */
export const MIN_CONTENT_FOR_SUMMARY = 220;

/**
 * Résumé d'un contenu par le modèle embarqué.
 *
 * La construction du prompt et le nettoyage de la réponse vivent dans
 * `prompt.ts`, qui n'importe aucun module natif et reste donc testable hors
 * appareil.
 */
export async function generateSummary(
  title: string | null,
  content: string,
  opts: SummaryOptions & {
    timeoutMs?: number;
    onToken?: (produced: number) => void;
  },
): Promise<string | null> {
  // Sous ce seuil, un résumé serait plus long que la source. Le seuil était à
  // 400 : sur Instagram, presque aucune légende ne l'atteint, et toutes les
  // fiches se retrouvaient sans résumé.
  if (content.trim().length < MIN_CONTENT_FOR_SUMMARY) return null;

  const raw = await complete(opts.modelPath, {
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: buildSummaryPrompt(
      title,
      content,
      opts.language,
      opts.maxContentChars,
    ),
    maxTokens: 300,
    timeoutMs: opts.timeoutMs,
    onToken: opts.onToken,
  });

  const cleaned = cleanSummary(raw);
  return cleaned.length > 0 ? cleaned : null;
}
