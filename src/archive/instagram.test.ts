import assert from "node:assert/strict";
import { test } from "node:test";

import {
  captionWithoutHashtags,
  hashtagsFrom,
  instagramEmbedUrl,
  instagramShortcode,
  isJunkMedia,
  isStatsBoilerplate,
  looksLikeLoginWall,
  mediaIdentity,
  pickCarousel,
} from "./instagram.ts";

test("repère le code d'une publication, d'un reel ou d'une vidéo", () => {
  assert.equal(instagramShortcode("https://www.instagram.com/p/CKlvyPB/"), "CKlvyPB");
  assert.equal(instagramShortcode("https://instagram.com/reel/Abc-1_2/?x=1"), "Abc-1_2");
  assert.equal(instagramShortcode("https://www.instagram.com/tv/Xyz/"), "Xyz");
  assert.equal(instagramShortcode("https://exemple.fr/p/Abc/"), null);
});

test("construit l'adresse de la page d'intégration", () => {
  assert.equal(
    instagramEmbedUrl("https://www.instagram.com/p/CKlvyPB/"),
    "https://www.instagram.com/p/CKlvyPB/embed/captioned/",
  );
  assert.equal(instagramEmbedUrl("https://exemple.fr"), null);
});

test("reconnaît la phrase de statistiques servie dans og:description", () => {
  // C'est exactement ce qui s'est retrouvé en description lors du test réel.
  assert.equal(
    isStatsBoilerplate("1 likes, 0 comments - menuiseriedusoulor le January 29, 2021"),
    true,
  );
  assert.equal(isStatsBoilerplate("472 likes, 1 comments - compte on January 29, 2021"), true);
  assert.equal(isStatsBoilerplate("1.2K likes, 34 comments - x"), true);
  // Une vraie légende ne doit pas être confondue avec.
  assert.equal(isStatsBoilerplate("Marche lamellé collé, Hévéa, finition Rubio"), false);
  assert.equal(isStatsBoilerplate(null), false);
});

test("détecte le mur de connexion", () => {
  assert.equal(
    looksLikeLoginWall("Instagram", "Découvrez cette publication dans l'application"),
    true,
  );
  assert.equal(looksLikeLoginWall(null, "View this post on Instagram"), true);
  assert.equal(looksLikeLoginWall("Instagram", ""), true, "page vide = rien servi");
  assert.equal(
    looksLikeLoginWall(
      "Menuiserie",
      "Marche lamellé collé en hévéa, finition Rubio Monocoat, réalisée à Espoey.",
    ),
    false,
  );
});

test("extrait les hashtags de la légende", () => {
  const caption =
    "#Artisanat 🔨 #Bois 🪵 #Feretbois #Pau 📍\n\nMarche lamellé collé 🪚\nHévéa 🌳";
  assert.deepEqual(hashtagsFrom(caption), ["Artisanat", "Bois", "Feretbois", "Pau"]);
});

test("les hashtags en double ne sont comptés qu'une fois", () => {
  assert.deepEqual(hashtagsFrom("#bois #Bois #BOIS"), ["bois"]);
});

test("la légende nettoyée garde le texte utile", () => {
  const caption = "#Artisanat #Bois\n\nMarche lamellé collé\nHévéa";
  const clean = captionWithoutHashtags(caption);
  assert.ok(clean.includes("Marche lamellé collé"));
  assert.ok(clean.includes("Hévéa"));
  assert.ok(!clean.includes("#Artisanat"));
});

test("écarte avatars et vignettes de profil", () => {
  assert.equal(isJunkMedia("https://cdn.fr/v/t51.2885-19/123_a.jpg"), true);
  assert.equal(isJunkMedia("https://cdn.fr/v/s150x150/456_n.jpg"), true);
  assert.equal(isJunkMedia("https://cdn.fr/v/t51.2885-15/1234567890_1234567890_1_n.jpg"), false);
});

test("reconnaît le même média servi en plusieurs résolutions", () => {
  const a = "https://cdn.fr/v/t51/s640x640/1111111111_2222222222_3_n.jpg";
  const b = "https://cdn.fr/v/t51/s1080x1080/1111111111_2222222222_3_n.jpg";
  assert.equal(mediaIdentity(a), mediaIdentity(b));
});

test("le carrousel garde chaque image une fois, en meilleure résolution", () => {
  const picked = pickCarousel([
    { url: "https://cdn.fr/v/t51/1111111111_2222222222_1_n.jpg", width: 640, height: 640 },
    { url: "https://cdn.fr/v/t51/1111111111_2222222222_1_n.jpg?big", width: 1080, height: 1080 },
    { url: "https://cdn.fr/v/t51/3333333333_4444444444_1_n.jpg", width: 1080, height: 1080 },
    { url: "https://cdn.fr/v/t51.2885-19/9999999999_a.jpg", width: 150, height: 150 },
  ]);
  assert.equal(picked.length, 2, "deux médias distincts, l'avatar écarté");
  assert.equal(picked[0].width, 1080, "la plus haute résolution est retenue");
});
