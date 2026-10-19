/**
 * Certitude du rangement, et seuil sous lequel l'utilisateur vérifie.
 *
 * Décision du tour 1 : l'IA range seule, et ne montre que ce dont elle
 * doute. La certitude n'est pas demandée au modèle — un petit modèle
 * s'auto-évalue très mal — mais lue dans ses probabilités : quand il écrit
 * le numéro du tiroir, le moteur dit quelle chance il donnait à chacun.
 *
 * Module pur : testable hors appareil.
 */

export interface TokenProbs {
  content: string;
  probs: { tok_str: string; prob: number }[];
}

export interface ChoiceProbability {
  index: number;
  p: number;
}

/**
 * Probabilité de chaque numéro, à la position où le modèle a écrit le sien.
 * Normalisée sur les seuls numéros valides : un « La » ou un espace envisagé
 * à cette position ne compte pas comme une hésitation entre tiroirs.
 * Renvoie `null` quand aucun numéro n'apparaît.
 */
export function choiceDistribution(
  tokens: TokenProbs[] | null | undefined,
  maxIndex: number,
): ChoiceProbability[] | null {
  if (!tokens) return null;
  const position = tokens.find((t) => /\d/.test(t.content));
  if (!position) return null;
  const sums = new Map<number, number>();
  for (const { tok_str, prob } of position.probs) {
    const digits = tok_str.trim();
    if (!/^\d+$/.test(digits)) continue;
    const n = Number(digits);
    if (n > maxIndex) continue;
    sums.set(n, (sums.get(n) ?? 0) + prob);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return [...sums.entries()]
    .map(([index, p]) => ({ index, p: p / total }))
    .sort((a, b) => b.p - a.p);
}

// --- Seuil auto-ajusté ------------------------------------------------------

export const DEFAULT_THRESHOLD = 0.75;
export const MIN_THRESHOLD = 0.4;
export const MAX_THRESHOLD = 0.95;

/**
 * Ce que la vérification a révélé :
 * - `kept` : l'IA doutait, mais avait raison ;
 * - `changed` : l'IA doutait, et avait tort ;
 * - `missed` : l'IA était sûre d'elle, et avait tort (corrigé depuis la fiche).
 */
export type VerificationEvent = "kept" | "changed" | "missed";

/**
 * Le seuil suit l'expérience. Des doutes systématiquement confirmés le font
 * baisser — moins de questions ; une erreur ratée le fait monter nettement —
 * mieux vaut une question de trop qu'un rangement faux qu'on ne verra pas.
 */
export function adjustThreshold(current: number, event: VerificationEvent): number {
  const delta = event === "kept" ? -0.01 : event === "changed" ? 0.01 : 0.04;
  const next = current + delta;
  return Math.round(Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, next)) * 1000) / 1000;
}

/** Une proposition est à vérifier quand aucun tiroir n'a été choisi, ou sans assez de certitude. */
export function isDoubt(themeId: string | null, confidence: number | null, threshold: number): boolean {
  if (!themeId) return true;
  return confidence !== null && confidence < threshold;
}
