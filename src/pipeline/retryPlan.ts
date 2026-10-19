/**
 * Calendrier des nouvelles tentatives après un échec de capture.
 *
 * Un site en panne un soir, une publication momentanément refusée, un
 * serveur qui répond 503 : rien de tout cela ne prouve que la source a
 * disparu. On réessaie donc le lendemain, puis encore, et seulement au bout
 * de plusieurs jours la source est déclarée disparue — sans rien effacer de
 * ce qui avait été sauvegardé.
 *
 * Module pur : testable hors appareil.
 */

export const DAY_MS = 24 * 3_600_000;
/** Jours de tentatives avant de déclarer la source disparue. */
export const RETRY_DAYS = 4;

export interface RetryDecision {
  /** Instant de la prochaine tentative, ou `null` s'il n'y en aura plus. */
  nextAt: number | null;
  gone: boolean;
  attempts: number;
}

/** `failures` : nombre d'échecs déjà constatés, celui-ci exclu. */
export function planRetry(failures: number, now: number): RetryDecision {
  const attempts = failures + 1;
  if (attempts >= RETRY_DAYS) return { nextAt: null, gone: true, attempts };
  return { nextAt: now + DAY_MS, gone: false, attempts };
}

/** Message affiché sur la fiche. */
export function retryMessage(reason: string, decision: RetryDecision): string {
  if (decision.gone) {
    return `Source disparue : plus de réponse après ${decision.attempts} jours d'essais. Ce qui avait été sauvegardé reste consultable.`;
  }
  return `${reason} Nouvel essai automatique demain.`;
}
