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
  position: number;
  count?: number;
}

export interface Theme {
  id: string;
  name: string;
  icon: string | null;
  position: number;
  subthemes: Subtheme[];
  count?: number;
}

/**
 * Arborescence de départ, reprise des exemples donnés par l'utilisateur.
 * Entièrement modifiable : ce n'est qu'une amorce pour que le classement soit
 * opérationnel dès la première capture.
 */
export const DEFAULT_THEMES: {
  name: string;
  icon: string;
  subthemes: string[];
}[] = [
  {
    name: "Recettes",
    icon: "restaurant-outline",
    subthemes: [
      "Viande",
      "Healthy",
      "Plats protéinés",
      "Perte de graisse",
      "Desserts",
    ],
  },
  {
    name: "Destinations roadtrip",
    icon: "map-outline",
    subthemes: ["Roadtrip moto", "Roadtrip van aménagé", "Spots et bivouacs"],
  },
  {
    name: "Moto",
    icon: "bicycle-outline",
    subthemes: ["Ma sélection de motos", "Tuning moto", "Équipement"],
  },
  {
    name: "Vanlife",
    icon: "bus-outline",
    subthemes: [
      "Idées d'aménagement",
      "Produits et matériel",
      "Fournisseurs de van aménagé",
    ],
  },
  {
    name: "Voiture",
    icon: "car-sport-outline",
    subthemes: ["Améliorations", "Entretien et réparation", "Modèles visés"],
  },
  {
    name: "Maison",
    icon: "home-outline",
    subthemes: [
      "Architecture",
      "Aménagement intérieur",
      "Extérieur et jardin",
      "Travaux et bricolage",
    ],
  },
];

interface ThemeRow {
  id: string;
  name: string;
  icon: string | null;
  position: number;
}

interface SubthemeRow {
  id: string;
  theme_id: string;
  name: string;
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
        "INSERT INTO themes (id, name, icon, position) VALUES (?, ?, ?, ?)",
        [themeId, theme.name, theme.icon, tp++],
      );
      let sp = 0;
      for (const name of theme.subthemes) {
        await db.runAsync(
          "INSERT INTO subthemes (id, theme_id, name, position) VALUES (?, ?, ?, ?)",
          [Crypto.randomUUID(), themeId, name, sp++],
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
    position: t.position,
    count: tc.get(t.id) ?? 0,
    subthemes: subs
      .filter((s) => s.theme_id === t.id)
      .map((s) => ({
        id: s.id,
        themeId: s.theme_id,
        name: s.name,
        position: s.position,
        count: sc.get(s.id) ?? 0,
      })),
  }));
}

export async function createTheme(name: string, icon = "folder-outline"): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM themes",
  );
  await db.runAsync(
    "INSERT INTO themes (id, name, icon, position) VALUES (?, ?, ?, ?)",
    [id, name.trim(), icon, row?.n ?? 0],
  );
  return id;
}

export async function createSubtheme(
  themeId: string,
  name: string,
): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM subthemes WHERE theme_id = ?",
    [themeId],
  );
  await db.runAsync(
    "INSERT INTO subthemes (id, theme_id, name, position) VALUES (?, ?, ?, ?)",
    [id, themeId, name.trim(), row?.n ?? 0],
  );
  return id;
}

export async function renameTheme(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE themes SET name = ? WHERE id = ?", [name.trim(), id]);
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
