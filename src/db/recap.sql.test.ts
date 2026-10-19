import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { MIGRATIONS } from "./migrations.ts";
import { ACTIVITY_SINCE, recapSentence } from "./recap.sql.ts";

test("le bilan compte ce qui a été fait depuis la dernière visite", () => {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  db.exec("INSERT INTO themes (id, name) VALUES ('t', 'Thème de test')");
  const add = (id: string, cols: string, values: string) =>
    db.exec(
      `INSERT INTO bookmarks (id, url, created_at, updated_at, fetch_status, ai_status${cols})
       VALUES ('${id}', 'https://x/${id}', 0, 0, 'success', 'success'${values})`,
    );
  add("avant", ", analysed_at, theme_id", ", 50, 't'");
  add("range", ", analysed_at, theme_id", ", 150, 't'");
  add("orphelin", ", analysed_at", ", 150");
  db.exec("INSERT INTO bookmarks (id, url, created_at, updated_at) VALUES ('attente', 'https://x/a', 0, 0)");
  const row = db.prepare(ACTIVITY_SINCE).get(100, 100, 100) as Record<string, number>;
  assert.equal(row.filed, 1);
  assert.equal(row.unfiled, 1);
  assert.equal(row.remaining, 1);
  db.close();
});

test("la phrase de bilan se tait quand rien n'a changé", () => {
  assert.equal(recapSentence({ filed: 0, unfiled: 0, gone: 0, remaining: 3 }), null);
  assert.equal(
    recapSentence({ filed: 12, unfiled: 0, gone: 0, remaining: 0 }),
    "Pendant ton absence : 12 liens rangés · tout est à jour",
  );
});
