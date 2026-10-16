import assert from "node:assert/strict";
import { test } from "node:test";

import { isNetworkFailure } from "./retry.ts";

test("une coupure réseau est reconnue", () => {
  // Messages relevés sur l'appareil, en mode avion ou en perte de signal.
  for (const message of [
    "Network request failed",
    'Unable to resolve host "instagram.com": No address associated with hostname',
    "java.net.SocketTimeoutException: timeout",
    "Software caused connection abort",
    "The operation was aborted",
    "Aucune connexion réseau.",
  ]) {
    assert.equal(isNetworkFailure(message), true, message);
  }
});

test("une page qui répond mal n'est pas une coupure", () => {
  // Celles-là doivent condamner le lien, pas le remettre en file pour rien.
  for (const message of [
    "Le site a répondu 404.",
    "La réponse n'est pas une page web (application/pdf).",
    "Page trop volumineuse pour être lue.",
    "Rien n'a pu être récupéré de cette page.",
  ]) {
    assert.equal(isNetworkFailure(message), false, message);
  }
});
