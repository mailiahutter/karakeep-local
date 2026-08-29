import { getDb } from "./client";

/**
 * Réglages de l'application, stockés en base plutôt qu'en AsyncStorage pour
 * qu'ils partent avec la sauvegarde/restauration au même endroit que les données.
 */
export interface Settings {
  /** Langue demandée au modèle pour les tags générés. */
  aiLanguage: string;
  /** Style d'écriture des tags (repris de Karakeep). */
  tagStyle:
    | "as-generated"
    | "lowercase-hyphens"
    | "lowercase-spaces"
    | "lowercase-underscores"
    | "titlecase-spaces"
    | "titlecase-hyphens"
    | "camelCase";
  /** Identifiant du modèle GGUF choisi dans le catalogue. */
  modelId: string;
  /** Chemin local du modèle téléchargé, vide tant qu'aucun n'est installé. */
  modelPath: string;
  /** Tagging automatique à l'enregistrement. */
  autoTag: boolean;
  /** Extraction du contenu de la page à l'enregistrement. */
  autoFetch: boolean;
  /** Ne lancer le tagging que sur secteur, l'inférence étant gourmande. */
  aiOnlyWhenCharging: boolean;
  /** Proposer la relecture des propositions du modèle à l'ouverture. */
  reviewOnLaunch: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  aiLanguage: "français",
  tagStyle: "lowercase-hyphens",
  modelId: "qwen2.5-3b-instruct-q4km",
  modelPath: "",
  autoTag: true,
  autoFetch: true,
  aiOnlyWhenCharging: false,
  reviewOnLaunch: true,
};

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM settings",
  );
  const stored: Record<string, string> = {};
  for (const r of rows) stored[r.key] = r.value;

  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const raw = stored[key];
    if (raw === undefined) continue;
    const fallback = DEFAULT_SETTINGS[key];
    // Les valeurs sont sérialisées en JSON : un réglage corrompu ne doit pas
    // empêcher l'app de démarrer, on retombe sur le défaut.
    try {
      (out as Record<string, unknown>)[key] = JSON.parse(raw);
    } catch {
      (out as Record<string, unknown>)[key] = fallback;
    }
  }
  return out;
}

export async function saveSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)],
  );
}
