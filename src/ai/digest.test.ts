import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDigestPrompt,
  describeForClassification,
  parseDigest,
} from "./digest.ts";

const INPUT = {
  title: "Colliers en cuir sur mesure pour Braque de Weimar",
  description: "Créations adaptées à sa morphologie.",
  content: "Le Braque de Weimar est un chien athlétique. Un collier trop fin blesse.",
  url: "https://atelier-napoleon.com/colliers",
  language: "français",
  tagStyle: "lowercase-hyphens" as const,
};

test("le prompt demande la chose concrète, pas le type de page", () => {
  const p = buildDigestPrompt(INPUT);
  // Sans cette consigne, un petit modèle répond « un article de blog ».
  assert.ok(p.includes("Pas « un article de blog »"));
  assert.ok(p.includes("Braque de Weimar"));
  assert.ok(p.includes("atelier-napoleon.com"));
  assert.ok(p.includes("français"));
});

test("le contenu est borné", () => {
  const p = buildDigestPrompt({
    ...INPUT,
    content: "mot ".repeat(5000),
    maxContentChars: 100,
  });
  assert.ok(p.length < 1500);
});

test("lit une réponse propre", () => {
  const d = parseDigest('{"sujet":"Colliers en cuir pour chien","motscles":["chien","cuir"]}');
  assert.equal(d?.subject, "Colliers en cuir pour chien");
  assert.deepEqual(d?.keywords, ["chien", "cuir"]);
});

test("lit une réponse bavarde ou enveloppée", () => {
  const d = parseDigest(
    'Voici :\n```json\n{"sujet":"Van aménagé","motscles":["van","aménagement"]}\n```',
  );
  assert.equal(d?.subject, "Van aménagé");
});

test("accepte les clés en anglais", () => {
  // La consigne demande du français, le modèle glisse quand même.
  const d = parseDigest('{"subject":"Dog collars","keywords":["dog"]}');
  assert.equal(d?.subject, "Dog collars");
  assert.deepEqual(d?.keywords, ["dog"]);
});

test("un sujet qui recopie la page est tronqué", () => {
  const d = parseDigest(
    JSON.stringify({ sujet: "a".repeat(900), motscles: [] }),
  );
  assert.ok((d?.subject.length ?? 0) <= 220);
});

test("une réponse illisible ne fait pas échouer l'analyse", () => {
  assert.equal(parseDigest("je ne sais pas"), null);
  assert.equal(parseDigest('{"sujet":"","motscles":[]}'), null);
  assert.equal(parseDigest("[]"), null);
});

test("le classement reçoit le sujet, pas la page brute", () => {
  const doc = describeForClassification(
    INPUT.title,
    { subject: "Colliers en cuir pour chien de chasse", keywords: ["chien", "cuir"] },
    INPUT.content,
  );
  assert.ok(doc.includes("Titre : Colliers en cuir"));
  assert.ok(doc.includes("Sujet : Colliers en cuir pour chien de chasse"));
  assert.ok(doc.includes("Mots-clés : chien, cuir"));
  // Le texte brut de la page n'a plus à encombrer la question.
  assert.ok(!doc.includes("athlétique"));
});

test("sans analyse, le classement retombe sur un extrait brut", () => {
  // Perdre l'analyse ne doit pas faire perdre le rangement, qui est
  // l'essentiel.
  const doc = describeForClassification(INPUT.title, null, INPUT.content);
  assert.ok(doc.includes("Titre : Colliers"));
  assert.ok(doc.includes("Extrait :"));
  assert.ok(doc.includes("athlétique"));
});

test("sans rien du tout, le titre suffit encore", () => {
  const doc = describeForClassification("Yamaha Ténéré 700", null, "");
  assert.equal(doc, "Titre : Yamaha Ténéré 700");
});

test("les mots-clés sont demandés dans une seule langue", () => {
  // Constaté : une publication donnait « brustgeschirr, dogharness, harnais »
  // — trois langues pour une même chose, donc aucun regroupement possible.
  const p = buildDigestPrompt({ ...INPUT, language: "français" });
  assert.ok(p.includes("**en français**"));
  assert.ok(p.includes("Traduis ceux qui apparaissent dans une autre langue"));
  // Les noms propres ne se traduisent pas : « williamwalker » reste utile.
  assert.ok(p.includes("noms propres"));
});

test("les mots-clés de l'auteur arrivent jusqu'au modèle", () => {
  const p = buildDigestPrompt({
    ...INPUT,
    content: "Nouveau harnais.\n\nMots-clés de l'auteur : harness, williamwalker",
  });
  assert.ok(p.includes("Mots-clés de l'auteur : harness, williamwalker"));
});
