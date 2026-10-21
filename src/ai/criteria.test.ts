import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_CRITERIA_CHARS, buildCriteriaPrompt, needsLearning, parseCriteria } from "./criteria.ts";

test("le prompt montre ce que l'utilisateur a rangé et ce qu'il a retiré", () => {
  const p = buildCriteriaPrompt(
    { name: "Harnais", description: "Équipement du chien", parent: "Chien" },
    ["Harnais en cuir fait main", "Laisse rétractable"],
    ["Croquettes sans céréales"],
  );
  assert.match(p, /« Chien › Harnais »/);
  assert.match(p, /- Laisse rétractable/);
  assert.match(p, /RETIRÉ[\s\S]*Croquettes/);
});

test("les critères sont nettoyés et bornés", () => {
  assert.equal(parseCriteria('Critères : « Harnais, laisses et colliers pour chien. »'), "Harnais, laisses et colliers pour chien.");
  assert.equal(parseCriteria("ok"), null);
  const long = parseCriteria("Phrase un assez longue pour compter vraiment ici. ".repeat(20))!;
  assert.ok(long.length <= MAX_CRITERIA_CHARS + 1);
});

test("on apprend dès trois liens, puis quand le tiroir a assez grossi", () => {
  assert.equal(needsLearning(0, 2), false);
  assert.equal(needsLearning(0, 3), true);
  assert.equal(needsLearning(3, 5), false);
  assert.equal(needsLearning(3, 6), true);
  assert.equal(needsLearning(30, 38), false);
  assert.equal(needsLearning(30, 40), true);
});
