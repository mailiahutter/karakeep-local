/**
 * Accès au moteur natif (llama.rn), sans dépendance à React Native : ce
 * fichier est testé tel quel sous Node.
 */

export interface TokenProbs {
  content: string;
  probs: { tok_str: string; prob: number }[];
}

export type RawResult = {
  content?: string;
  text?: string;
  completion_probabilities?: TokenProbs[];
};

/** Ce dont `raceStop` a besoin du contexte llama.rn. */
export interface Stoppable {
  /** Synchrone dans llama.rn 0.12 malgré son type : peut ne rien renvoyer. */
  stopCompletion(): Promise<void> | void;
}

/**
 * File d'attente du moteur natif.
 *
 * Le 2 novembre, 40 analyses sur 40 ont échoué en quelques secondes avec
 * « Exception in HostFunction: <unknown> ». La cause : une perception trop
 * longue avait dépassé son délai, l'arrêt avait échoué (`stopCompletion` ne
 * renvoie pas de promesse), et l'analyse suivante était partie alors que le
 * moteur travaillait encore. llama.rn répond alors « Context is busy » — mais
 * comme sa bibliothèque native embarque sa propre copie de la bibliothèque
 * C++, ce message arrive dans JavaScript réduit à « <unknown> ».
 *
 * Désormais, chaque demande attend que la précédente ait réellement rendu la
 * main au moteur.
 */
let engineTail: Promise<unknown> = Promise.resolve();

export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = engineTail.then(job, job);
  engineTail = run.catch(() => undefined);
  return run;
}

/** Erreur sans message, levée par le code natif de llama.rn. */
export function isOpaqueEngineError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /HostFunction|<unknown>|Unknown error|Context is busy/i.test(message);
}

/**
 * Attend la génération, en l'arrêtant au-delà du délai.
 *
 * `text` vaut `null` si le modèle n'a rien écrit dans le temps imparti ;
 * `error` porte un échec réel du moteur, à distinguer d'un simple dépassement.
 */
export async function raceStop(
  run: Promise<RawResult>,
  ms: number,
  ctx: Stoppable,
): Promise<{ text: string | null; error: Error | null; probs: TokenProbs[] | null }> {
  let failure: Error | null = null;
  let probs: TokenProbs[] | null = null;
  // La promesse est neutralisée pour qu'un rejet tardif, après l'expiration,
  // ne remonte jamais comme rejet non traité.
  const settled: Promise<string | null> = run.then(
    (r) => {
      probs = r.completion_probabilities ?? null;
      return r.content || r.text || "";
    },
    (err) => {
      failure = err instanceof Error ? err : new Error(String(err));
      return null;
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), ms);
  });

  try {
    const first = await Promise.race([settled, expired]);
    if (first !== "expired") {
      return { text: first, error: failure, probs };
    }

    // `stopCompletion` est synchrone dans llama.rn 0.12 : il ne renvoie
    // rien, et `.catch` dessus levait « Cannot read property 'catch' of
    // undefined » — en laissant le moteur tourner sans personne pour
    // l'attendre.
    try {
      await ctx.stopCompletion();
    } catch {
      // Contexte déjà libéré : la génération va rendre la main d'elle-même.
    }
    // L'arrêt demandé, la génération rend la main avec ce qu'elle avait. On
    // l'attend jusqu'au bout : la lecture des images, elle, ne s'interrompt
    // pas, et lancer la demande suivante avant serait trouver le moteur
    // occupé.
    const partial = await settled;
    return {
      text: partial && partial.trim().length > 0 ? partial : null,
      error: failure,
      probs,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

