import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_TIMEOUTS,
  HEARTBEAT_STALE_MS,
  aiWaitLabel,
  budgetExhausted,
  isReadyForAi,
  lockIsHeld,
  shouldSkipSummary,
} from "./policy.ts";

test("le tagging attend la fin de l'extraction", () => {
  assert.equal(isReadyForAi("pending"), false);
  assert.equal(isReadyForAi("running"), false);
});

test("une extraction ratée n'empêche pas le rangement", () => {
  // Il reste l'URL et le titre : de quoi choisir un thème.
  assert.equal(isReadyForAi("error"), true);
  assert.equal(isReadyForAi("success"), true);
});

test("l'enveloppe de temps s'épuise avant que le système ne coupe", () => {
  const start = 1_000;
  assert.equal(budgetExhausted(start, start + 60_000, 8 * 60_000), false);
  assert.equal(budgetExhausted(start, start + 8 * 60_000, 8 * 60_000), true);
  assert.equal(budgetExhausted(start, start + 9 * 60_000, 8 * 60_000), true);
});

test("« en cours » n'est affiché que si le modèle travaille vraiment", () => {
  // Le défaut corrigé : une ligne restée 'running' après un arrêt brutal
  // affichait « en cours » pendant une journée.
  assert.equal(aiWaitLabel("running", "tagging", true), "Analyse par le modèle en cours…");
  assert.equal(aiWaitLabel("pending", "tagging", true), "Analyse par le modèle en cours…");
});

test("un favori en attente file d'attente inactive invite à relancer", () => {
  const label = aiWaitLabel("pending", "idle", false);
  assert.ok(label?.includes("Relancer"));
});

test("un favori en attente derrière d'autres le dit", () => {
  const label = aiWaitLabel("pending", "fetching", false);
  assert.ok(label?.includes("file d'attente"));
});

test("rien à annoncer quand l'IA a fini ou a été écartée", () => {
  assert.equal(aiWaitLabel("success", "idle", false), null);
  assert.equal(aiWaitLabel("error", "idle", false), null);
  assert.equal(aiWaitLabel("skipped", "idle", false), null);
});

test("un battement récent tient le verrou", () => {
  const now = 1_000_000;
  assert.equal(lockIsHeld(now - 30_000, now), true);
  assert.equal(lockIsHeld(now, now), true);
});

test("un battement laissé par un processus mort n'immobilise pas la file", () => {
  const now = 1_000_000;
  assert.equal(lockIsHeld(now - HEARTBEAT_STALE_MS, now), false);
  assert.equal(lockIsHeld(now - 3 * HEARTBEAT_STALE_MS, now), false);
});

test("aucun battement, aucun verrou", () => {
  assert.equal(lockIsHeld(null, 1_000_000), false);
});

test("une horloge revenue en arrière ne bloque pas définitivement", () => {
  // Changement de fuseau ou réglage manuel : le battement est dans le futur.
  assert.equal(lockIsHeld(2_000_000, 1_000_000), false);
});

test("le résumé est abandonné quand le modèle traîne", () => {
  // Le classement et les tags ont déjà pris deux minutes : un résumé en
  // ajouterait trois, et le lien suivant n'arriverait jamais.
  assert.equal(shouldSkipSummary(120_000), true);
  assert.equal(shouldSkipSummary(20_000), false);
});

test("lire la page coûte plus cher que choisir un numéro", () => {
  // Comprendre le sujet demande de lire le document ; choisir une catégorie ne
  // demande que de lire une phrase. Les deux n'ont pas le même budget.
  assert.ok(AI_TIMEOUTS.choice < AI_TIMEOUTS.digest);
  assert.ok(AI_TIMEOUTS.digest < AI_TIMEOUTS.summary);
});
