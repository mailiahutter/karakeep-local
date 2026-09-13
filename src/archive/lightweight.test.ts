import assert from "node:assert/strict";
import { test } from "node:test";

import {
  absolute,
  collectImages,
  collectVideos,
  metaContent,
  parseLightPage,
  readableText,
} from "./lightweight.ts";

const PAGE = `<!doctype html><html><head>
<title>Boutique — Colliers</title>
<meta property="og:title" content="Colliers en cuir pour Braque de Weimar">
<meta name="description" content="Cr&eacute;ations adapt&eacute;es &agrave; sa morphologie.">
<meta content="https://cdn.exemple.fr/chien.jpg" property="og:image">
<meta property="og:site_name" content="Atelier Napol&eacute;on">
</head><body>
<header><nav><a href="/">Accueil</a></nav><img src="/logo.png"></header>
<article>
  <p>Le Braque de Weimar est un chien athl&eacute;tique.</p>
  <p>Un collier trop fin blesse.</p>
  <img src="/photos/collier.jpg" alt="Collier en cuir" width="1200" height="900">
</article>
<footer><img src="/img/3d-secure.png"><p>Paiement s&eacute;curis&eacute;</p></footer>
<script>var junk = "<p>pas du texte</p>";</script>
</body></html>`;

test("les métadonnées sont lues quel que soit l'ordre des attributs", () => {
  assert.equal(
    metaContent(PAGE, ["og:title"]),
    "Colliers en cuir pour Braque de Weimar",
  );
  // `content` avant `property` : un site sur deux l'écrit ainsi.
  assert.equal(metaContent(PAGE, ["og:image"]), "https://cdn.exemple.fr/chien.jpg");
  assert.equal(metaContent(PAGE, ["absent"]), null);
});

test("les entités HTML sont décodées", () => {
  assert.equal(
    metaContent(PAGE, ["description"]),
    "Créations adaptées à sa morphologie.",
  );
  assert.equal(metaContent(PAGE, ["og:site_name"]), "Atelier Napoléon");
});

test("le texte vient de l'article, pas des menus ni des scripts", () => {
  const text = readableText(PAGE);
  assert.ok(text.includes("chien athlétique"));
  assert.ok(text.includes("Un collier trop fin blesse."));
  assert.ok(!text.includes("Accueil"), "le menu ne doit pas être lu");
  assert.ok(!text.includes("pas du texte"), "le script ne doit pas être lu");
  assert.ok(!text.includes("Paiement"), "le pied de page ne doit pas être lu");
});

test("les blocs ne se collent pas les uns aux autres", () => {
  // Sans saut de ligne, « athlétique.Un collier » formait un seul mot.
  assert.ok(!readableText(PAGE).includes("athlétique.Un"));
});

test("les images du menu et du pied de page sont écartées", () => {
  const urls = collectImages(PAGE, "https://exemple.fr/page").map((i) => i.url);
  assert.deepEqual(urls, ["https://exemple.fr/photos/collier.jpg"]);
});

test("srcset l'emporte sur src", () => {
  // `src` sert souvent une vignette de remplacement ; la grande variante est
  // annoncée dans `srcset`.
  const html = `<img src="/petit.jpg" srcset="/moyen.jpg 600w, /grand.jpg 1600w">`;
  assert.equal(
    collectImages(html, "https://x.fr/")[0].url,
    "https://x.fr/grand.jpg",
  );
});

test("les images différées sont retrouvées", () => {
  const html = `<img data-src="/lazy.jpg">`;
  assert.equal(collectImages(html, "https://x.fr/")[0].url, "https://x.fr/lazy.jpg");
});

test("les vidéos sont lues dans les balises et dans le JSON embarqué", () => {
  const html = `
    <video src="/clip.mp4"></video>
    <script>{"video_url":"https:\\/\\/cdn.fr\\/a.mp4?token=1\\u0026x=2"}</script>`;
  assert.deepEqual(
    collectVideos(html, "https://x.fr/").map((v) => v.url),
    ["https://x.fr/clip.mp4", "https://cdn.fr/a.mp4?token=1&x=2"],
  );
});

test("une adresse blob n'est pas conservée", () => {
  // Elle ne vaut rien hors de la page qui l'a créée.
  assert.deepEqual(collectVideos(`<video src="blob:https://x.fr/abc"></video>`, "https://x.fr/"), []);
});

test("une page complète donne tout ce qu'il faut au modèle", () => {
  const page = parseLightPage(PAGE, "https://exemple.fr/colliers");
  assert.equal(page.title, "Colliers en cuir pour Braque de Weimar");
  assert.equal(page.siteName, "Atelier Napoléon");
  assert.equal(page.imageUrl, "https://cdn.exemple.fr/chien.jpg");
  assert.ok(page.content.length > 40);
  assert.equal(page.images.length, 1);
});

test("le titre retombe sur la balise title", () => {
  const page = parseLightPage("<title>Sans og</title>", "https://x.fr/");
  assert.equal(page.title, "Sans og");
});

test("les adresses relatives sont résolues, les data: écartées", () => {
  assert.equal(absolute("/a.jpg", "https://x.fr/p/"), "https://x.fr/a.jpg");
  assert.equal(absolute("../b.jpg", "https://x.fr/p/q"), "https://x.fr/b.jpg");
  assert.equal(absolute("data:image/png;base64,AAA", "https://x.fr/"), null);
  assert.equal(absolute(null, "https://x.fr/"), null);
});

test("une page vide ne fait pas échouer l'analyse", () => {
  const page = parseLightPage("", "https://x.fr/");
  assert.equal(page.title, null);
  assert.equal(page.content, "");
  assert.deepEqual(page.images, []);
});
