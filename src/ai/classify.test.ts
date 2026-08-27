import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildClassifyPrompt,
  buildOptions,
  parseChoice,
  resolveChoice,
  type ThemeTree,
} from "./classify.ts";

/** Arborescence reprise des thèmes demandés par l'utilisateur. */
const TREE: ThemeTree[] = [
  {
    id: "t-rec",
    name: "Recettes",
    subthemes: [
      { id: "s-viande", name: "Viande" },
      { id: "s-healthy", name: "Healthy" },
    ],
  },
  {
    id: "t-van",
    name: "Vanlife",
    subthemes: [
      { id: "s-amenage", name: "Idées d'aménagement" },
      { id: "s-produits", name: "Produits et matériel" },
    ],
  },
  { id: "t-divers", name: "Divers", subthemes: [] },
];

test("un thème sans sous-thème reste choisissable", () => {
  const options = buildOptions(TREE);
  const divers = options.find((o) => o.themeId === "t-divers");
  assert.ok(divers, "le thème sans sous-thème doit apparaître");
  assert.equal(divers.subthemeId, null);
});

test("un thème avec sous-thèmes n'est proposé que par ceux-ci", () => {
  const options = buildOptions(TREE);
  // Sans cette règle, le modèle rangerait tout à la racine par facilité.
  const racine = options.filter(
    (o) => o.themeId === "t-rec" && o.subthemeId === null,
  );
  assert.equal(racine.length, 0);
  assert.equal(options.filter((o) => o.themeId === "t-rec").length, 2);
});

test("les numéros sont continus à partir de 1", () => {
  const options = buildOptions(TREE);
  assert.deepEqual(
    options.map((o) => o.index),
    [1, 2, 3, 4, 5],
  );
});

test("le prompt liste les catégories et l'option zéro", () => {
  const p = buildClassifyPrompt(
    buildOptions(TREE),
    "Aménager son van",
    "Comment poser une banquette convertible dans un fourgon.",
  );
  assert.ok(p.includes("1. Recettes › Viande"));
  assert.ok(p.includes("4. Vanlife › Produits et matériel"));
  assert.ok(p.includes("5. Divers"));
  assert.ok(p.includes("0. Aucune"));
  assert.ok(p.includes("banquette convertible"));
});

test("lit un numéro même noyé dans une phrase", () => {
  // Un petit modèle justifie volontiers sa réponse malgré la consigne.
  assert.equal(parseChoice("3", 5), 3);
  assert.equal(parseChoice("La catégorie est : 3", 5), 3);
  assert.equal(parseChoice("```\n3\n```", 5), 3);
  assert.equal(parseChoice("0", 5), 0);
});

test("rejette un numéro hors de la liste", () => {
  // Un modèle qui invente « 9 » sur cinq catégories ne doit rien ranger.
  assert.equal(parseChoice("9", 5), null);
  assert.equal(parseChoice("-2", 5), null);
  assert.equal(parseChoice("aucune idée", 5), null);
});

test("le numéro se traduit en affectation", () => {
  const options = buildOptions(TREE);
  assert.deepEqual(resolveChoice(options, 3), {
    themeId: "t-van",
    subthemeId: "s-amenage",
  });
  assert.deepEqual(resolveChoice(options, 5), {
    themeId: "t-divers",
    subthemeId: null,
  });
});

test("zéro et illisible ne rangent nulle part", () => {
  const options = buildOptions(TREE);
  assert.equal(resolveChoice(options, 0), null);
  assert.equal(resolveChoice(options, null), null);
});

test("une arborescence vide ne propose rien", () => {
  assert.deepEqual(buildOptions([]), []);
});
