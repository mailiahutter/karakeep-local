import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MIGRATIONS } from "./migrations.ts";
import {
  COUNT_PENDING_REVIEWS,
  PENDING_REVIEWS,
  REVIEW_COUNTS,
  UNEXPORTED_REVIEWS,
  UPSERT_REVIEW,
} from "./reviews.sql.ts";

/**
 * Les requêtes des avis jouées contre un vrai SQLite. La jointure qui exclut
 * les liens déjà jugés et l'écriture qui remplace un avis sont les deux
 * endroits où une erreur ne se verrait qu'à l'usage.
 */
function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of MIGRATIONS) {
    db.exec("BEGIN");
    db.exec(migration);
    db.exec("COMMIT");
  }
  return db;
}

function addBookmark(
  db: DatabaseSync,
  id: string,
  aiStatus: string,
  archived = 0,
): void {
  db.prepare(
    `INSERT INTO bookmarks (id, url, created_at, updated_at, archived, ai_status, fetch_status)
     VALUES (?, ?, ?, ?, ?, ?, 'success')`,
  ).run(id, `https://exemple.fr/${id}`, 1, 1, archived, aiStatus);
}

function review(db: DatabaseSync, id: string, bookmarkId: string, comment: string) {
  db.prepare(UPSERT_REVIEW).run(
    id,
    bookmarkId,
    Date.now(),
    "bad",
    null,
    null,
    null,
    comment,
    "{}",
  );
}

test("seuls les liens analysés et non jugés sont proposés", () => {
  const db = open();
  addBookmark(db, "ok", "success");
  addBookmark(db, "rate", "error");
  addBookmark(db, "sans-modele", "skipped");
  addBookmark(db, "en-cours", "pending");
  addBookmark(db, "archive", "success", 1);

  const ids = db
    .prepare(PENDING_REVIEWS)
    .all(50)
    .map((r) => r.id as string);
  assert.deepEqual(ids.sort(), ["ok", "rate", "sans-modele"]);
  assert.equal(db.prepare(COUNT_PENDING_REVIEWS).get()?.n, 3);
  db.close();
});

test("un lien jugé sort de la file", () => {
  const db = open();
  addBookmark(db, "a", "success");
  addBookmark(db, "b", "success");
  review(db, "r1", "a", "thème faux");

  const ids = db
    .prepare(PENDING_REVIEWS)
    .all(50)
    .map((r) => r.id as string);
  assert.deepEqual(ids, ["b"]);
  db.close();
});

test("se raviser remplace l'avis et le remet à transmettre", () => {
  const db = open();
  addBookmark(db, "a", "success");
  review(db, "r1", "a", "premier jet");
  db.prepare("UPDATE reviews SET exported_at = 123").run();

  review(db, "r2", "a", "en fait le thème était bon");

  const rows = db.prepare("SELECT * FROM reviews").all();
  assert.equal(rows.length, 1, "un seul avis par lien");
  assert.equal(rows[0].comment, "en fait le thème était bon");
  assert.equal(rows[0].exported_at, null, "un avis modifié repart à l'export");
  db.close();
});

test("l'export ne reprend que ce qui n'est pas parti", () => {
  const db = open();
  addBookmark(db, "a", "success");
  addBookmark(db, "b", "success");
  review(db, "r1", "a", "un");
  review(db, "r2", "b", "deux");
  db.prepare("UPDATE reviews SET exported_at = 123 WHERE bookmark_id = 'a'").run();

  const pending = db.prepare(UNEXPORTED_REVIEWS).all();
  assert.deepEqual(
    pending.map((r) => r.comment),
    ["deux"],
  );

  const counts = db.prepare(REVIEW_COUNTS).get();
  assert.equal(counts?.total, 2);
  assert.equal(counts?.unexported, 1);
  db.close();
});

test("supprimer un favori n'efface pas le retour qu'il a produit", () => {
  const db = open();
  addBookmark(db, "a", "success");
  review(db, "r1", "a", "le classement était faux");
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare("DELETE FROM bookmarks WHERE id = 'a'").run();

  // L'avis porte sur le comportement du modèle, pas sur le lien : il doit
  // survivre pour être transmis.
  assert.equal(db.prepare(REVIEW_COUNTS).get()?.unexported, 1);
  db.close();
});
