import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_PERCEPTION_CHARS, buildPerceivePrompt, parsePerception, withPerception } from "./perception.ts";

test("le prompt dit ce qui est joint et signale une légende absente", () => {
  const p = buildPerceivePrompt({ caption: null, images: 2, frames: 3, audio: true });
  assert.match(p, /2 photos, 3 images tirées d'une vidéo, le son de cette vidéo/);
  assert.match(p, /Il n'a pas de légende/);
  assert.match(p, /ce qui est dit dans la vidéo/);
  assert.doesNotMatch(buildPerceivePrompt({ caption: "x", images: 1, frames: 0, audio: false }), /ce qui est dit/);
});

test("la description est nettoyée, bornée, et rejoint le texte", () => {
  assert.equal(parsePerception("Description : Un harnais en cuir brun pour chien, cousu main."), "Un harnais en cuir brun pour chien, cousu main.");
  assert.equal(parsePerception("ok"), null);
  assert.ok(parsePerception("a".repeat(5000))!.length <= MAX_PERCEPTION_CHARS);
  assert.equal(withPerception("Légende", "Un chien"), "Légende\n\nCe que montrent les images et la vidéo :\nUn chien");
  assert.equal(withPerception(null, null), null);
});
