import assert from "node:assert/strict";
import { test } from "node:test";

import { passageKey, splitParagraphs } from "./paragraphs.ts";

test("le texte est découpé en paragraphes", () => {
  assert.deepEqual(splitParagraphs("Un.\n\nDeux  mots.\n\n\nTrois."), ["Un.", "Deux mots.", "Trois."]);
  assert.deepEqual(splitParagraphs(null), []);
});

test("un surlignage se reconnaît malgré des espaces différents", () => {
  assert.equal(passageKey(" Deux\n mots "), passageKey("deux mots"));
});
