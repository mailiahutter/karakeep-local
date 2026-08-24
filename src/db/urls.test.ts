import assert from "node:assert/strict";
import { test } from "node:test";

import { toFtsQuery } from "./fts.ts";
import { extractUrl, hostLabel, normalizeUrl } from "./urls.ts";

test("retire les paramètres de suivi mais garde les paramètres utiles", () => {
  assert.equal(
    normalizeUrl("https://exemple.fr/a?id=7&utm_source=twitter&fbclid=xyz"),
    "https://exemple.fr/a?id=7",
  );
});

test("deux partages de la même page se normalisent pareil", () => {
  const a = normalizeUrl("https://Exemple.fr/article#section-2");
  const b = normalizeUrl("https://exemple.fr/article?utm_campaign=news");
  assert.equal(a, b, "le dédoublonnage repose sur cette égalité");
});

test("supprime la barre finale de la racine seulement", () => {
  assert.equal(normalizeUrl("https://exemple.fr/"), "https://exemple.fr");
  assert.equal(
    normalizeUrl("https://exemple.fr/dossier/"),
    "https://exemple.fr/dossier/",
  );
});

test("complète un domaine nu en https", () => {
  assert.equal(normalizeUrl("exemple.fr/page"), "https://exemple.fr/page");
});

test("une saisie qui n'est pas une URL est rendue telle quelle", () => {
  assert.equal(normalizeUrl("pas une url"), "pas une url");
});

test("trouve l'URL dans un texte de partage", () => {
  assert.equal(
    extractUrl("Super article — https://exemple.fr/a?b=1 à lire"),
    "https://exemple.fr/a?b=1",
  );
  assert.equal(
    extractUrl("Regarde https://exemple.fr/fin."),
    "https://exemple.fr/fin",
    "la ponctuation finale ne fait pas partie du lien",
  );
  assert.equal(extractUrl("exemple.fr/page"), "exemple.fr/page");
  assert.equal(extractUrl("aucun lien ici"), null);
});

test("hostLabel enlève le www", () => {
  assert.equal(hostLabel("https://www.exemple.fr/a"), "exemple.fr");
  assert.equal(hostLabel("pas une url"), null);
});

test("toFtsQuery neutralise la syntaxe FTS5", () => {
  // Sans échappement, ces saisies produiraient une erreur SQLite.
  // Les accents sont conservés : c'est le tokenizer de la table
  // (unicode61 remove_diacritics 2) qui les retire, des deux côtés à la fois.
  assert.equal(toFtsQuery('recherche "cassée'), '"recherche" AND "cassée"*');
  assert.equal(toFtsQuery("docker AND"), '"docker" AND "and"*');
  assert.equal(toFtsQuery("a-b"), '"a" AND "b"*');
});

test("toFtsQuery met un préfixe sur le dernier terme", () => {
  assert.equal(toFtsQuery("kub"), '"kub"*');
  assert.equal(toFtsQuery("open source"), '"open" AND "source"*');
});

test("toFtsQuery rend null si la saisie n'a aucun terme", () => {
  assert.equal(toFtsQuery("   "), null);
  assert.equal(toFtsQuery("!!!"), null);
});
