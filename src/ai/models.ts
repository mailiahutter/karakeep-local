/**
 * Catalogue des modèles de tagging embarqués.
 *
 * Tous sont au format GGUF quantifié Q4_K_M, le compromis habituel entre taille
 * et qualité pour llama.cpp sur mobile. Les tailles ont été relevées sur les
 * dépôts HuggingFace correspondants.
 */
export interface ModelDescriptor {
  id: string;
  label: string;
  /**
   * Taille du téléchargement en octets, relevée sur l'en-tête Content-Length
   * du dépôt. Ne jamais l'estimer : elle sert de repère d'intégrité, et une
   * valeur inventée fait rejeter un modèle parfaitement valide.
   */
  bytes: number;
  /** RAM totale de l'appareil recommandée. */
  ramHint: string;
  /**
   * Temps d'analyse d'un lien, les trois demandes cumulées, sur un
   * téléphone récent.
   *
   * C'est le processeur qui décide ici, pas la mémoire : llama.cpp tourne sur
   * les cœurs, pas sur le GPU. Un appareil peut loger un modèle de 7 milliards
   * de paramètres sans pouvoir le faire répondre en un temps acceptable.
   */
  speedHint: string;
  /**
   * Modèle que l'appareil peut charger sans pouvoir le faire travailler.
   * Android tue une application qui réclame cinq gigaoctets et demi dès
   * qu'elle passe en arrière-plan : le traitement s'arrête sans message.
   */
  heavy?: boolean;
  url: string;
  /** Nom du fichier une fois enregistré sur l'appareil. */
  fileName: string;
  notes: string;
  /**
   * Projecteur multimodal (fichier `mmproj`) : ce qui permet au modèle de
   * regarder des images et d'écouter du son. Téléchargé à côté du modèle.
   */
  projector?: { url: string; fileName: string; bytes: number };
  /** Ce que le modèle sait percevoir en plus du texte. */
  senses?: ("image" | "audio")[];
}

