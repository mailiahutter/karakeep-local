import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizePost,
  parseEmbedContext,
  rankMethods,
  recordAttempt,
} from "./igParse.ts";

/**
 * Formes relevées le 19 octobre 2026 sur de vraies publications enregistrées
 * par l'utilisateur (harnais en carrousel, batterie de Prius en vidéo), allégées
 * aux seuls champs lus.
 */
const CAROUSEL = {
  __typename: "GraphSidecar",
  shortcode: "DEpvCe_NbQG",
  is_video: false,
  display_url: "https://cdn.example/couverture.jpg",
  dimensions: { height: 1440, width: 1439 },
  edge_media_to_caption: { edges: [{ node: { text: "Maßgefertigte Hundegeschirre aus Leder #dogharness" } }] },
  owner: { username: "jz_ledermanufaktur" },
  edge_sidecar_to_children: {
    edges: [
      { node: { is_video: false, display_url: "https://cdn.example/1.jpg", dimensions: { width: 1080, height: 1080 } } },
      { node: { is_video: false, display_url: "https://cdn.example/2.jpg", dimensions: { width: 1080, height: 1350 } } },
      { node: { is_video: true, display_url: "https://cdn.example/3.jpg", video_url: "https://cdn.example/3.mp4", dimensions: { width: 720, height: 1280 } } },
    ],
  },
};

const VIDEO = {
  __typename: "GraphVideo",
  shortcode: "DaYjbV8Bx4F",
  is_video: true,
  display_url: "https://cdn.example/prius.jpg",
  video_url: "https://cdn.example/prius.mp4",
  video_duration: 178.1,
  dimensions: { height: 1944, width: 1098 },
  edge_media_to_caption: { edges: [{ node: { text: "Upgrading the hybrid battery cells in my Prius v" } }] },
  owner: { username: "gadgesgarage" },
};

test("le carrousel est rendu complet et dans l'ordre", () => {
  // C'était le premier reproche : une seule des trois photos du carrousel
  // retrouvée, mêlée à des vignettes de profil.
  const post = normalizePost(CAROUSEL)!;
  assert.deepEqual(post.items.map((m) => m.url), [
    "https://cdn.example/1.jpg",
    "https://cdn.example/2.jpg",
    "https://cdn.example/3.mp4",
  ]);
  assert.deepEqual(post.items.map((m) => m.type), ["photo", "photo", "video"]);
  assert.equal(post.items[2].thumb, "https://cdn.example/3.jpg");
  assert.equal(post.author, "jz_ledermanufaktur");
  assert.ok(post.caption.startsWith("Maßgefertigte"));
});

test("une vidéo donne son fichier et sa vignette", () => {
  const post = normalizePost(VIDEO)!;
  assert.equal(post.items.length, 1);
  assert.equal(post.items[0].type, "video");
  assert.equal(post.items[0].url, "https://cdn.example/prius.mp4");
  assert.equal(post.items[0].thumb, "https://cdn.example/prius.jpg");
});

test("le format de l'API mobile donne le même résultat", () => {
  const post = normalizePost({
    code: "ABC",
    caption: { text: "Van électrique" },
    user: { username: "auteur" },
    taken_at: 1700000000,
    carousel_media: [
      { image_versions2: { candidates: [{ url: "https://cdn.example/p-small.jpg", width: 320, height: 320 }, { url: "https://cdn.example/p-big.jpg", width: 1080, height: 1080 }] } },
      {
        image_versions2: { candidates: [{ url: "https://cdn.example/v.jpg", width: 1080, height: 1920 }] },
        video_versions: [{ url: "https://cdn.example/v-480.mp4", width: 480, height: 854 }, { url: "https://cdn.example/v-1080.mp4", width: 1080, height: 1920 }],
      },
    ],
  })!;
  // La plus grande variante est retenue, pas la première venue.
  assert.deepEqual(post.items.map((m) => m.url), ["https://cdn.example/p-big.jpg", "https://cdn.example/v-1080.mp4"]);
  assert.equal(post.caption, "Van électrique");
  assert.equal(post.takenAt, 1700000000);
  assert.equal(post.shortcode, "ABC");
});

test("une publication sans média n'est pas une réussite", () => {
  assert.equal(normalizePost({ shortcode: "X", is_video: false }), null);
  assert.equal(normalizePost(null), null);
  assert.equal(normalizePost("texte"), null);
});

test("les données de la page d'intégration sont retrouvées", () => {
  const context = JSON.stringify({ gql_data: { shortcode_media: VIDEO } });
  const html = `<script>s.handle({"require":[["X","init",[],[${JSON.stringify({ contextJSON: context })}]],["Y"]]})</script>`;
  const media = parseEmbedContext(html);
  assert.equal(media?.shortcode, "DaYjbV8Bx4F");
});

test("une page d'intégration inattendue ne fait pas échouer la capture", () => {
  // La méthode suivante prendra le relais.
  assert.equal(parseEmbedContext("<html>Connecte-toi</html>"), null);
  assert.equal(parseEmbedContext('"init",[],[{"contextJSON":"pas du json"}]],'), null);
});

test("la méthode la plus fiable passe en premier", () => {
  assert.deepEqual(rankMethods({}), ["api", "page"]);
  assert.deepEqual(rankMethods({ api: { ok: 1, fail: 9 }, page: { ok: 8, fail: 2 } }), ["page", "api"]);
});

test("un seul échec ne fait pas basculer l'ordre", () => {
  assert.deepEqual(rankMethods({ api: { ok: 0, fail: 1 } }), ["api", "page"]);
});

test("l'historique ancien s'estompe", () => {
  // Une méthode qui a très bien marché pendant des mois puis se met à
  // échouer doit pouvoir perdre la première place.
  let stats = { api: { ok: 50, fail: 0 }, page: { ok: 20, fail: 5 } };
  for (let i = 0; i < 30; i++) stats = recordAttempt(stats, "api", false) as typeof stats;
  assert.equal(rankMethods(stats)[0], "page");
});
