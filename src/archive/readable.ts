import type { Readability as ReadabilityClass } from "@mozilla/readability";
import type { parseHTML as ParseHTML } from "linkedom";

/**
 * Extraction de l'article par Readability, l'algorithme du mode lecture de
 * Firefox (Apache-2.0), sur un DOM reconstitué par linkedom (ISC) — il n'y a
 * pas de navigateur hors WebView.
 *
 * L'ancien extracteur retirait menus et pieds de page par leurs balises ; il
 * laissait passer bandeaux de cookies, encadrés « à lire aussi » et listes de
 * produits, qui faussaient l'analyse. Readability note chaque bloc selon sa
 * densité de texte et ne garde que le corps de l'article.
 *
 * Fonction pure, testable hors appareil. Renvoie `null` quand la page n'a pas
 * d'article identifiable : l'appelant garde alors son extraction simple.
 */

/** Au-delà, l'analyse coûterait plus qu'elle ne rapporte sur un téléphone. */
const MAX_HTML_CHARS = 2_500_000;
/** En dessous, Readability a probablement isolé un fragment, pas l'article. */
const MIN_TEXT_CHARS = 200;

/**
 * Chargement paresseux : si l'une des deux bibliothèques ne s'évaluait pas
 * sur le moteur JavaScript du téléphone, seule cette extraction serait
 * perdue — pas tout le module de capture qui l'importe.
 */
declare const require: ((id: string) => any) | undefined;
let libs: { Readability: typeof ReadabilityClass; parseHTML: typeof ParseHTML } | null | undefined;

function load() {
  if (libs !== undefined) return libs;
  try {
    if (typeof require === "function") {
      // Appels littéraux : c'est ce que Metro repère pour inclure les modules.
      libs = {
        Readability: require("@mozilla/readability").Readability,
        parseHTML: require("linkedom").parseHTML,
      };
    } else {
      const req = (globalThis as { require?: (id: string) => any }).require;
      libs = req
        ? { Readability: req("@mozilla/readability").Readability, parseHTML: req("linkedom").parseHTML }
        : null;
    }
  } catch {
    libs = null;
  }
  return libs;
}

export interface Article {
  title: string | null;
  text: string;
  excerpt: string | null;
  byline: string | null;
}

export function extractArticle(raw: string): Article | null {
  if (!raw) return null;
  // Une archive autonome embarque ses images en base64 : des mégaoctets sans
  // un mot de texte, qu'on retire avant d'analyser.
  const html = raw.length > 200_000 ? raw.replace(/data:[^"')\s]{200,}/g, "") : raw;
  if (html.length > MAX_HTML_CHARS) return null;
  const lib = load();
  if (!lib) return null;
  try {
    const { document } = lib.parseHTML(html);
    const article = new lib.Readability(document as unknown as Document, {
      charThreshold: 300,
    }).parse();
    const text = (article?.textContent ?? "")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length < MIN_TEXT_CHARS) return null;
    return {
      title: article?.title?.trim() || null,
      text,
      excerpt: article?.excerpt?.trim() || null,
      byline: article?.byline?.trim() || null,
    };
  } catch {
    return null;
  }
}
