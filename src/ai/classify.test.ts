import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DESCRIPTION_CHARS,
  buildChoicePrompt,
  buildSubthemeOptions,
  buildThemeOptions,
  parseChoice,
  resolveChoice,
  type ThemeTree,
} from "./classify.ts";

/** Arborescence reprise des thèmes demandés par l'utilisateur. */
const TREE: ThemeTree[] = [
  {
    id: "t-moto",
    name: "Moto",
    description: "La moto en tant que machine.",
    subthemes: [
      {
        id: "s-selection",
        name: "Ma sélection",
        description: "Modèles que j'envisage d'acheter.",
      },
      { id: "s-tuning", name: "Tuning", description: "  " },
    ],
  },
  {
    id: "t-road",
    name: "Destinations roadtrip",
    description: "Où partir sur la route.",
    subthemes: [{ id: "s-moto", name: "Roadtrip moto", description: null }],
  },
  { id: "t-divers", name: "Divers", subthemes: [] },
];

test("le premier niveau ne propose que les grands thèmes", () => {
  // Vingt et une options à plat était la question de trop : le modèle devait
  // tenir toutes les définitions en tête avant même de décider.
  const options = buildThemeOptions(TREE);
  assert.deepEqual(
    options.map((o) => o.name),
    ["Moto", "Destinations roadtrip", "Divers"],
  );
  assert.deepEqual(
    options.map((o) => o.index),
    [1, 2, 3],
  );
});

test("le second niveau ne propose que les sous-thèmes du thème retenu", () => {
  const options = buildSubthemeOptions(TREE[0]);
  assert.deepEqual(
    options.map((o) => o.name),
    ["Ma sélection", "Tuning"],
  );
  assert.deepEqual(
    options.map((o) => o.index),
    [1, 2],
  );
});

test("un sous-thème sans consigne hérite de celle de son thème", () => {
  // « Tuning » seul ne dit rien ; « la moto en tant que machine » situe.
  const options = buildSubthemeOptions(TREE[0]);
  assert.equal(options[1].description, "La moto en tant que machine.");
  assert.equal(buildSubthemeOptions(TREE[1])[0].description, "Où partir sur la route.");
});

test("un thème sans sous-thème n'offre pas de second niveau", () => {
  assert.deepEqual(buildSubthemeOptions(TREE[2]), []);
});

test("la consigne de l'utilisateur est donnée au modèle", () => {
  const p = buildChoicePrompt(
    buildThemeOptions(TREE),
    "Titre : Yamaha Ténéré 700",
    "Aucune de ces catégories",
  );
  assert.ok(p.includes("1. Moto — La moto en tant que machine."));
  assert.ok(p.includes("3. Divers\n"));
  assert.ok(p.includes("0. Aucune de ces catégories"));
  assert.ok(p.includes("Yamaha Ténéré 700"));
});

test("l'issue zéro dit ce qu'elle signifie à chaque niveau", () => {
  // Au second niveau, zéro ne veut pas dire « mauvais thème » mais « pas de
  // sous-thème précis » : confondre les deux annulerait un bon rangement.
  const p = buildChoicePrompt(
    buildSubthemeOptions(TREE[0]),
    "Titre : x",
    "Aucun sous-thème précis, laisser dans « Moto »",
  );
  assert.ok(p.includes("0. Aucun sous-thème précis, laisser dans « Moto »"));
});

test("une consigne trop longue est coupée", () => {
  const options = buildThemeOptions([
    { id: "t", name: "Long", description: "a".repeat(400), subthemes: [] },
  ]);
  assert.equal(options[0].description?.length, MAX_DESCRIPTION_CHARS);
  assert.ok(options[0].description?.endsWith("…"));
});

test("une consigne vide ne pollue pas la liste", () => {
  const options = buildThemeOptions([
    { id: "t", name: "Vide", description: "   \n  ", subthemes: [] },
  ]);
  assert.equal(options[0].description, null);
  assert.ok(!buildChoicePrompt(options, "x", "rien").includes("—"));
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

test("le numéro se traduit en identifiant", () => {
  const options = buildThemeOptions(TREE);
  assert.equal(resolveChoice(options, 2), "t-road");
  assert.equal(resolveChoice(options, 3), "t-divers");
});

test("zéro et illisible ne rangent nulle part", () => {
  const options = buildThemeOptions(TREE);
  assert.equal(resolveChoice(options, 0), null);
  assert.equal(resolveChoice(options, null), null);
  assert.equal(resolveChoice(options, 99), null);
});

test("une arborescence vide ne propose rien", () => {
  assert.deepEqual(buildThemeOptions([]), []);
});
