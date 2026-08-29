import * as Crypto from "expo-crypto";
import type * as SQLite from "expo-sqlite";

import { getDb } from "./client";

/**
 * Rangement par thème et sous-thème.
 *
 * C'est l'ossature de l'application telle qu'elle sert vraiment : mettre des
 * idées de côté pour les retrouver par sujet — une recette, une amélioration
 * pour la voiture, une idée d'aménagement de van. Le classement dans une liste
 * fermée est aussi une tâche bien plus sûre pour un petit modèle que
 * l'invention de mots-clés.
 */

export interface Subtheme {
  id: string;
  themeId: string;
  name: string;
  /** Consigne de rangement donnée au modèle. Voir `classify.ts`. */
  description: string | null;
  position: number;
  count?: number;
}

export interface Theme {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  position: number;
  subthemes: Subtheme[];
  count?: number;
}

/**
 * Arborescence de départ, reprise des exemples donnés par l'utilisateur.
 * Entièrement modifiable : ce n'est qu'une amorce pour que le classement soit
 * opérationnel dès la première capture.
 */
/**
 * Arborescence de départ, reprise des exemples donnés par l'utilisateur.
 * Entièrement modifiable depuis Réglages → Thèmes : ce n'est qu'une amorce
 * pour que le classement soit opérationnel dès la première capture.
 *
 * Chaque entrée porte une description : c'est elle, et non l'intitulé, qui dit
 * au modèle ce qui va dedans. « Moto › Ma sélection » et « Destinations
 * roadtrip › Roadtrip moto » ne se distinguent que par là.
 */
export const DEFAULT_THEMES: {
  name: string;
  icon: string;
  description: string;
  subthemes: { name: string; description: string }[];
}[] = [
  {
    name: "Recettes",
    icon: "🍽️",
    description: "Recettes de cuisine et idées de plats à refaire.",
    subthemes: [
      { name: "Viande", description: "Recettes à base de viande : bœuf, porc, volaille, agneau." },
      { name: "Healthy", description: "Recettes légères et équilibrées, riches en légumes." },
      { name: "Plats protéinés", description: "Recettes riches en protéines, pour la prise de muscle." },
      { name: "Perte de graisse", description: "Recettes pauvres en calories, pour la sèche." },
      { name: "Desserts", description: "Desserts, pâtisseries, goûters et boissons sucrées." },
    ],
  },
  {
    name: "Destinations roadtrip",
    icon: "🗺️",
    description: "Endroits où partir en voyage sur la route.",
    subthemes: [
      { name: "Roadtrip moto", description: "Itinéraires et destinations à faire à moto." },
      { name: "Roadtrip van aménagé", description: "Itinéraires et destinations à faire en van ou en fourgon." },
      { name: "Spots et bivouacs", description: "Lieux précis où dormir, se garer ou bivouaquer." },
    ],
  },
  {
    name: "Moto",
    icon: "🏍️",
    description: "La moto en tant que machine : modèles, pièces, équipement.",
    subthemes: [
      { name: "Ma sélection de motos", description: "Modèles de motos qui me plaisent ou que j'envisage d'acheter." },
      { name: "Tuning moto", description: "Modifications, préparation et personnalisation d'une moto." },
      { name: "Équipement", description: "Casques, gants, blousons, bagagerie et accessoires du pilote." },
    ],
  },
  {
    name: "Vanlife",
    icon: "🚐",
    description: "Vivre et voyager en van aménagé : le véhicule et son aménagement.",
    subthemes: [
      { name: "Idées d'aménagement", description: "Plans, agencements et astuces pour aménager l'intérieur d'un van." },
      { name: "Produits et matériel", description: "Produits précis à acheter pour un van : batterie, frigo, chauffage." },
      { name: "Fournisseurs de van aménagé", description: "Entreprises et artisans qui vendent ou aménagent des vans." },
    ],
  },
  {
    name: "Voiture",
    icon: "🚗",
    description: "La voiture : entretien, réparations, améliorations, modèles.",
    subthemes: [
      { name: "Améliorations", description: "Modifications et accessoires pour améliorer une voiture." },
      { name: "Entretien et réparation", description: "Tutoriels de réparation, entretien, pièces à changer." },
      { name: "Modèles visés", description: "Modèles de voitures que j'envisage d'acheter." },
    ],
  },
  {
    name: "Maison",
    icon: "🏠",
    description: "La maison : construction, architecture, aménagement, travaux.",
    subthemes: [
      { name: "Architecture", description: "Idées d'architecture, plans et styles de maisons." },
      { name: "Aménagement intérieur", description: "Décoration, mobilier et agencement des pièces." },
      { name: "Extérieur et jardin", description: "Terrasse, jardin, piscine, clôtures et extérieurs." },
      { name: "Travaux et bricolage", description: "Tutoriels de travaux, bricolage et rénovation." },
    ],
  },
];

interface ThemeRow {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  position: number;
}

interface SubthemeRow {
  id: string;
  theme_id: string;
  name: string;
  description: string | null;
  position: number;
}

/**
 * Crée l'arborescence de départ, une seule fois.
 *
 * La base est passée en argument : cette fonction est appelée depuis
 * l'ouverture de la base elle-même, où `getDb()` attendrait une promesse
 * encore en cours de résolution — un interblocage au démarrage.
 */
