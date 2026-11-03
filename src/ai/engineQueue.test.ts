import assert from "node:assert/strict";
import { test } from "node:test";

import { exclusive, isOpaqueEngineError, raceStop, type RawResult } from "./engineQueue.ts";

/** Un moteur qui, comme llama.rn, refuse une demande s'il est déjà occupé. */
function fakeEngine(nativeMs: number) {
  let busy = false;
  const log: string[] = [];
  return {
    log,
    run(label: string): Promise<RawResult> {
      if (busy) return Promise.reject(new Error("Exception in HostFunction: <unknown>"));
      busy = true;
      log.push(`start ${label}`);
      return new Promise((resolve) =>
        setTimeout(() => {
          busy = false;
          log.push(`end ${label}`);
          resolve({ content: "" });
        }, nativeMs),
      );
    },
    // Synchrone, comme dans llama.rn 0.12 : ne renvoie rien.
    stopCompletion(): void {},
  };
}

test("un dépassement de délai n'expose pas le moteur encore occupé à la demande suivante", async () => {
  const engine = fakeEngine(80);
  const first = exclusive(() => raceStop(engine.run("a"), 10, engine));
  const second = exclusive(() => raceStop(engine.run("b"), 1_000, engine));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.error, null);
  assert.equal(a.text, null); // rien produit à temps
  assert.equal(b.error, null);
  assert.deepEqual(engine.log, ["start a", "end a", "start b", "end b"]);
});

test("un stopCompletion qui ne renvoie rien ne fait plus planter l'arrêt", async () => {
  const engine = fakeEngine(30);
  const out = await raceStop(engine.run("a"), 5, engine);
  assert.equal(out.error, null);
});

test("une demande en échec ne bloque pas la file", async () => {
  await assert.rejects(exclusive(() => Promise.reject(new Error("boum"))));
  assert.equal(await exclusive(async () => 42), 42);
});

test("les erreurs natives sans message sont reconnues", () => {
  assert.ok(isOpaqueEngineError(new Error("Exception in HostFunction: <unknown>")));
  assert.ok(isOpaqueEngineError(new Error("Unknown error")));
  assert.ok(!isOpaqueEngineError(new Error("Le modèle n'a rien produit en 60 s.")));
});