export const MODELS: ModelDescriptor[] = [
  {
    id: "gemma-4-e2b-it-q4",
    label: "Gemma 4 E2B — voit et écoute",
    bytes: 2_841_481_184,
    ramHint: "8 Go et plus",
    speedHint: "environ 2 à 4 min par lien, images et son compris",
    url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf",
    fileName: "gemma-4-E2B-it-Q4_0.gguf",
    projector: {
      url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mmproj-gemma-4-E2B-it-Q8_0.gguf",
      fileName: "mmproj-gemma-4-E2B-it-Q8_0.gguf",
      bytes: 557_368_064,
    },
    senses: ["image", "audio"],
    notes:
      "Le choix par défaut depuis la 3.4 (Google, 2026) : il regarde les photos et les images-clés des vidéos, et écoute leur son. Une publication à la légende vide ou trompeuse est rangée d'après ce qu'elle montre et ce qu'on y dit. Plus de 140 langues.",
  },
  {
    id: "gemma-4-e4b-it-q4",
    label: "Gemma 4 E4B — voit et écoute, plus fin",
    bytes: 4_590_807_392,
    ramHint: "12 Go et plus",
    speedHint: "environ 4 à 8 min par lien",
    heavy: true,
    url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_0.gguf",
    fileName: "gemma-4-E4B-it-Q4_0.gguf",
    projector: {
      url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/main/mmproj-gemma-4-E4B-it-Q8_0.gguf",
      fileName: "mmproj-gemma-4-E4B-it-Q8_0.gguf",
      bytes: 559_874_816,
    },
    senses: ["image", "audio"],
    notes:
      "Même famille, deux fois plus de paramètres actifs : comprend mieux, mais demande un téléphone haut de gamme et beaucoup plus de temps.",
  },
  {
    id: "gemma-3-4b-it-q4km",
    label: "Gemma 3 4B — voit les images",
    bytes: 2_489_757_856,
    ramHint: "8 Go et plus",
    speedHint: "environ 2 à 4 min par lien",
    url: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
    fileName: "gemma-3-4b-it-Q4_K_M.gguf",
    projector: {
      url: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/mmproj-model-f16.gguf",
      fileName: "gemma-3-4b-it-mmproj-f16.gguf",
      bytes: 851_251_104,
    },
    senses: ["image"],
    notes:
      "La génération précédente, éprouvée de longue date avec le moteur de l'application : elle regarde les photos et les images des vidéos, mais n'écoute pas le son. Prend le relais seule si Gemma 4 échoue sur ce téléphone.",
  },
  {
    id: "qwen3-4b-instruct-2507-q4km",
    label: "Qwen 3 4B Instruct (2507)",
    bytes: 2_497_280_736,
    ramHint: "8 Go et plus",
    speedHint: "environ 2 à 4 min par lien",
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    fileName: "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    notes:
      "Texte seulement : bon pour ranger d'après la légende, aveugle aux images et sourd aux vidéos.",
  },
  {
    id: "qwen2.5-7b-instruct-q4km",
    label: "Qwen 2.5 7B Instruct",
    bytes: 4_683_074_240,
    ramHint: "12 Go et plus",
    speedHint: "environ 5 à 10 min par lien",
    heavy: true,
    url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    fileName: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    notes:
      "Le plus fin sur le classement, mais lent : il occupe environ 5,5 Go de mémoire et tourne sur le processeur, pas sur le GPU. À réserver à qui accepte d'attendre plusieurs minutes par lien.",
  },
  {
    id: "qwen2.5-3b-instruct-q4km",
    label: "Qwen 2.5 3B Instruct",
    bytes: 1_929_903_264,
    ramHint: "8 Go et plus",
    speedHint: "environ 1 à 3 min par lien",
    url: "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
    fileName: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
    notes:
      "L'ancien choix par défaut : plus rapide que Qwen 3 4B, mais se trompe plus souvent de tiroir.",
  },
  {
    id: "llama-3.2-3b-instruct-q4km",
    label: "Llama 3.2 3B Instruct",
    bytes: 2_019_377_696,
    ramHint: "8 Go et plus",
    speedHint: "environ 1 à 3 min par lien",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    notes: "Alternative de qualité comparable, un peu plus lourde.",
  },
  {
    id: "qwen2.5-1.5b-instruct-q4km",
    label: "Qwen 2.5 1.5B Instruct",
    bytes: 986_048_768,
    ramHint: "6 Go",
    speedHint: "moins d'une minute par lien",
    url: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    fileName: "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    notes: "Deux fois plus rapide, tags un peu plus génériques.",
  },
  {
    id: "gemma-3-1b-it-q4km",
    label: "Gemma 3 1B Instruct",
    bytes: 806_058_272,
    ramHint: "4 Go",
    speedHint: "quelques dizaines de secondes",
    url: "https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
    fileName: "gemma-3-1b-it-Q4_K_M.gguf",
    notes: "Le plus léger, pour les appareils modestes.",
  },
];

export function findModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((m) => m.id === id);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Modèle recommandé, et ceux qu'il remplace sans demander. */
export const RECOMMENDED_MODEL_ID = "gemma-4-e2b-it-q4";
/** Relève automatique quand un modèle échoue systématiquement sur l'appareil. */
export const FALLBACK_MODEL_ID = "gemma-3-4b-it-q4km";
export const SUPERSEDED_MODEL_IDS = ["qwen2.5-3b-instruct-q4km", "qwen3-4b-instruct-2507-q4km"];

/** Le projecteur d'un modèle, sous la forme d'un téléchargement à part entière. */
export function projectorDescriptor(model: ModelDescriptor): ModelDescriptor | null {
  if (!model.projector) return null;
  return {
    ...model,
    id: `${model.id}-mmproj`,
    label: `${model.label} (vision et son)`,
    url: model.projector.url,
    fileName: model.projector.fileName,
    bytes: model.projector.bytes,
    projector: undefined,
  };
}
