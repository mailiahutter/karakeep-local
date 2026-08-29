import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasUsableShape,
  isJunkImage,
  pickImages,
  type ImageCandidate,
} from "./images.ts";

const img = (
  url: string,
  width = 800,
  height = 600,
  extra: Partial<ImageCandidate> = {},
): ImageCandidate => ({ url, width, height, alt: null, ...extra });

test("le bandeau de moyens de paiement est écarté", () => {
  // Le cas signalé : « 3D Secure / Visa / Mastercard » conservé comme
  // illustration d'une page de colliers pour chien.
  assert.equal(
    isJunkImage("https://atelier-napoleon.com/img/3d-secure-cb-visa.png", null),
    true,
  );
  assert.equal(isJunkImage("https://x.fr/i/logo-header.svg", null), true);
  assert.equal(isJunkImage("https://x.fr/i/a.png", "Paiement sécurisé Visa"), true);
  assert.equal(isJunkImage("https://x.fr/i/banniere.jpg", null), true);
});

test("une vraie photo passe", () => {
  assert.equal(
    isJunkImage(
      "https://atelier-napoleon.com/uploads/braque-de-weimar-collier.jpg",
      "Braque de Weimar portant un collier en cuir",
    ),
    false,
  );
});

test("le nom de domaine ne condamne pas une image", () => {
  // `visa` dans l'hôte ne dit rien de l'image ; seul le chemin est jugé.
  assert.equal(
    isJunkImage("https://cdn.visa-voyages.fr/photos/plage.jpg", null),
    false,
  );
});

test("les formes de mise en page sont écartées", () => {
  assert.equal(hasUsableShape(1600, 120), false); // bandeau
  assert.equal(hasUsableShape(120, 900), false); // colonne
  assert.equal(hasUsableShape(100, 100), false); // vignette
  assert.equal(hasUsableShape(800, 600), true);
  // Dimensions inconnues : le DOM les annonce à zéro tant que l'image n'est
  // pas chargée. Les exclure supprimerait de vraies photos.
  assert.equal(hasUsableShape(0, 0), true);
});

test("la vignette du site est conservée, et en premier", () => {
  // Le second défaut signalé : la photo mise en avant par le site servait de
  // vignette mais n'était jamais enregistrée — elle n'est pas une balise
  // <img> du document.
  const picked = pickImages([img("https://x.fr/uploads/autre.jpg")], {
    ogImage: "https://x.fr/uploads/chien.jpg",
    max: 3,
  });
  assert.equal(picked[0].url, "https://x.fr/uploads/chien.jpg");
  assert.equal(picked.length, 2);
});

test("la vignette n'est pas conservée deux fois", () => {
  const picked = pickImages(
    [img("https://x.fr/uploads/chien.jpg?w=1200"), img("https://x.fr/a.jpg")],
    { ogImage: "https://x.fr/uploads/chien.jpg", max: 5 },
  );
  assert.equal(picked.length, 2);
  assert.equal(picked.filter((p) => p.url.includes("chien")).length, 1);
});

test("l'en-tête et le pied de page ne fournissent pas d'illustration", () => {
  const picked = pickImages(
    [
      img("https://x.fr/i/paiement.png", 900, 700, { zone: "chrome" }),
      img("https://x.fr/uploads/photo.jpg", 400, 300, { zone: "main" }),
    ],
    { max: 5 },
  );
  assert.deepEqual(
    picked.map((p) => p.url),
    ["https://x.fr/uploads/photo.jpg"],
  );
});

test("le corps de l'article prime sur la surface", () => {
  const picked = pickImages(
    [
      img("https://x.fr/uploads/grande-laterale.jpg", 2000, 1500, { zone: "other" }),
      img("https://x.fr/uploads/petite-article.jpg", 400, 300, { zone: "main" }),
    ],
    { max: 5 },
  );
  assert.equal(picked[0].url, "https://x.fr/uploads/petite-article.jpg");
});

test("le nombre demandé est respecté, vignette comprise", () => {
  const picked = pickImages(
    [img("https://x.fr/1.jpg"), img("https://x.fr/2.jpg"), img("https://x.fr/3.jpg")],
    { ogImage: "https://x.fr/og.jpg", max: 2 },
  );
  assert.equal(picked.length, 2);
  assert.equal(picked[0].url, "https://x.fr/og.jpg");
});

test("une page sans image exploitable ne renvoie rien", () => {
  assert.deepEqual(pickImages([img("https://x.fr/i/logo.png")], { max: 3 }), []);
});
