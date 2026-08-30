import assert from "node:assert/strict";
import { test } from "node:test";

import { usefulHashtags } from "./instagram.ts";

test("les hashtags de portée sont écartés", () => {
  // Relevés sur une publication de harnais pour chien : aucun ne dit le sujet.
  const kept = usefulHashtags([
    "2023", "aesthetics", "details", "dogsofinstagram", "essentials",
    "hamburg", "harness", "instagram", "lifestyle", "photooftheday",
    "picoftheday", "summer", "wear", "williamwalker",
  ]);
  assert.deepEqual(kept, [
    "dogsofinstagram",
    "hamburg",
    "harness",
    "wear",
    "williamwalker",
  ]);
});

test("une avalanche de hashtags est plafonnée", () => {
  // Une publication en portait vingt-neuf : à eux seuls ils noyaient la
  // légende dans le prompt.
  const many = Array.from({ length: 29 }, (_, i) => `pierre${i}`);
  assert.equal(usefulHashtags(many).length, 12);
});

test("les hashtags qui nomment le sujet sont conservés", () => {
  assert.deepEqual(usefulHashtags(["citroen", "saxo", "parkingheater"]), [
    "citroen",
    "saxo",
    "parkingheater",
  ]);
});

test("les fragments trop courts ne sont pas des tags", () => {
  assert.deepEqual(usefulHashtags(["ab", "x", "moto"]), ["moto"]);
});
