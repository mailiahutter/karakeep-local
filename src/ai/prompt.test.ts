import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTaggingPrompt,
  parseTagsResponse,
  preprocessContent,
  sanitizeTags,
  tagStyleInstruction,
} from "./prompt.ts";

const BASE = {
  title: "Introduction à SQLite FTS5",
  description: "Recherche plein texte embarquée",
  content: "SQLite propose un module de recherche plein texte nommé FTS5.",
  url: "https://exemple.fr/fts5",
  language: "français",
  tagStyle: "lowercase-hyphens" as const,
};

test("le prompt embarque titre, description, url et contenu", () => {
  const p = buildTaggingPrompt(BASE);
  assert.ok(p.includes("Introduction à SQLite FTS5"));
  assert.ok(p.includes("Recherche plein texte embarquée"));
  assert.ok(p.includes("https://exemple.fr/fts5"));
  assert.ok(p.includes("FTS5"));
  assert.ok(p.includes("français"));
  assert.ok(p.includes("traits d'union"));
});

test("le contenu est tronqué au budget demandé", () => {
  const p = buildTaggingPrompt({
    ...BASE,
    content: "x".repeat(50_000),
    maxContentChars: 500,
  });
  // 500 caractères de contenu + les quelques lignes de consigne.
  assert.ok(p.length < 3000, `prompt trop long : ${p.length}`);
});

test("aucun vocabulaire extérieur n'est soufflé au modèle", () => {
  // Proposer les tags déjà présents poussait un modèle 3B à les resservir à
  // tort : « hybrid » s'est retrouvé sur un ouvre-boîte.
  const p = buildTaggingPrompt(BASE);
  assert.ok(!p.includes("bibliothèque"));
  assert.ok(p.includes("se justifier par le DOCUMENT"));
});

test("tagStyleInstruction couvre chaque style", () => {
  assert.ok(tagStyleInstruction("camelCase").includes("camelCase"));
  assert.ok(tagStyleInstruction("lowercase-spaces").includes("espaces"));
  assert.equal(tagStyleInstruction("as-generated"), "");
});

test("preprocessContent écrase les longues suites d'espaces", () => {
  assert.equal(preprocessContent("a     b"), "a b");
  assert.equal(preprocessContent("a\n\n\n\n\nb"), "a\nb");
});

test("lit une réponse JSON propre", () => {
  assert.deepEqual(parseTagsResponse('{"tags":["sqlite","fts5"]}'), [
    "sqlite",
    "fts5",
  ]);
});

test("lit une réponse enveloppée dans un bloc de code", () => {
  const raw = 'Voici les tags :\n```json\n{"tags": ["sqlite", "recherche"]}\n```\n';
  assert.deepEqual(parseTagsResponse(raw), ["sqlite", "recherche"]);
});

test("lit un objet JSON précédé de bavardage", () => {
  const raw = 'Bien sûr ! {"tags": ["docker"]} J\'espère que ça aide.';
  assert.deepEqual(parseTagsResponse(raw), ["docker"]);
});

test("gère les accolades à l'intérieur des chaînes", () => {
  const raw = '{"tags": ["objet {clé}", "json"]}';
  assert.deepEqual(parseTagsResponse(raw), ["objet {clé}", "json"]);
});

test("accepte un tableau nu", () => {
  assert.deepEqual(parseTagsResponse('["a","b"]'), ["a", "b"]);
});

test("une réponse illisible donne une liste vide, pas une exception", () => {
  assert.deepEqual(parseTagsResponse("je ne sais pas"), []);
  assert.deepEqual(parseTagsResponse('{"tags": '), []);
  assert.deepEqual(parseTagsResponse(""), []);
});

test("ignore les entrées non textuelles du tableau", () => {
  assert.deepEqual(parseTagsResponse('{"tags":["ok",null,3,"aussi"]}'), [
    "ok",
    "aussi",
  ]);
});

test("sanitizeTags retire dièses, guillemets et doublons", () => {
  assert.deepEqual(
    sanitizeTags(["#docker", " Docker ", '"kubernetes"', "«  ci  »"]),
    ["docker", "kubernetes", "ci"],
  );
});

test("sanitizeTags écarte les phrases et les tags trop longs", () => {
  assert.deepEqual(
    sanitizeTags([
      "un tag correct",
      "ceci est une phrase beaucoup trop longue pour un tag",
      "x".repeat(61),
    ]),
    ["un tag correct"],
  );
});

test("sanitizeTags plafonne le nombre de tags", () => {
  const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
  assert.equal(sanitizeTags(many, 5).length, 5);
});
