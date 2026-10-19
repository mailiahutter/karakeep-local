import assert from "node:assert/strict";
import { test } from "node:test";

import { reminderPresets } from "./reminderTime.ts";

test("le matin, « ce soir » est proposé ; le soir tard, il ne l'est plus", () => {
  const morning = new Date(2026, 9, 20, 8, 0); // mardi
  assert.equal(reminderPresets(morning)[0].label, "Ce soir, 20 h");
  const late = new Date(2026, 9, 20, 21, 0);
  assert.equal(reminderPresets(late)[0].label, "Demain, 9 h");
});

test("samedi tombe bien le samedi suivant", () => {
  const tuesday = new Date(2026, 9, 20, 8, 0);
  const sat = reminderPresets(tuesday).find((p) => p.label.startsWith("Samedi"))!;
  assert.equal(new Date(sat.at).getDay(), 6);
  assert.equal(new Date(sat.at).getDate(), 24);
});

test("un vendredi, samedi est déjà « demain » : pas de doublon", () => {
  const friday = new Date(2026, 9, 23, 8, 0);
  assert.equal(reminderPresets(friday).filter((p) => p.label.startsWith("Samedi")).length, 0);
});
