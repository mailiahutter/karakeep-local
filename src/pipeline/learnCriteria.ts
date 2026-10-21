import { complete } from "../ai/llm";
import {
  CRITERIA_SYSTEM_PROMPT,
  buildCriteriaPrompt,
  needsLearning,
  parseCriteria,
} from "../ai/criteria";
import { getDb } from "../db/client";
import {
  COUNT_TRUSTED_BY_SUBTHEME,
  COUNT_TRUSTED_BY_THEME,
  REMOVED_FROM,
  TRUSTED_FOR_SUBTHEME,
  TRUSTED_FOR_THEME,
} from "../db/criteria.sql";
import { listThemes, setLearnedCriteria } from "../db/themes";
import { AI_TIMEOUTS } from "./policy";

/** Tiroirs revus par cycle : l'apprentissage ne doit pas manger la nuit. */
const PER_CYCLE = 2;

/**
 * Réécrit les critères appris des tiroirs dont les habitudes ont assez
 * changé (voir `ai/criteria.ts`). Les plus fournis d'abord : c'est là que la
 * généralisation est la plus sûre et sert le plus souvent.
 */
export async function refreshLearnedCriteria(
  modelPath: string,
  deadline: () => boolean,
): Promise<number> {
  const db = await getDb();
  const themes = await listThemes();
  const themeCounts = new Map(
    (await db.getAllAsync<{ id: string; n: number }>(COUNT_TRUSTED_BY_THEME)).map((r) => [r.id, r.n]),
  );
  const subCounts = new Map(
    (await db.getAllAsync<{ id: string; n: number }>(COUNT_TRUSTED_BY_SUBTHEME)).map((r) => [r.id, r.n]),
  );

  type Target = {
    kind: "theme" | "subtheme";
    id: string;
    name: string;
    description: string | null;
    parent: string | null;
    label: string;
    trusted: number;
  };
  const targets: Target[] = [];
  for (const theme of themes) {
    const n = themeCounts.get(theme.id) ?? 0;
    if (needsLearning(theme.learnedFrom ?? 0, n)) {
      targets.push({ kind: "theme", id: theme.id, name: theme.name, description: theme.description, parent: null, label: theme.name, trusted: n });
    }
    for (const sub of theme.subthemes) {
      const m = subCounts.get(sub.id) ?? 0;
      if (needsLearning(sub.learnedFrom ?? 0, m)) {
        targets.push({
          kind: "subtheme",
          id: sub.id,
          name: sub.name,
          description: sub.description,
          parent: theme.name,
          label: `${theme.name} › ${sub.name}`,
          trusted: m,
        });
      }
    }
  }
  targets.sort((a, b) => b.trusted - a.trusted);

  let done = 0;
  for (const target of targets.slice(0, PER_CYCLE)) {
    if (deadline()) break;
    const positives = (
      await db.getAllAsync<{ text: string }>(
        target.kind === "theme" ? TRUSTED_FOR_THEME : TRUSTED_FOR_SUBTHEME,
        [target.id, 15],
      )
    ).map((r) => r.text);
    const themeId = target.kind === "theme" ? target.id : (themes.find((t) => t.subthemes.some((s) => s.id === target.id))?.id ?? "");
    const negatives = (
      await db.getAllAsync<{ text: string }>(REMOVED_FROM, [target.label, target.label, themeId, 6])
    ).map((r) => r.text);
    try {
      const raw = await complete(modelPath, {
        system: CRITERIA_SYSTEM_PROMPT,
        prompt: buildCriteriaPrompt(target, positives, negatives),
        maxTokens: 140,
        timeoutMs: AI_TIMEOUTS.digest,
      });
      const criteria = parseCriteria(raw);
      if (criteria) {
        await setLearnedCriteria(target.kind, target.id, criteria, target.trusted);
        done++;
      }
    } catch {
      // Retenté au prochain cycle.
    }
  }
  return done;
}
