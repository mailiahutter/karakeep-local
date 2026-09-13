/**
 * Lecture d'une page sans moteur de rendu.
 *
 * La capture reposait entièrement sur la WebView, qui n'existe que dans un
 * arbre React monté. Hors interface — c'est-à-dire chaque fois que le système
 * réveille l'application pendant que l'utilisateur fait autre chose — il n'y
 * avait donc aucun moyen d'extraire quoi que ce soit. L'étape suivante refusant
 * de travailler sur une extraction inachevée, un lien enregistré puis jamais
 * rouvert restait en attente indéfiniment.
 *
 * Ce module lit le HTML servi tel quel. Il n'exécute pas le JavaScript de la
 * page : on y perd les sites qui se dessinent entièrement côté client, mais on
 * y gagne le titre, les métadonnées `og:`, le texte et les médias de la grande
 * majorité des pages — et d'Instagram, dont la page d'intégration est rendue
 * côté serveur.
 *
 * Module pur : c'est aussi le premier chemin d'extraction que l'on peut
 * réellement tester hors appareil.
 */

export interface LightPage {
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  content: string;
  images: { url: string; width: number; height: number; alt: string | null }[];
  videos: { url: string; kind: "file" | "embed" }[];
}

/** Résout une adresse relative contre celle de la page. */
export function absolute(raw: string | null, base: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0 || value.startsWith("data:")) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç",
    ugrave: "ù", ocirc: "ô", icirc: "î", uuml: "ü", ouml: "ö", auml: "ä",
    laquo: "«", raquo: "»", hellip: "…", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", euro: "€", deg: "°",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

/** Contenu d'une balise meta, quel que soit l'ordre de ses attributs. */
export function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1].trim().length > 0) {
        return decodeEntities(match[1].trim());
      }
    }
  }
  return null;
}

/** Éléments qui n'appartiennent jamais au propos de la page. */
const CHROME_TAGS = [
  "script", "style", "noscript", "svg", "template", "iframe",
  "nav", "header", "footer", "aside", "form",
];

function stripChrome(html: string): string {
  let out = html;
  for (const tag of CHROME_TAGS) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      " ",
    );
    // Balise ouverte jamais refermée : on retire au moins la balise elle-même.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), " ");
  }
  return out;
}

/** Texte lisible de la page, corps de l'article de préférence. */
export function readableText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const cleaned = stripChrome(body);
  const article =
    cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    cleaned;

  return decodeEntities(
    article
      // Les blocs deviennent des sauts de ligne, sinon les mots se collent.
      .replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Attributs d'une balise, pour n'écrire l'analyse qu'une fois. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    out[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return out;
}

/**
 * Images de la page.
 *
 * `srcset` est préféré quand il existe : la plus grande variante y est
 * annoncée, alors que `src` sert souvent une vignette de remplacement.
 */
export function collectImages(
  html: string,
  base: string,
): LightPage["images"] {
  const out: LightPage["images"] = [];
  const seen = new Set<string>();
  const body = stripChrome(html);

  for (const tag of body.match(/<img\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const fromSrcset = (a.srcset ?? a["data-srcset"] ?? "")
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    const url = absolute(
      fromSrcset || a.src || a["data-src"] || a["data-original"] || null,
      base,
    );
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      width: Number(a.width) || 0,
      height: Number(a.height) || 0,
      alt: a.alt && a.alt.length > 0 ? a.alt : null,
    });
    if (out.length >= 40) break;
  }
  return out;
}

export function collectVideos(html: string, base: string): LightPage["videos"] {
  const out: LightPage["videos"] = [];
  const seen = new Set<string>();

  const push = (raw: string | null, kind: "file" | "embed") => {
    const url = absolute(raw, base);
    // Une adresse `blob:` ne vaut rien hors de la page qui l'a créée.
    if (!url || seen.has(url) || url.startsWith("blob:")) return;
    seen.add(url);
    out.push({ url, kind });
  };

  for (const tag of html.match(/<(?:video|source)\b[^>]*>/gi) ?? []) {
    push(attrs(tag).src ?? null, "file");
  }
  // Instagram et consorts publient l'adresse du flux dans leur JSON embarqué.
  for (const match of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
    push(match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"), "file");
  }
  for (const match of html.matchAll(/"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/g)) {
    push(match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"), "file");
  }
  const ogVideo = metaContent(html, ["og:video:secure_url", "og:video:url", "og:video"]);
  if (ogVideo && /\.mp4/.test(ogVideo)) push(ogVideo, "file");

  return out;
}

export function parseLightPage(html: string, url: string): LightPage {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(
          html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1].trim(),
        )
      : null);

  return {
    title: title && title.length > 0 ? title : null,
    description: metaContent(html, [
      "og:description",
      "twitter:description",
      "description",
    ]),
    siteName: metaContent(html, ["og:site_name", "application-name"]),
    author: metaContent(html, ["author", "article:author"]),
    publishedAt: metaContent(html, [
      "article:published_time",
      "og:updated_time",
      "date",
    ]),
    imageUrl: absolute(
      metaContent(html, ["og:image:secure_url", "og:image", "twitter:image"]),
      url,
    ),
    content: readableText(html),
    images: collectImages(html, url),
    videos: collectVideos(html, url),
  };
}
