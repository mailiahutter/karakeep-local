import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeYtdlp } from "./ytdlpInfo.ts";

test("la fiche est tirée du premier élément, les fichiers sont typés", () => {
  const s = summarizeYtdlp(
    [
      {
        title: "Pain au levain",
        description: "La recette complète",
        uploader: "boulanger",
        extractor_key: "Youtube",
        thumbnail: "https://i.ytimg.com/vi/x/hq.jpg",
        upload_date: "20260912",
      },
    ],
    ["/c/x_00001.mp4", "/c/x_00002.jpg", "/c/x.info"],
  );
  assert.equal(s.title, "Pain au levain");
  assert.equal(s.author, "boulanger");
  assert.equal(s.siteName, "Youtube");
  assert.equal(s.publishedAt, Date.parse("2026-09-12"));
  assert.deepEqual(s.media, [
    { path: "/c/x_00001.mp4", type: "video" },
    { path: "/c/x_00002.jpg", type: "photo" },
  ]);
});

test("sans métadonnées, rien n'est inventé", () => {
  const s = summarizeYtdlp([], []);
  assert.equal(s.title, null);
  assert.equal(s.publishedAt, null);
  assert.deepEqual(s.media, []);
});
