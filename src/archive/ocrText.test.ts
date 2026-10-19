import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeOcr, withOcr } from "./ocrText.ts";

test("le texte des images est dédoublonné et nettoyé", () => {
  const merged = mergeOcr(["Recette du pain\n@compte\nx", "  Recette   du pain \nFarine 500 g", null]);
  assert.equal(merged, "Recette du pain\n@compte\nFarine 500 g");
});

test("le texte des images est borné", () => {
  const merged = mergeOcr(["a".repeat(50) + "\n" + "b".repeat(50)], 60);
  assert.ok(merged.length <= 60);
  assert.ok(merged.endsWith("…"));
});

test("le texte des images s'ajoute après celui de la page", () => {
  assert.equal(withOcr("Légende", "Farine"), "Légende\n\nTexte lu dans les images :\nFarine");
  assert.equal(withOcr(null, "Farine"), "Texte lu dans les images :\nFarine");
  assert.equal(withOcr("Légende", ""), "Légende");
});
