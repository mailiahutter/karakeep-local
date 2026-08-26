import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTaggingPrompt, stripBoilerplate } from "./prompt.ts";

/** Légende réelle relevée sur la publication testée par l'utilisateur. */
const REAL_CAPTION = `Upgrading the hybrid battery cells in my Prius v for higher mpg. The longer version for this video is on my page if you want a more in depth video Disclaimer:Due to factors beyond the control of GadgesGarage, I cannot guarantee against improper use or unauthorized modifications of this information.GadgesGarage assumes no liability for property damage or injury incurred as a result of any of the information contained in this video. Use this information at your own risk. GadgesGarage recommends safe practices when working on vehicles and or with tools seen or implied in this video. Due to factors beyond the control of GadgesGarage, no information contained in this video shall create any expressed or implied warranty or guarantee of any particular result. Any injury, damage, or loss that may result from improper use of these tools, equipment, or from the information contained in this video is the sole responsibility of the user and not GadgesGarage.`;

test("coupe l'avertissement juridique de la légende réelle", () => {
  const clean = stripBoilerplate(REAL_CAPTION);
  assert.ok(
    clean.includes("hybrid battery cells"),
    "la substance doit survivre",
  );
  assert.ok(clean.includes("Prius v"), "le modèle du véhicule doit survivre");
  assert.ok(!clean.includes("no liability"), "le juridique doit disparaître");
  assert.ok(!clean.includes("at your own risk"));
  assert.ok(
    clean.length < 200,
    `il restait ${clean.length} caractères sur ${REAL_CAPTION.length}`,
  );
});

test("la part utile passe de 15 % à la totalité du texte", () => {
  const before = REAL_CAPTION.length;
  const after = stripBoilerplate(REAL_CAPTION).length;
  // Le modèle voyait 85 % de charabia ; il ne doit plus en voir aucun.
  assert.ok(after / before < 0.2, `ratio ${(after / before).toFixed(2)}`);
});

test("un texte sans avertissement est laissé intact", () => {
  const t = "Marche lamellé collé en hévéa, finition Rubio Monocoat.";
  assert.equal(stripBoilerplate(t), t);
});

test("un avertissement en tête n'efface pas tout le texte", () => {
  // Sans garde-fou, on renverrait une chaîne vide et perdrait le contenu.
  const t = "Disclaimer: ceci est un avis. Le sujet réel est décrit ensuite.";
  assert.equal(stripBoilerplate(t), t);
});

test("reconnaît les formulations françaises", () => {
  const t =
    "Réparation d'une batterie hybride sur Prius. Nous déclinons toute responsabilité en cas de mauvaise manipulation.";
  const clean = stripBoilerplate(t);
  assert.ok(clean.includes("batterie hybride"));
  assert.ok(!clean.includes("responsabilité"));
});

test("le prompt de tagging reçoit le texte nettoyé", () => {
  const p = buildTaggingPrompt({
    title: "GadgesGarage",
    description: null,
    content: REAL_CAPTION,
    url: "https://www.instagram.com/p/Abc/",
    language: "français",
    tagStyle: "lowercase-hyphens",
  });
  assert.ok(p.includes("Prius v"), "le sujet doit atteindre le modèle");
  assert.ok(
    !p.includes("assumes no liability"),
    "le juridique ne doit plus occuper la fenêtre de contexte",
  );
});
