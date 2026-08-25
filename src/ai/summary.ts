import { complete } from "./llm";
import {
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryPrompt,
  cleanSummary,
  type SummaryOptions,
} from "./prompt";

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
  opts: SummaryOptions,
): Promise<string | null> {
  // Sous ce seuil, un résumé serait plus long que la source.
  if (content.trim().length < 400) return null;

  const raw = await complete(opts.modelPath, {
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: buildSummaryPrompt(
      title,
      content,
      opts.language,
      opts.maxContentChars,
    ),
    maxTokens: 300,
  });

  const cleaned = cleanSummary(raw);
  return cleaned.length > 0 ? cleaned : null;
}
