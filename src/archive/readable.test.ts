import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Sur l'appareil, Metro fournit `require` ; ici, on le reconstitue.
(globalThis as { require?: unknown }).require ??= createRequire(import.meta.url);

import { extractArticle } from "./readable.ts";

const PARA =
  "Le pain au levain se prépare avec un mélange de farine et d'eau laissé à fermenter plusieurs jours. ";

test("Readability garde l'article et écarte le bruit autour", () => {
  const html = `<!doctype html><html><head><title>Pain</title></head><body>
    <div class="cookie-banner">Nous utilisons des cookies pour améliorer votre expérience. Accepter Refuser</div>
    <div class="menu"><a href="/">Accueil</a> <a href="/shop">Boutique</a></div>
    <div class="post"><h1>Pain au levain</h1>
      <p>${PARA.repeat(4)}</p><p>${PARA.repeat(3)}</p><p>${PARA.repeat(3)}</p>
    </div>
    <div class="related">À lire aussi : dix recettes de brioche</div>
  </body></html>`;
  const article = extractArticle(html);
  assert.ok(article);
  assert.match(article.text, /levain/);
  assert.doesNotMatch(article.text, /cookies/);
  assert.doesNotMatch(article.text, /Boutique/);
});

test("une page sans article rend la main", () => {
  assert.equal(extractArticle("<html><body><p>Bonjour</p></body></html>"), null);
  assert.equal(extractArticle(""), null);
});
