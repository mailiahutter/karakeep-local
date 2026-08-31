import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MIGRATIONS } from "./migrations.ts";

/**
 * Les migrations n'avaient jamais été exécutées ailleurs que sur l'appareil :
 * une erreur de syntaxe ne se serait vue qu'au démarrage, sur une base déjà
 * remplie. SQLite étant embarqué dans Node, rien n'empêche de les jouer ici.
 */
function migrate(db: DatabaseSync, upTo = MIGRATIONS.length): void {
  for (let i = 0; i < upTo; i++) {
    db.exec("BEGIN");
    db.exec(MIGRATIONS[i]);
    db.exec("COMMIT");
    db.exec(`PRAGMA user_version = ${i + 1}`);
  }
}

test("toutes les migrations s'appliquent sur une base vierge", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name as string);
  for (const expected of [
    "bookmarks",
    "tags",
    "bookmark_tags",
    "settings",
    "assets",
    "themes",
    "subthemes",
  ]) {
    assert.ok(tables.includes(expected), `table ${expected} manquante`);
  }
  db.close();
});

test("l'arborescence déjà semée reçoit les consignes de rangement", () => {
  const db = new DatabaseSync(":memory:");
  // État d'un utilisateur installé avant la 004 : des thèmes, aucune consigne.
  migrate(db, 3);
  db.exec(`
    INSERT INTO themes (id, name, icon, position) VALUES ('t1', 'Vanlife', 'bus-outline', 0);
    INSERT INTO themes (id, name, icon, position) VALUES ('t2', 'Mes trucs', 'folder-outline', 1);
    INSERT INTO subthemes (id, theme_id, name, position)
      VALUES ('s1', 't1', 'Idées d''aménagement', 0);
  `);

  migrate2(db);

  const van = db.prepare("SELECT description FROM themes WHERE id = 't1'").get();
  assert.ok(
    (van?.description as string).includes("van aménagé"),
    "le thème d'origine doit recevoir sa consigne",
  );

  const sub = db
    .prepare("SELECT description FROM subthemes WHERE id = 's1'")
    .get();
  assert.ok((sub?.description as string).length > 0);

  // Un thème créé par l'utilisateur ne porte aucun nom du catalogue : il doit
  // rester tel quel plutôt que d'hériter d'une consigne qui ne le décrit pas.
  const perso = db
    .prepare("SELECT description FROM themes WHERE id = 't2'")
    .get();
  assert.equal(perso?.description, null);

  db.close();
});

/** Applique la seule migration 004, la base étant déjà à la 003. */
function migrate2(db: DatabaseSync): void {
  db.exec("BEGIN");
  db.exec(MIGRATIONS[3]);
  db.exec("COMMIT");
  db.exec("PRAGMA user_version = 4");
}

test("le rattrapage ne touche que les consignes absentes", () => {
  // Rejouer une migration est impossible — `user_version` l'interdit —, donc
  // la garantie « ne jamais écraser ce que l'utilisateur a écrit » se vérifie
  // sur le texte : chaque UPDATE doit être filtré.
  const updates = MIGRATIONS[3].match(/UPDATE\s+(themes|subthemes)[\s\S]*?;/g);
  assert.ok(updates && updates.length > 0, "le rattrapage doit exister");
  for (const statement of updates) {
    assert.match(statement, /description IS NULL;$/);
  }
});

test("les icônes d'origine passent en emoji, un choix personnel est épargné", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, 4);
  db.exec(`
    INSERT INTO themes (id, name, icon, position) VALUES ('a', 'Vanlife', 'bus-outline', 0);
    INSERT INTO themes (id, name, icon, position) VALUES ('b', 'Moto', 'flame-outline', 1);
  `);
  db.exec("BEGIN");
  db.exec(MIGRATIONS[4]);
  db.exec("COMMIT");

  assert.equal(
    db.prepare("SELECT icon FROM themes WHERE id = 'a'").get()?.icon,
    "🚐",
  );
  // « Moto » ne porte plus l'icône d'origine : l'utilisateur l'a changée.
  assert.equal(
    db.prepare("SELECT icon FROM themes WHERE id = 'b'").get()?.icon,
    "flame-outline",
  );
  db.close();
});

test("le changement d'analyse remet les fiches en file, sauf celles rangées à la main", () => {
  const db = new DatabaseSync(":memory:");
  for (let i = 0; i < MIGRATIONS.length - 1; i++) {
    db.exec("BEGIN");
    db.exec(MIGRATIONS[i]);
    db.exec("COMMIT");
  }
  const add = (id: string, ai: string, source: string | null, archived = 0) =>
    db
      .prepare(
        `INSERT INTO bookmarks (id, url, created_at, updated_at, archived,
                                fetch_status, ai_status, theme_source)
         VALUES (?, ?, 1, 1, ?, 'success', ?, ?)`,
      )
      .run(id, `https://x.fr/${id}`, archived, ai, source);

  add("auto", "success", "ai");
  add("jamais", "success", null);
  add("humain", "success", "human");
  add("archive", "success", "ai", 1);
  add("encours", "pending", null);

  db.exec("BEGIN");
  db.exec(MIGRATIONS[MIGRATIONS.length - 1]);
  db.exec("COMMIT");

  const status = (id: string) =>
    db.prepare("SELECT ai_status FROM bookmarks WHERE id = ?").get(id)
      ?.ai_status;

  assert.equal(status("auto"), "pending");
  assert.equal(status("jamais"), "pending");
  // Un rangement fait à la main n'est jamais défait par le modèle.
  assert.equal(status("humain"), "success");
  // Les archives ne valent pas de recalcul.
  assert.equal(status("archive"), "success");
  db.close();
});
