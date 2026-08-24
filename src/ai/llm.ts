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
}

/**
 * Une inférence, avec sortie contrainte au format JSON quand un schéma est
 * fourni. Renvoie le texte brut ; l'analyse est faite par l'appelant.
 */
export async function complete(
  modelPath: string,
  options: CompletionOptions,
  loadOpts: LoadOptions = {},
): Promise<string> {
  const ctx = await getContext(modelPath, loadOpts);
  inFlight++;
  try {
    const result = await ctx.completion({
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
    });
    // `content` exclut le raisonnement et les appels d'outils quand le modèle en
    // produit ; `text` sert de repli.
    return result.content || result.text || "";
  } finally {
    inFlight--;
    scheduleRelease();
  }
}
