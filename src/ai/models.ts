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
}

export const MODELS: ModelDescriptor[] = [
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
      "Le meilleur choix par défaut : multilingue solide et respectueux des consignes de format JSON.",
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
