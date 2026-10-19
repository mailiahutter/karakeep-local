import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  adjustThreshold,
  choiceDistribution,
  isDoubt,
} from "./confidence.ts";

test("la certitude est lue à la position du numéro, sur les seuls numéros valides", () => {
  const d = choiceDistribution(
    [
      { content: " ", probs: [{ tok_str: " ", prob: 0.9 }] },
      {
        content: "3",
        probs: [
          { tok_str: "3", prob: 0.6 },
          { tok_str: "5", prob: 0.2 },
          { tok_str: "La", prob: 0.1 },
          { tok_str: "9", prob: 0.1 },
        ],
      },
    ],
    6,
  );
  assert.ok(d);
  assert.equal(d[0].index, 3);
  assert.ok(Math.abs(d[0].p - 0.75) < 1e-9);
  assert.equal(d[1].index, 5);
  assert.equal(d.length, 2);
});

test("sans numéro, pas de certitude inventée", () => {
  assert.equal(choiceDistribution([{ content: "Aucun", probs: [] }], 6), null);
  assert.equal(choiceDistribution(null, 6), null);
});

test("le seuil baisse quand les doutes étaient infondés, monte nettement sur une erreur ratée", () => {
  assert.equal(adjustThreshold(0.75, "kept"), 0.74);
  assert.equal(adjustThreshold(0.75, "changed"), 0.76);
  assert.equal(adjustThreshold(0.75, "missed"), 0.79);
  assert.equal(adjustThreshold(MAX_THRESHOLD, "missed"), MAX_THRESHOLD);
  assert.equal(adjustThreshold(MIN_THRESHOLD, "kept"), MIN_THRESHOLD);
});

test("sans tiroir, c'est toujours un doute ; sans mesure, on fait confiance", () => {
  assert.equal(isDoubt(null, 0.99, 0.75), true);
  assert.equal(isDoubt("t", 0.6, 0.75), true);
  assert.equal(isDoubt("t", 0.8, 0.75), false);
  assert.equal(isDoubt("t", null, 0.75), false);
});
