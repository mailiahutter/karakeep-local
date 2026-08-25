import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSummaryPrompt, cleanSummary } from "./prompt.ts";

test("le prompt impose la longueur et la langue", () => {
  const p = buildSummaryPrompt("Titre", "Du contenu.", "français");
  assert.ok(p.includes("3 à 4 phrases"));
  assert.ok(p.includes("français"));
  assert.ok(p.includes("Titre"));
  assert.ok(p.includes("Du contenu."));
});

test("le contenu est tronqué au budget", () => {
  const p = buildSummaryPrompt(null, "x".repeat(50_000), "français", 300);
  assert.ok(p.length < 2000, `prompt trop long : ${p.length}`);
});

test("retire les amorces bavardes du modèle", () => {
  assert.equal(cleanSummary("Voici un résumé : Le sujet."), "Le sujet.");
  assert.equal(cleanSummary("Résumé : Le sujet."), "Le sujet.");
  assert.equal(cleanSummary("```\nLe sujet.\n```"), "Le sujet.");
  assert.equal(cleanSummary('  « Le sujet. »  '), "Le sujet.");
});

test("un résumé déjà propre est laissé intact", () => {
  const s = "Le texte décrit une méthode de compression. Elle repose sur un dictionnaire.";
  assert.equal(cleanSummary(s), s);
});
