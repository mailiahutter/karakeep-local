import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decodeEntities,
  extractFromHtml,
  htmlToText,
  resolveUrl,
} from "./extract.ts";

const BASE = "https://exemple.fr/articles/mon-article?x=1";

test("décode les entités nommées, décimales et hexadécimales", () => {
  assert.equal(decodeEntities("caf&eacute; &amp; th&#233;"), "café & thé");
  assert.equal(decodeEntities("&#x2014;&hellip;"), "—…");
  // Une entité inconnue doit rester lisible plutôt que disparaître.
  assert.equal(decodeEntities("&inconnue; ok"), "&inconnue; ok");
  // Un point de code hors plage ne doit pas faire exploser la fonction.
  assert.equal(decodeEntities("&#1114112;"), "&#1114112;");
});

test("retire scripts, styles et navigation du texte", () => {
  const html = `
    <body>
      <nav>Accueil Contact</nav>
      <script>var a = "<p>piège</p>";</script>
      <style>.x{color:red}</style>
      <p>Premier paragraphe.</p>
      <p>Second paragraphe.</p>
      <footer>Mentions légales</footer>
    </body>`;
  const text = htmlToText(html);
  assert.ok(text.includes("Premier paragraphe."));
  assert.ok(text.includes("Second paragraphe."));
  assert.ok(!text.includes("piège"), "le contenu des <script> doit disparaître");
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("Accueil"), "la <nav> doit disparaître");
  assert.ok(!text.includes("Mentions légales"), "le <footer> doit disparaître");
});

test("lit les métadonnées OpenGraph en priorité", () => {
  const html = `
    <html><head>
      <title>Titre de la balise title</title>
      <meta property="og:title" content="Titre OpenGraph">
      <meta property="og:description" content="Une description.">
      <meta property="og:site_name" content="Exemple">
      <meta property="og:image" content="/img/couverture.png">
      <meta name="author" content="Camille Martin">
      <meta property="article:published_time" content="2024-03-15T10:00:00Z">
      <link rel="icon" href="/static/icone.png">
    </head><body><p>Corps.</p></body></html>`;
  const r = extractFromHtml(html, BASE);
  assert.equal(r.title, "Titre OpenGraph");
  assert.equal(r.description, "Une description.");
  assert.equal(r.siteName, "Exemple");
  assert.equal(r.author, "Camille Martin");
  assert.equal(r.imageUrl, "https://exemple.fr/img/couverture.png");
  assert.equal(r.faviconUrl, "https://exemple.fr/static/icone.png");
  assert.equal(r.publishedAt, Date.parse("2024-03-15T10:00:00Z"));
});

test("retombe sur <title> et /favicon.ico sans OpenGraph", () => {
  const html = `<html><head><title>  Titre   simple </title></head>
    <body><p>Corps.</p></body></html>`;
  const r = extractFromHtml(html, BASE);
  assert.equal(r.title, "Titre simple");
  assert.equal(r.faviconUrl, "https://exemple.fr/favicon.ico");
});

test("accepte les attributs dans n'importe quel ordre et sans guillemets", () => {
  const html = `<html><head>
    <meta content="Sans guillemets" property=og:title>
    <meta content='Simple' property='og:description'>
    </head><body><p>x</p></body></html>`;
  const r = extractFromHtml(html, BASE);
  assert.equal(r.title, "Sans guillemets");
  assert.equal(r.description, "Simple");
});

test("préfère le plus long <article> aux teasers d'une page de liste", () => {
  const html = `<body>
    <article><h2>Teaser un</h2></article>
    <article><h2>Teaser deux</h2></article>
    <article><p>${"Le contenu réel de l'article. ".repeat(20)}</p></article>
  </body>`;
  const r = extractFromHtml(html, BASE);
  assert.ok(r.content!.includes("Le contenu réel"));
  assert.ok(!r.content!.includes("Teaser un"));
});

test("revient au <body> si la zone <article> est trop courte", () => {
  const long = "Texte substantiel du corps de page. ".repeat(30);
  const html = `<body>
    <article>Chapeau.</article>
    <div><p>${long}</p></div>
  </body>`;
  const r = extractFromHtml(html, BASE);
  assert.ok(
    r.content!.includes("Texte substantiel"),
    "le corps doit prendre le relais",
  );
});

test("tronque le contenu à la limite demandée", () => {
  const html = `<body><p>${"a".repeat(5000)}</p></body>`;
  const r = extractFromHtml(html, BASE, { maxContentChars: 100 });
  assert.equal(r.content!.length, 100);
});

test("resolveUrl gère relatif, absolu et invalide", () => {
  assert.equal(resolveUrl(BASE, "/a"), "https://exemple.fr/a");
  assert.equal(resolveUrl(BASE, "b"), "https://exemple.fr/articles/b");
  assert.equal(resolveUrl(BASE, "https://autre.fr/c"), "https://autre.fr/c");
  assert.equal(resolveUrl(BASE, null), null);
});

test("une page sans corps exploitable ne renvoie pas de contenu vide artificiel", () => {
  const r = extractFromHtml("<html><head></head><body>   </body></html>", BASE);
  assert.equal(r.content, null);
});
