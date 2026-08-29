import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DESCRIPTION_CHARS,
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

/** Même arborescence, décrite par l'utilisateur pour guider le modèle. */
const DECRIT: ThemeTree[] = [
  {
    id: "t-moto",
    name: "Moto",
    description: "Tout ce qui touche à la moto.",
    subthemes: [
      {
        id: "s-selection",
        name: "Ma sélection",
        description: "Modèles de motos que j'envisage d'acheter.",
      },
      { id: "s-tuning", name: "Tuning", description: "  " },
    ],
  },
  { id: "t-divers", name: "Divers", subthemes: [] },
];

test("la consigne de l'utilisateur est donnée au modèle", () => {
  const p = buildClassifyPrompt(buildOptions(DECRIT), "Yamaha Ténéré 700", "");
  // Sans elle, « Moto › Ma sélection » ne dit pas s'il s'agit de motos à
  // acheter ou d'itinéraires.
  assert.ok(
    p.includes("1. Moto › Ma sélection — Modèles de motos que j'envisage d'acheter."),
  );
});

test("un sous-thème sans consigne hérite de celle du thème", () => {
  const options = buildOptions(DECRIT);
  const tuning = options.find((o) => o.subthemeId === "s-tuning");
  assert.equal(tuning?.description, "Tout ce qui touche à la moto.");
});

test("une consigne vide ou en blancs ne pollue pas la liste", () => {
  const options = buildOptions([
    { id: "t", name: "Vide", description: "   \n  ", subthemes: [] },
  ]);
  assert.equal(options[0].description, null);
  assert.ok(!buildClassifyPrompt(options, "x", "y").includes("—"));
});

test("une consigne trop longue est coupée", () => {
  const long = "a".repeat(400);
  const options = buildOptions([
    { id: "t", name: "Long", description: long, subthemes: [] },
  ]);
  // Une tartine par catégorie éloignerait le document de la consigne finale.
  assert.equal(options[0].description?.length, MAX_DESCRIPTION_CHARS);
  assert.ok(options[0].description?.endsWith("…"));
});

test("l'arborescence sans description reste utilisable telle quelle", () => {
  const p = buildClassifyPrompt(buildOptions(TREE), "Aménager son van", "");
  assert.ok(p.includes("3. Vanlife › Idées d'aménagement\n"));
});
