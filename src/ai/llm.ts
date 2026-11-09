import { initLlama, type LlamaContext } from "llama.rn";

import {
  exclusive,
  isOpaqueEngineError,
  raceStop,
  type RawResult,
  type TokenProbs,
} from "./engineQueue";

export { isOpaqueEngineError };

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
  /** Projecteur multimodal chargé : le modèle peut regarder et écouter. */
  multimodal: boolean;
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
  /** Fichier `mmproj` à charger pour les images et le son. */
  projectorPath?: string;
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
  return { ctx, modelPath, multimodal: false };
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
    await ensureMultimodal(loaded, opts);
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
  await ensureMultimodal(result, opts);
  return result.ctx;
}

/**
 * Charge le projecteur à la première demande qui en a besoin. Le
 * classement, lui, n'en a pas besoin : on n'alourdit pas la mémoire pour
 * rien.
 */
async function ensureMultimodal(current: LoadedContext, opts: LoadOptions): Promise<void> {
  if (!opts.projectorPath || current.multimodal) return;
  current.multimodal = await current.ctx.initMultimodal({
    path: opts.projectorPath,
    // Le processeur, comme pour le modèle : le GPU est inégal selon les
    // pilotes Android.
    use_gpu: false,
    // Assez pour lire une affiche ou une recette, sans exploser la mémoire.
    image_max_tokens: 280,
  });
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
  /**
   * Demande au moteur les probabilités des `nProbs` jetons les plus probables
   * à chaque position. C'est la certitude réelle du modèle, pas une
   * auto-évaluation qu'il inventerait.
   */
  nProbs?: number;
  onProbabilities?: (probs: TokenProbs[]) => void;
  /** Images jointes (chemins locaux), quand le projecteur est chargé. */
  images?: string[];
  /** Son joint (WAV), quand le projecteur est chargé. */
  audio?: string | null;
}

export type { TokenProbs };


/** Le modèle n'a rien produit dans le temps imparti. */
export class InferenceTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Le modèle n'a rien produit en ${Math.round(ms / 1000)} s. ` +
        "Un modèle plus léger (Réglages → Modèle IA, Gemma 4 E2B) est " +
        "environ deux fois plus rapide.",
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
  try {
    // Une seule inférence à la fois dans le moteur natif, attendue jusqu'au
    // bout — y compris après un dépassement de délai (voir `exclusive`).
    return await exclusive(() => completeOnce(ctx, modelPath, options));
  } catch (err) {
    // Contexte inutilisable : ne plus jamais le réutiliser. Le libérer
    // attendrait la fin d'une génération qui ne finit pas ; l'application
    // va être redémarrée.
    if ((err as Error).name === "EngineWedgedError" && loaded?.ctx === ctx) loaded = null;
    throw err;
  } finally {
    inFlight--;
    scheduleRelease();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function completeOnce(
  ctx: LlamaContext,
  modelPath: string,
  options: CompletionOptions,
): Promise<string> {
  // Le gabarit de conversation du modèle d'abord (« jinja »), puis la mise
  // en forme intégrée à llama.cpp si le gabarit fait échouer le moteur. Une
  // erreur opaque est d'abord retentée une fois, moteur au repos : c'est le
  // cas « encore occupé » qui ne doit plus arriver, mais ne coûte rien.
  const preferred = formatFor.get(modelPath) ?? "jinja";
  let first: unknown;
  for (const format of preferred === "jinja" ? (["jinja", "jinja", "plain"] as const) : (["plain", "plain"] as const)) {
    try {
      const text = await attempt(ctx, options, format);
      formatFor.set(modelPath, format);
      return text;
    } catch (err) {
      if (!isEngineCrash(err)) throw err;
      first ??= err;
      await sleep(3_000);
    }
  }
  throw new ModelIncompatibleError(first, "aucune mise en forme ne passe");
}

/** Mise en forme qui fonctionne, par modèle (voir `complete`). */
const formatFor = new Map<string, "jinja" | "plain">();

/** Erreur du moteur natif lui-même, et non du contenu de la demande. */
function isEngineCrash(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return isOpaqueEngineError(err) || /chat template|jinja|template/i.test(message);
}

/** Le modèle ne fonctionne avec aucune des deux mises en forme. */
export class ModelIncompatibleError extends Error {
  constructor(first: unknown, second: unknown) {
    const a = first instanceof Error ? first.message : String(first);
    const b = second instanceof Error ? second.message : String(second);
    super(`Modèle incompatible avec le moteur de l'application (${a} ; puis ${b})`);
    this.name = "ModelIncompatibleError";
  }
}

async function attempt(
  ctx: LlamaContext,
  options: CompletionOptions,
  format: "jinja" | "plain",
): Promise<string> {
  let produced = 0;
  const run = ctx.completion(
    {
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: userContent(options) },
      ],
      ...(format === "jinja"
        ? {
            // Les modèles récents savent « réfléchir » avant de répondre :
            // utile ailleurs, ruineux ici, et cela casserait la lecture
            // d'un numéro.
            enable_thinking: false,
          }
        : { jinja: false }),
      n_predict: options.maxTokens ?? 256,
      // Température basse : le tagging doit être stable d'une exécution à l'autre.
      temperature: 0.2,
      top_p: 0.9,
      ...(options.nProbs ? { n_probs: options.nProbs } : {}),
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
    const result = (await run) as RawResult;
    if (result.completion_probabilities) options.onProbabilities?.(result.completion_probabilities);
    return result.content || result.text || "";
  }

  // Le délai écoulé, on demande l'arrêt puis on récupère ce qui a été
  // produit : sur une réponse d'un seul nombre, le début suffit souvent.
  // Rejeter sans attendre laisserait l'inférence tourner en fond.
  const outcome = await raceStop(run as Promise<RawResult>, budget, ctx);
  if (outcome.probs) options.onProbabilities?.(outcome.probs);
  // Une vraie erreur du moteur ne doit pas être maquillée en dépassement de
  // délai : le message reçu est la seule piste dont dispose l'utilisateur.
  if (outcome.error) throw outcome.error;
  if (outcome.text === null) throw new InferenceTimeoutError(budget);
  return outcome.text;
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

function fileUrl(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

/** Texte seul, ou texte accompagné d'images et de son. */
function userContent(options: CompletionOptions) {
  const images = options.images ?? [];
  if (images.length === 0 && !options.audio) return options.prompt;
  return [
    ...images.map((p) => ({ type: "image_url", image_url: { url: fileUrl(p) } })),
    ...(options.audio
      ? [{ type: "input_audio", input_audio: { format: "wav", url: fileUrl(options.audio) } }]
      : []),
    { type: "text", text: options.prompt },
  ];
}
