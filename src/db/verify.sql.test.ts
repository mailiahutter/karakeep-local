import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MIGRATIONS } from "./migrations.ts";
import { COUNT_DOUBTS, DOUBTS, DRAWERS, FILED_SINCE } from "./verify.sql.ts";

function seeded(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  db.exec("DELETE FROM themes");
  db.exec("INSERT INTO themes (id, name, position) VALUES ('t', 'Chien', 0), ('u', 'Van', 1)");
  const add = (id: string, cols: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id, url: `https://x/${id}`, created_at: 1, updated_at: 1,
      fetch_status: "success", ai_status: "success", ...cols,
    };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO bookmarks (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...(Object.values(row) as never[]));
  };
  add("sur", { theme_id: "t", theme_source: "ai", ai_confidence: 0.9, analysed_at: 10, created_at: 5 });
  add("doute", { theme_id: "t", theme_source: "ai", ai_confidence: 0.5, analysed_at: 10 });
  add("tresdoute", { theme_id: "u", theme_source: "ai", ai_confidence: 0.3, analysed_at: 10 });
  add("orphelin", { analysed_at: 10 });
  add("humain", { theme_id: "t", theme_source: "human", ai_confidence: 0.1 });
  add("verifie", { theme_id: "t", theme_source: "ai", ai_confidence: 0.2, verified_at: 3 });
  add("ancien", { theme_id: "t", theme_source: "ai", analysed_at: 10 });
  db.exec("INSERT INTO assets (id, bookmark_id, kind, path, created_at) VALUES ('a', 'sur', 'image', '/sur.jpg', 1)");
  return db;
}

test("les doutes : sans tiroir d'abord, puis du moins au plus certain", () => {
  const db = seeded();
  const ids = db.prepare(DOUBTS).all(0.75, 10).map((r) => r.id);
  assert.deepEqual(ids, ["orphelin", "tresdoute", "doute"]);
  assert.equal((db.prepare(COUNT_DOUBTS).get(0.75) as { n: number }).n, 3);
});

test("rangé cette nuit : seulement ce que l'IA a rangé avec assez de certitude", () => {
  const db = seeded();
  const ids = db.prepare(FILED_SINCE).all(0.75, 5, 10).map((r) => r.id).sort();
  assert.deepEqual(ids, ["ancien", "sur"]);
});

test("chaque tiroir a son compte, ses nouveautés et sa couverture", () => {
  const db = seeded();
  const rows = db.prepare(DRAWERS).all(5) as { id: string; count: number; fresh: number; cover: string | null }[];
  const chien = rows.find((r) => r.id === "t")!;
  assert.equal(chien.cover, "/sur.jpg");
  assert.equal(chien.count, 5);
  assert.equal(chien.fresh, 3);
  assert.equal(rows.find((r) => r.id === "u")!.cover, null);
});