export async function seedThemesIfEmpty(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM themes",
  );
  if ((row?.n ?? 0) > 0) return;

  await db.withTransactionAsync(async () => {
    let tp = 0;
    for (const theme of DEFAULT_THEMES) {
      const themeId = Crypto.randomUUID();
      await db.runAsync(
        "INSERT INTO themes (id, name, icon, description, position) VALUES (?, ?, ?, ?, ?)",
        [themeId, theme.name, theme.icon, theme.description, tp++],
      );
      let sp = 0;
      for (const sub of theme.subthemes) {
        await db.runAsync(
          "INSERT INTO subthemes (id, theme_id, name, description, position) VALUES (?, ?, ?, ?, ?)",
          [Crypto.randomUUID(), themeId, sub.name, sub.description, sp++],
        );
      }
    }
  });
}

/** Arborescence complète, avec le nombre de favoris rangés dans chaque nœud. */
export async function listThemes(): Promise<Theme[]> {
  const db = await getDb();
  const themes = await db.getAllAsync<ThemeRow>(
    "SELECT * FROM themes ORDER BY position, name",
  );
  const subs = await db.getAllAsync<SubthemeRow>(
    "SELECT * FROM subthemes ORDER BY position, name",
  );
  const themeCounts = await db.getAllAsync<{ theme_id: string; n: number }>(
    "SELECT theme_id, COUNT(*) AS n FROM bookmarks WHERE theme_id IS NOT NULL AND archived = 0 GROUP BY theme_id",
  );
  const subCounts = await db.getAllAsync<{ subtheme_id: string; n: number }>(
    "SELECT subtheme_id, COUNT(*) AS n FROM bookmarks WHERE subtheme_id IS NOT NULL AND archived = 0 GROUP BY subtheme_id",
  );

  const tc = new Map(themeCounts.map((r) => [r.theme_id, r.n]));
  const sc = new Map(subCounts.map((r) => [r.subtheme_id, r.n]));

  return themes.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    position: t.position,
    count: tc.get(t.id) ?? 0,
    subthemes: subs
      .filter((s) => s.theme_id === t.id)
      .map((s) => ({
        id: s.id,
        themeId: s.theme_id,
        name: s.name,
        description: s.description,
        position: s.position,
        count: sc.get(s.id) ?? 0,
      })),
  }));
}

/** Une description vide vaut « pas de consigne », pas une chaîne vide. */
function cleanDescription(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  return text.length > 0 ? text : null;
}

export async function createTheme(
  name: string,
  icon = "📁",
  description?: string | null,
): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM themes",
  );
  await db.runAsync(
    "INSERT INTO themes (id, name, icon, description, position) VALUES (?, ?, ?, ?, ?)",
    [id, name.trim(), icon, cleanDescription(description), row?.n ?? 0],
  );
  return id;
}

export async function createSubtheme(
  themeId: string,
  name: string,
  description?: string | null,
): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM subthemes WHERE theme_id = ?",
    [themeId],
  );
  await db.runAsync(
    "INSERT INTO subthemes (id, theme_id, name, description, position) VALUES (?, ?, ?, ?, ?)",
    [id, themeId, name.trim(), cleanDescription(description), row?.n ?? 0],
  );
  return id;
}

export async function updateTheme(
  id: string,
  fields: { name: string; icon?: string | null; description?: string | null },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE themes SET name = ?, icon = COALESCE(?, icon), description = ? WHERE id = ?",
    [
      fields.name.trim(),
      fields.icon ?? null,
      cleanDescription(fields.description),
      id,
    ],
  );
}

export async function updateSubtheme(
  id: string,
  fields: { name: string; description?: string | null },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE subthemes SET name = ?, description = ? WHERE id = ?",
    [fields.name.trim(), cleanDescription(fields.description), id],
  );
}

/** Nombre de favoris rangés sous un thème, sous-thèmes compris. */
export async function countUnderTheme(id: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM bookmarks WHERE theme_id = ?",
    [id],
  );
  return row?.n ?? 0;
}

export async function countUnderSubtheme(id: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM bookmarks WHERE subtheme_id = ?",
    [id],
  );
  return row?.n ?? 0;
}

export async function deleteTheme(id: string): Promise<void> {
  const db = await getDb();
  // Les favoris rangés là sont conservés : seule leur affectation tombe,
  // grâce au ON DELETE SET NULL.
  await db.runAsync("DELETE FROM themes WHERE id = ?", [id]);
}

export async function deleteSubtheme(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM subthemes WHERE id = ?", [id]);
}

/** Range un favori. `source` distingue une proposition du modèle d'un choix humain. */
export async function assignTheme(
  bookmarkId: string,
  themeId: string | null,
  subthemeId: string | null,
  source: "ai" | "human",
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE bookmarks
     SET theme_id = ?, subtheme_id = ?, theme_source = ?, updated_at = ?
     WHERE id = ?`,
    [themeId, subthemeId, source, Date.now(), bookmarkId],
  );
}

/**
 * Un classement corrigé à la main ne doit jamais être écrasé par un
 * reclassement automatique.
 */
export async function isHumanClassified(bookmarkId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ theme_source: string | null }>(
    "SELECT theme_source FROM bookmarks WHERE id = ?",
    [bookmarkId],
  );
  return row?.theme_source === "human";
}
