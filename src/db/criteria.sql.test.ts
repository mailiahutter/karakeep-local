import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { COUNT_TRUSTED_BY_THEME, REMOVED_FROM, TRUSTED_FOR_THEME } from "./criteria.sql.ts";
import { MIGRATIONS } from "./migrations.ts";

test("seuls les rangements qui font foi servent à apprendre ; les retraits aussi", () => {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  db.exec("DELETE FROM themes");
  db.exec("INSERT INTO themes (id, name) VALUES ('chien', 'Chien'), ('cuisine', 'Cuisine')");
  const add = (id: string, theme: string | null, source: string | null, verified: number | null, subject: string) =>
    db
      .prepare(
        "INSERT INTO bookmarks (id, url, created_at, updated_at, theme_id, theme_source, verified_at, subject) VALUES (?, ?, 0, 0, ?, ?, ?, ?)",
      )
      .run(id, `https://x/${id}`, theme, source, verified, subject);
  add("a", "chien", "human", null, "Harnais en cuir");
  add("b", "chien", "ai", 5, "Laisse rétractable");
  add("c", "chien", "ai", null, "Rangé seul par l'IA");
  add("d", "cuisine", "human", null, "Croquettes maison");
  db.prepare(
    "INSERT INTO reviews (id, bookmark_id, created_at, theme_verdict, snapshot) VALUES ('r', 'd', 1, 'bad', ?)",
  ).run(JSON.stringify({ theme: "Chien › Nourriture" }));

  const texts = db.prepare(TRUSTED_FOR_THEME).all("chien", 20).map((r) => r.text).sort();
  assert.deepEqual(texts, ["Harnais en cuir", "Laisse rétractable"]);
  const counts = Object.fromEntries(db.prepare(COUNT_TRUSTED_BY_THEME).all().map((r) => [r.id, r.n]));
  assert.deepEqual(counts, { chien: 2, cuisine: 1 });
  const removed = db.prepare(REMOVED_FROM).all("Chien", "Chien", "chien", 10).map((r) => r.text);
  assert.deepEqual(removed, ["Croquettes maison"]);
  db.close();
});
