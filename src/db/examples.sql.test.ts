import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { CLASSIFICATION_EXAMPLES } from "./examples.sql.ts";
import { MIGRATIONS } from "./migrations.ts";

test("seuls les rangements corrigés ou validés servent d'exemples", () => {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  db.exec("INSERT INTO themes (id, name) VALUES ('t', 'Thème de test')");
  const add = (id: string, source: string | null, at: number) =>
    db
      .prepare(
        "INSERT INTO bookmarks (id, url, created_at, updated_at, theme_id, theme_source, subject) VALUES (?, ?, 0, ?, 't', ?, ?)",
      )
      .run(id, `https://x/${id}`, at, source, `sujet ${id}`);
  add("humain", "human", 1);
  add("valide", "ai", 2);
  add("rejete", "ai", 3);
  add("muet", "ai", 4);
  add("courant", "human", 5);
  const review = (b: string, verdict: string) =>
    db
      .prepare(
        "INSERT INTO reviews (id, bookmark_id, created_at, theme_verdict, snapshot) VALUES (?, ?, 10, ?, '{}')",
      )
      .run(`r-${b}`, b, verdict);
  review("valide", "good");
  review("rejete", "bad");

  const ids = db
    .prepare(CLASSIFICATION_EXAMPLES)
    .all("courant", 10)
    .map((r) => r.id);
  assert.deepEqual(ids, ["valide", "humain"]);
  db.close();
});
