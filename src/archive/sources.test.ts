import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectSource,
  planFor,
  youtubeThumbnail,
  youtubeVideoId,
} from "./sources.ts";

test("reconnaît YouTube sous toutes ses formes d'adresse", () => {
  for (const u of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  ]) {
    assert.equal(detectSource(u), "youtube", u);
    assert.equal(youtubeVideoId(u), "dQw4w9WgXcQ", u);
  }
});

test("reconnaît Instagram", () => {
  assert.equal(detectSource("https://www.instagram.com/p/Cabc123/"), "instagram");
  assert.equal(detectSource("https://instagram.com/reel/Xyz/"), "instagram");
});

test("tout le reste est un site ordinaire", () => {
  assert.equal(detectSource("https://exemple.fr/article"), "website");
  assert.equal(detectSource("pas une url"), "website");
  // Un domaine qui contient « youtube » sans en être ne doit pas être confondu.
  assert.equal(detectSource("https://notyoutube.com/watch?v=x"), "website");
});

test("un identifiant vidéo mal formé est rejeté", () => {
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=trop-court"), null);
  assert.equal(youtubeVideoId("https://exemple.fr/watch?v=dQw4w9WgXcQ"), null);
});

test("construit l'adresse de la miniature", () => {
  assert.equal(
    youtubeThumbnail("https://youtu.be/dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  );
  assert.equal(youtubeThumbnail("https://exemple.fr"), null);
});

test("le plan d'un site ordinaire garde 2 illustrations et une archive", () => {
  const p = planFor("website");
  assert.equal(p.maxImages, 2);
  assert.equal(p.wantArchive, true);
  assert.equal(p.wantVideo, false);
});

test("le plan YouTube vise la vidéo, pas l'archive de la page", () => {
  const p = planFor("youtube");
  assert.equal(p.wantVideo, true);
  assert.equal(
    p.wantArchive,
    false,
    "archiver le squelette du lecteur n'aurait aucune valeur",
  );
  assert.equal(
    p.wantScreenshot,
    false,
    "la miniature montre mieux que la capture du lecteur",
  );
});

test("les réseaux ne produisent pas de capture, les sites si", () => {
  // La capture d'une page d'intégration ne montre que du cadre et du blanc,
  // alors que les médias de la publication sont conservés tels quels.
  assert.equal(planFor("instagram").wantScreenshot, false);
  assert.equal(planFor("youtube").wantScreenshot, false);
  // Sur un site, elle reste la seule trace de la mise en page.
  assert.equal(planFor("website").wantScreenshot, true);
});

test("le plan Instagram attend plus longtemps et garde le carrousel", () => {
  const p = planFor("instagram");
  assert.ok(p.extraSettleMs >= 3000, "le chargement différé exige de l'attente");
  assert.ok(p.maxImages >= 10, "un carrousel peut compter plusieurs images");
  assert.equal(p.wantVideo, true);
});
