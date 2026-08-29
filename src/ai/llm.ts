import { initLlama, type LlamaContext } from "llama.rn";

/**
 * Gestion du contexte llama.cpp embarqué.
 *
 * Un modèle 3B quantifié occupe ~2 Go de RAM une fois chargé. On garde un seul
 * contexte, partagé, et on le libère après une période d'inactivité : le
 * conserver indéfiniment ferait tuer l'application par Android dès qu'elle
 * passe en arrière-plan.
 */

/** Délai d'inactivité avant libération de la mémoire du modèle. */
const IDLE_RELEASE_MS = 3 * 60 * 1000;

/** Le chargement d'un modèle de 2 Go depuis le stockage n'est pas instantané. */
const CONTEXT_SIZE = 4096;

interface LoadedContext {
  ctx: LlamaContext;
  modelPath: string;
}

let loaded: LoadedContext | null = null;
let loading: Promise<LoadedContext> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Nombre d'inférences en cours : on ne libère jamais sous les pieds d'un appel. */
let inFlight = 0;

function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inFlight === 0) void releaseModel();
  }, IDLE_RELEASE_MS);
}

export interface LoadOptions {
  onProgress?: (percent: number) => void;
}

async function load(
  modelPath: string,
  opts: LoadOptions,
): Promise<LoadedContext> {
  const ctx = await initLlama(
    {
      model: modelPath,
      n_ctx: CONTEXT_SIZE,
      // Le déchargement GPU est inégal selon les pilotes Android ; le CPU est
      // suffisant pour du tagging (quelques centaines de jetons).
      n_gpu_layers: 0,
      n_threads: 4,
      // Pas de génération créative : on veut un JSON reproductible.
      use_mlock: false,
    },
    (percent) => opts.onProgress?.(percent),
  );
  return { ctx, modelPath };
}

/**
 * Renvoie un contexte prêt à l'emploi pour ce modèle, en le chargeant si besoin.
 * Les appels concurrents partagent le même chargement.
 */
export async function getContext(
  modelPath: string,
  opts: LoadOptions = {},
): Promise<LlamaContext> {
  if (loaded && loaded.modelPath === modelPath) {
    scheduleRelease();
    return loaded.ctx;
  }
  // Modèle différent de celui en mémoire : on repart de zéro.
  if (loaded && loaded.modelPath !== modelPath) {
    await releaseModel();
  }
  loading ??= load(modelPath, opts)
    .then((result) => {
      loaded = result;
      loading = null;
      scheduleRelease();
      return result;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });

  const result = await loading;
  return result.ctx;
}

export async function releaseModel(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const current = loaded;
  loaded = null;
  if (current) {
    try {
      await current.ctx.release();
    } catch {
      // Un contexte déjà libéré par le système n'est pas une erreur ici.
    }
  }
}

export function isModelLoaded(): boolean {
  return loaded !== null;
}

export interface CompletionOptions {
  system: string;
  prompt: string;
  /** Schéma JSON imposé au décodeur. */
  jsonSchema?: object;
  maxTokens?: number;
  /**
   * Au-delà, l'inférence est arrêtée et ce qui a été produit est renvoyé.
   * Sans cette borne, une génération qui n'aboutit pas immobilise la file : le
   * favori reste « en cours d'analyse » indéfiniment, et rien derrière lui
   * n'avance jamais.
   */
  timeoutMs?: number;
  /** Nombre de jetons produits, pour donner signe de vie à l'interface. */
  onToken?: (produced: number) => void;
}

/** Le modèle n'a rien produit dans le temps imparti. */
export class InferenceTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Le modèle n'a rien produit en ${Math.round(ms / 1000)} s. ` +
        "Sur un modèle de 7 milliards de paramètres, une page longue peut " +
        "dépasser ce délai : un modèle plus léger (Réglages → Modèle IA) est " +
        "bien plus rapide.",
    );
    this.name = "InferenceTimeoutError";
  }
}

/** Le chargement du modèle en mémoire n'a jamais abouti. */
export class ModelLoadTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Le modèle n'a pas fini de se charger en ${Math.round(ms / 1000)} s. ` +
        "Vérifie qu'il est bien téléchargé, ou choisis-en un plus léger.",
    );
    this.name = "ModelLoadTimeoutError";
  }
}

/** Un chargement qui n'aboutit pas bloquerait la file aussi sûrement. */
const LOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Une inférence, avec sortie contrainte au format JSON quand un schéma est
 * fourni. Renvoie le texte brut ; l'analyse est faite par l'appelant.
 */
export async function complete(
  modelPath: string,
  options: CompletionOptions,
  loadOpts: LoadOptions = {},
): Promise<string> {
  const ctx = await withTimeout(
    getContext(modelPath, loadOpts),
    LOAD_TIMEOUT_MS,
    () => new ModelLoadTimeoutError(LOAD_TIMEOUT_MS),
  );

  inFlight++;
  let produced = 0;
  try {
    const run = ctx.completion(
      {
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.prompt },
        ],
        n_predict: options.maxTokens ?? 256,
        // Température basse : le tagging doit être stable d'une exécution à l'autre.
        temperature: 0.2,
        top_p: 0.9,
        ...(options.jsonSchema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { strict: true, schema: options.jsonSchema },
              },
            }
          : {}),
      },
      () => {
        produced++;
        options.onToken?.(produced);
      },
    );

    const budget = options.timeoutMs;
    if (budget === undefined) {
      const result = await run;
      return result.content || result.text || "";
    }

    // Le délai écoulé, on demande l'arrêt puis on récupère ce qui a été
    // produit : sur une réponse d'un seul nombre, le début suffit souvent.
    // Rejeter sans attendre laisserait l'inférence tourner en fond.
    const outcome = await raceStop(run, budget, ctx);
    // Une vraie erreur du moteur ne doit pas être maquillée en dépassement de
    // délai : le message reçu est la seule piste dont dispose l'utilisateur.
    if (outcome.error) throw outcome.error;
    if (outcome.text === null) throw new InferenceTimeoutError(budget);
    return outcome.text;
  } finally {
    inFlight--;
    scheduleRelease();
  }
}

/** Rejette si la promesse n'a pas abouti dans le temps imparti. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  error: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Attend la génération, en l'arrêtant au-delà du délai.
 *
 * `text` vaut `null` si le modèle n'a rien écrit dans le temps imparti ;
 * `error` porte un échec réel du moteur, à distinguer d'un simple dépassement.
 */
async function raceStop(
  run: Promise<{ content?: string; text?: string }>,
  ms: number,
  ctx: LlamaContext,
): Promise<{ text: string | null; error: Error | null }> {
  let failure: Error | null = null;
  // La promesse est neutralisée pour qu'un rejet tardif, après l'expiration,
  // ne remonte jamais comme rejet non traité.
  const settled: Promise<string | null> = run.then(
    (r) => r.content || r.text || "",
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
      return { text: first, error: failure };
    }

    await ctx.stopCompletion().catch(() => {});
    // L'arrêt demandé, la génération rend la main avec ce qu'elle avait.
    const partial = await settled;
    return {
      text: partial && partial.trim().length > 0 ? partial : null,
      error: failure,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
