import assert from "node:assert/strict";
import { test } from "node:test";

import { isIoniconName, normalizeIconInput } from "./icons.ts";

test("les anciens thèmes gardent leur icône vectorielle", () => {
  assert.equal(isIoniconName("bus-outline"), true);
  assert.equal(isIoniconName("car-sport-outline"), true);
});

test("un emoji n'est pas confondu avec un nom d'icône", () => {
  for (const emoji of ["🚐", "🐕", "⛺", "🏍️", "👨‍👩‍👧", "🇫🇷", "❤️"]) {
    assert.equal(isIoniconName(emoji), false, emoji);
  }
});

test("l'absence d'icône est gérée", () => {
  assert.equal(isIoniconName(null), false);
  assert.equal(isIoniconName(undefined), false);
  assert.equal(isIoniconName(""), false);
});

test("les emoji composés sont conservés entiers", () => {
  // Drapeau, famille, teinte de peau : plusieurs unités de code pour un seul
  // symbole. Couper au premier caractère les casserait.
  for (const emoji of ["🇫🇷", "👨‍👩‍👧", "👍🏽", "🏍️"]) {
    assert.equal(normalizeIconInput(emoji), emoji, emoji);
  }
});

test("un mot saisi par erreur n'est pas pris pour une icône", () => {
  assert.equal(normalizeIconInput("Vanlife"), null);
  assert.equal(normalizeIconInput("  "), null);
  assert.equal(normalizeIconInput("123"), null);
});

test("une saisie trop longue est ramenée au premier symbole", () => {
  assert.equal(normalizeIconInput("🚐🚗🏍️🐕🐈🐴⛺🏠🔧🌱⚡💡📚"), "🚐");
});
