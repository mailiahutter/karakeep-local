import assert from "node:assert/strict";
import { test } from "node:test";

import { compareVersions, isNewer, parseVersion } from "./version.ts";

test("accepte le préfixe v et les versions à deux composantes", () => {
  assert.deepEqual(parseVersion("v1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
  });
  assert.deepEqual(parseVersion("1.4"), {
    major: 1,
    minor: 4,
    patch: 0,
    prerelease: [],
  });
});

test("rejette ce qui n'est pas une version", () => {
  assert.equal(parseVersion("release-finale"), null);
  assert.equal(parseVersion(""), null);
});

test("compare les composantes numériques", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("1.3.0", "1.2.9"), 1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.2.3", "v1.2.3"), 0);
});

test("ne compare pas les nombres comme du texte", () => {
  // Le piège classique : "10" < "9" en comparaison lexicale.
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.0.10", "1.0.9"), 1);
});

test("une version stable l'emporte sur sa pré-version", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
});

test("ordonne les pré-versions entre elles", () => {
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0-beta.1"), -1);
});

test("un tag illisible n'empêche pas la mise à jour", () => {
  assert.equal(compareVersions("n'importe quoi", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "n'importe quoi"), 1);
});

test("isNewer répond à la question posée par le bouton", () => {
  assert.equal(isNewer("v1.1.0", "1.0.0"), true);
  assert.equal(isNewer("v1.0.0", "1.0.0"), false, "pas de mise à jour à soi-même");
  assert.equal(isNewer("v0.9.0", "1.0.0"), false);
});
