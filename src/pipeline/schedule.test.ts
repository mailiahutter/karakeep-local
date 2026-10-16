import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatWindow,
  nextOccurrence,
  parseWindow,
  untilLabel,
} from "./schedule.ts";

test("l'heure se lit dans les écritures courantes", () => {
  assert.deepEqual(parseWindow("03:00"), { hour: 3, minute: 0 });
  assert.deepEqual(parseWindow("3:5"), { hour: 3, minute: 5 });
  assert.deepEqual(parseWindow(" 23h30 "), { hour: 23, minute: 30 });
});

test("une heure impossible ne programme rien", () => {
  // Mieux vaut aucune séance qu'une alarme posée à une heure absurde.
  assert.equal(parseWindow("24:00"), null);
  assert.equal(parseWindow("12:60"), null);
  assert.equal(parseWindow(""), null);
  assert.equal(parseWindow("la nuit"), null);
});

test("l'heure se réécrit sur deux chiffres", () => {
  assert.equal(formatWindow({ hour: 3, minute: 5 }), "03:05");
  assert.equal(formatWindow(null), "");
});

test("la prochaine séance est aujourd'hui si l'heure n'est pas passée", () => {
  const now = new Date(2026, 9, 16, 1, 0, 0).getTime();
  const at = new Date(nextOccurrence({ hour: 3, minute: 0 }, now));
  assert.equal(at.getDate(), 16);
  assert.equal(at.getHours(), 3);
});

test("elle bascule à demain une fois l'heure passée", () => {
  const now = new Date(2026, 9, 16, 4, 0, 0).getTime();
  const at = new Date(nextOccurrence({ hour: 3, minute: 0 }, now));
  assert.equal(at.getDate(), 17);
});

test("l'heure pile du jour même ne compte pas pour maintenant", () => {
  // Sinon la séance serait annoncée « dans 0 min » toute la journée.
  const now = new Date(2026, 9, 16, 3, 0, 0).getTime();
  assert.equal(new Date(nextOccurrence({ hour: 3, minute: 0 }, now)).getDate(), 17);
});

test("l'attente s'annonce en heures et minutes", () => {
  const now = 1_000_000;
  assert.equal(untilLabel(now + 40 * 60_000, now), "dans 40 min");
  assert.equal(untilLabel(now + 2 * 3_600_000, now), "dans 2 h");
  assert.equal(untilLabel(now + 7 * 3_600_000 + 20 * 60_000, now), "dans 7 h 20");
  assert.equal(untilLabel(now - 5000, now), "dans 0 min");
});
