import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DESCRIPTION_CHARS,
  buildChoicePrompt,
  buildSubthemeOptions,
  buildThemeOptions,
  parseChoice,
  pickExamples,
  resolveChoice,
  shortlist,
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
  assert.ok(p.includes("1. Moto (contient : Ma sélection, Tuning) — La moto en tant que machine."));
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

test("les exemples de l'utilisateur sont montrés avec le numéro de leur catégorie", () => {
  const options = buildThemeOptions(TREE);
  const examples = pickExamples(
    [
      { text: "Une Triumph Bonneville d'occasion", optionId: "t-moto" },
      { text: "Col du Stelvio à moto", optionId: "t-road" },
      { text: "Thème supprimé depuis", optionId: "t-absent" },
    ],
    options,
  );
  const prompt = buildChoicePrompt(options, "Titre : Ducati Scrambler", "Aucune", examples);
  assert.match(prompt, /« Une Triumph Bonneville d'occasion » → 1\. Moto/);
  assert.match(prompt, /« Col du Stelvio à moto » → 2\. Destinations roadtrip/);
  assert.doesNotMatch(prompt, /supprimé/);
});

test("sans exemple, le prompt ne mentionne pas d'exemples", () => {
  const prompt = buildChoicePrompt(buildThemeOptions(TREE), "x", "Aucune");
  assert.doesNotMatch(prompt, /déjà rangés/);
});

test("un thème très fourni n'écrase pas les autres exemples", () => {
  const options = buildThemeOptions(TREE);
  const many = Array.from({ length: 6 }, (_, i) => ({ text: `Moto ${i}`, optionId: "t-moto" }));
  const picked = pickExamples([...many, { text: "Route 66", optionId: "t-road" }], options);
  assert.equal(picked.filter((e) => e.optionId === "t-moto").length, 2);
  assert.ok(picked.some((e) => e.optionId === "t-road"));
});

test("le pré-tri garde les catégories les plus proches et renumérote", () => {
  const options = [
    { index: 1, id: "a", name: "A", description: null },
    { index: 2, id: "b", name: "B", description: null },
    { index: 3, id: "c", name: "C", description: null },
    { index: 4, id: "d", name: "D", description: null },
    { index: 5, id: "e", name: "E", description: null },
  ];
  const vectors = new Map([
    ["a", [1, 0]],
    ["b", [0, 1]],
    ["c", [0.9, 0.1]],
    ["d", [-1, 0]],
    ["e", [0.7, 0.7]],
  ]);
  const kept = shortlist(options, [1, 0], vectors, 2);
  assert.deepEqual(kept.map((o) => o.id), ["a", "c"]);
  assert.deepEqual(kept.map((o) => o.index), [1, 2]);
});

test("une catégorie sans vecteur n'est jamais écartée", () => {
  const options = buildThemeOptions([...TREE, { id: "t-x", name: "X", subthemes: [] }, { id: "t-y", name: "Y", subthemes: [] }]);
  const vectors = new Map([["t-moto", [1, 0]], ["t-road", [0, 1]], ["t-divers", [0, 1]], ["t-x", [0, 1]]]);
  const kept = shortlist(options, [1, 0], vectors, 2);
  assert.ok(kept.some((o) => o.id === "t-y"));
  assert.ok(kept.some((o) => o.id === "t-moto"));
});

test("la proposition de tiroir est lue et nettoyée", async () => {
  const { parseSuggestion } = await import("./classify.ts");
  assert.deepEqual(
    parseSuggestion('Voici : {"name": "course à pied", "emoji": "🏃 sport", "description": "Entraînements et courses."}'),
    { name: "Course à pied", emoji: "🏃", description: "Entraînements et courses." },
  );
  assert.equal(parseSuggestion("pas de json"), null);
  assert.equal(parseSuggestion('{"name": "", "emoji": "x", "description": ""}'), null);
  assert.equal(parseSuggestion('{"name": "Jardin", "emoji": "", "description": ""}')?.emoji, "📁");
});

test("les sous-thèmes précisent ce que contient chaque thème", () => {
  const prompt = buildChoicePrompt(buildThemeOptions(TREE), "x", "Aucune");
  assert.match(prompt, /1\. Moto \(contient : Ma sélection, Tuning\) — La moto/);
  assert.match(prompt, /3\. Divers\n/);
});

test("le vote des voisins désigne la catégorie majoritaire", async () => {
  const { nearestVote } = await import("./classify.ts");
  const v = nearestVote([1, 0], [
    { vector: [1, 0.05], optionId: "chien" },
    { vector: [0.95, 0.1], optionId: "chien" },
    { vector: [0.9, 0.2], optionId: "chien" },
    { vector: [0, 1], optionId: "van" },
  ]);
  assert.equal(v?.optionId, "chien");
  assert.ok(v!.share > 0.9);
});

test("un vote net corrige un modèle hésitant, jamais un modèle sûr", async () => {
  const { arbitrate } = await import("./classify.ts");
  const vote = { optionId: "chien", share: 0.8, best: 0.9 };
  assert.deepEqual(arbitrate({ id: "van", confidence: 0.4 }, vote, 5), { id: "chien", confidence: 0.72, byVote: true });
  assert.equal(arbitrate({ id: "van", confidence: 0.9 }, vote, 5).id, "van");
  assert.equal(arbitrate({ id: null, confidence: null }, vote, 5).id, "chien");
  assert.equal(arbitrate({ id: "van", confidence: 0.4 }, vote, 2).id, "van");
  assert.equal(arbitrate({ id: "chien", confidence: 0.5 }, vote, 5).confidence, 0.8);
});

test("un titre seul ne suffit pas pour ranger", async () => {
  const { isThin } = await import("./classify.ts");
  assert.equal(isThin("Titre : Instagram"), true);
  assert.equal(isThin("Titre : Harnais\nSujet : Un harnais en cuir pour chien fait main à Hambourg."), false);
});

test("les critères appris sont montrés sous la catégorie", () => {
  const tree: ThemeTree[] = [
    { id: "c", name: "Chien", description: "Tout pour le chien.", learnedCriteria: "Harnais, laisses ; pas la nourriture.", subthemes: [] },
  ];
  const prompt = buildChoicePrompt(buildThemeOptions(tree), "x", "Aucune");
  assert.match(prompt, /1\. Chien — Tout pour le chien\.\n   D'après ses rangements : Harnais, laisses ; pas la nourriture\./);
});
