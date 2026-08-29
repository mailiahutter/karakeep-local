import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFeedbackMarkdown,
  feedbackFileName,
  hasOpinion,
  tally,
  type ReviewEntry,
} from "./format.ts";

const entry = (over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  id: "r1",
  createdAt: 1_700_000_000_000,
  themeVerdict: null,
  tagsVerdict: null,
  mediaVerdict: null,
  summaryVerdict: null,
  comment: null,
  snapshot: {
    url: "https://atelier-napoleon.com/colliers",
    title: "Colliers en cuir pour Braque de Weimar",
    sourceKind: "website",
    theme: "Maison › Travaux et bricolage",
    tags: ["cuir", "chien"],
    assets: ["capture d'écran 1,5 Mo", "image 80 Ko"],
    summary: "Colliers sur mesure adaptés à la morphologie du chien.",
    modelId: "qwen2.5-3b-instruct-q4km",
  },
  ...over,
});

const META = { appVersion: "1.2.3", generatedAt: 1_700_000_500_000 };

test("un avis vide n'est pas transmis", () => {
  // « Passer » enlève le lien de la file sans rien apprendre : l'exporter
  // diluerait les vrais reproches.
  assert.equal(hasOpinion(entry()), false);
  assert.equal(hasOpinion(entry({ themeVerdict: "bad" })), true);
  assert.equal(hasOpinion(entry({ comment: "le thème est faux" })), true);
  assert.equal(hasOpinion(entry({ comment: "   " })), false);
});

test("l'export ne retient que les avis exprimés", () => {
  const md = buildFeedbackMarkdown([entry(), entry({ themeVerdict: "bad" })], META);
  assert.ok(md.includes("Avis transmis : 1"));
});

test("le reproche et sa cible se lisent ensemble", () => {
  const md = buildFeedbackMarkdown(
    [
      entry({
        themeVerdict: "bad",
        tagsVerdict: "good",
        comment: "Ça parle de chiens, pas de bricolage.",
      }),
    ],
    META,
  );
  assert.ok(md.includes("Colliers en cuir pour Braque de Weimar"));
  assert.ok(md.includes("Maison › Travaux et bricolage → ❌ à revoir"));
  assert.ok(md.includes("cuir, chien → ✅ correct"));
  assert.ok(md.includes("Ça parle de chiens, pas de bricolage."));
  // Le modèle utilisé change tout à l'interprétation d'un mauvais classement.
  assert.ok(md.includes("qwen2.5-3b-instruct-q4km"));
  assert.ok(md.includes("1.2.3"));
});

test("la vue d'ensemble compte les verdicts par aspect", () => {
  const counts = tally([
    entry({ themeVerdict: "bad" }),
    entry({ themeVerdict: "bad" }),
    entry({ themeVerdict: "good", tagsVerdict: "good" }),
  ]);
  assert.equal(counts["Thème"], "1 correct · 2 à revoir");
  assert.equal(counts["Tags"], "1 correct · 0 à revoir");
  // Un aspect sur lequel personne ne s'est prononcé n'encombre pas le résumé.
  assert.equal(counts["Résumé"], undefined);
});

test("un export sans rien à dire le dit clairement", () => {
  const md = buildFeedbackMarkdown([], META);
  assert.ok(md.includes("Aucun avis à transmettre."));
});

test("l'absence de proposition est nommée, pas laissée vide", () => {
  const md = buildFeedbackMarkdown(
    [
      entry({
        themeVerdict: "bad",
        snapshot: { ...entry().snapshot, theme: null, tags: [], assets: [] },
      }),
    ],
    META,
  );
  assert.ok(md.includes("Thème proposé : aucun"));
  assert.ok(md.includes("Tags proposés : aucun"));
  assert.ok(md.includes("Pièces conservées : aucune"));
});

test("un résumé multiligne ne casse pas la citation", () => {
  const md = buildFeedbackMarkdown(
    [
      entry({
        summaryVerdict: "bad",
        snapshot: { ...entry().snapshot, summary: "Ligne un.\n\nLigne deux." },
      }),
    ],
    META,
  );
  assert.ok(md.includes("> Ligne un. Ligne deux."));
});

test("deux exports le même jour ne portent pas le même nom", () => {
  const a = feedbackFileName(1_700_000_000_000);
  const b = feedbackFileName(1_700_000_000_000 + 60 * 60 * 1000);
  assert.notEqual(a, b);
  assert.match(a, /^karakeep-retours-\d{8}-\d{4}\.md$/);
});
