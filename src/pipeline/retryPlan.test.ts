import assert from "node:assert/strict";
import { test } from "node:test";

import { DAY_MS, RETRY_DAYS, planRetry, retryMessage } from "./retryPlan.ts";

test("un échec est réessayé le lendemain", () => {
  const d = planRetry(0, 1000);
  assert.equal(d.nextAt, 1000 + DAY_MS);
  assert.equal(d.gone, false);
  assert.match(retryMessage("Le site a répondu 503.", d), /demain/);
});

test("au bout de plusieurs jours, la source est déclarée disparue", () => {
  const d = planRetry(RETRY_DAYS - 1, 0);
  assert.equal(d.gone, true);
  assert.equal(d.nextAt, null);
  assert.match(retryMessage("x", d), /Source disparue/);
});
