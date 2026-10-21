import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MIGRATIONS } from "./migrations.ts";
import { REQUEUE_AI, REQUEUE_FETCH } from "./requeue.sql.ts";

function migrated(upTo = MIGRATIONS.length): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (let i = 0; i < upTo; i++) db.exec(MIGRATIONS[i]);
  db.exec("INSERT INTO themes (id, name) VALUES ('t', 'Thème de test')");
  return db;
}

function insert(db: DatabaseSync, id: string, cols: Record<string, unknown>): void {
  const row: Record<string, unknown> = {
    id,
    url: `https://exemple.fr/${id}`,
    created_at: 0,
    updated_at: 0,
    fetch_status: "success",
    ai_status: "success",
    content: "Du texte",
    summary: "Résumé",
    subject: "Sujet",
    theme_id: "t",
    ...cols,
  };
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO bookmarks (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...(Object.values(row) as never[]));
}

function status(db: DatabaseSync, id: string): { fetch: string; ai: string } {
  const r = db
    .prepare("SELECT fetch_status AS fetch, ai_status AS ai FROM bookmarks WHERE id = ?")
    .get(id) as { fetch: string; ai: string };
  return { fetch: r.fetch, ai: r.ai };
}

function seed(db: DatabaseSync): void {
  insert(db, "fini", {});
  insert(db, "erreur", { fetch_status: "error", fetch_attempts: 5 });
  insert(db, "vide", { content: null });
  insert(db, "vide-media", { content: null });
  db.exec(
    "INSERT INTO assets (id, bookmark_id, kind, path, created_at) VALUES ('a', 'vide-media', 'image', 'x', 0)",
  );
  insert(db, "sans-theme", { theme_id: null });
  insert(db, "sans-resume", { summary: null });
  insert(db, "ia-sautee", { ai_status: "skipped" });
  insert(db, "insta", { source_kind: "instagram" });
  insert(db, "archive", { fetch_status: "error", archived: 1 });
}

test("« Tout relancer » reprend ce qui n'a pas abouti, et rien d'autre", () => {
  const db = migrated();
  seed(db);
  db.exec(REQUEUE_FETCH);
  db.exec(REQUEUE_AI);

  assert.deepEqual(status(db, "fini"), { fetch: "success", ai: "success" });
  assert.deepEqual(status(db, "erreur"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "vide"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "vide-media"), { fetch: "success", ai: "success" });
  assert.deepEqual(status(db, "sans-theme"), { fetch: "success", ai: "pending" });
  assert.deepEqual(status(db, "sans-resume"), { fetch: "success", ai: "pending" });
  assert.deepEqual(status(db, "ia-sautee"), { fetch: "success", ai: "pending" });
  // Publication Instagram sans aucun média : pas vraiment lue, elle repart.
  assert.deepEqual(status(db, "insta"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "archive"), { fetch: "error", ai: "success" });

  const attempts = db.prepare("SELECT fetch_attempts AS n FROM bookmarks WHERE id = 'erreur'").get() as { n: number };
  assert.equal(attempts.n, 0);
  db.close();
});

test("la migration 011 refait aussi toutes les publications Instagram", () => {
  const db = migrated(10);
  seed(db);
  db.exec(MIGRATIONS[10]);

  assert.deepEqual(status(db, "insta"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "fini"), { fetch: "success", ai: "success" });
  assert.deepEqual(status(db, "erreur"), { fetch: "pending", ai: "pending" });
  db.close();
});

test("la migration 014 relit les publications Instagram sans média, même déclarées disparues", () => {
  const db = migrated(13);
  insert(db, "ig-vide", { source_kind: "instagram" });
  insert(db, "ig-disparue", { source_kind: "instagram", fetch_status: "error", source_gone: 1, retry_days: 4 });
  insert(db, "ig-ok", { source_kind: "instagram", theme_source: "human" });
  db.exec("INSERT INTO assets (id, bookmark_id, kind, path, created_at) VALUES ('m', 'ig-ok', 'image', 'x', 0)");
  db.exec(MIGRATIONS[13]);
  assert.deepEqual(status(db, "ig-vide"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "ig-disparue"), { fetch: "pending", ai: "pending" });
  assert.deepEqual(status(db, "ig-ok"), { fetch: "success", ai: "success" });
  const gone = db.prepare("SELECT source_gone AS g, retry_days AS r FROM bookmarks WHERE id = 'ig-disparue'").get() as { g: number; r: number };
  assert.deepEqual({ ...gone }, { g: 0, r: 0 });
  db.close();
});
