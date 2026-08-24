/**
 * Extraction des métadonnées et du texte d'une page, sans DOM.
 *
 * Karakeep confie ce travail à un Chrome headless côté serveur. Sur téléphone il
 * n'y a pas de navigateur à piloter : on se contente du HTML brut renvoyé par le
 * serveur. Conséquence assumée — les pages dont le contenu est rendu par
 * JavaScript ne donneront que leurs balises `<meta>`.
 *
 * Ce module est volontairement pur (aucun import React Native) pour rester
 * testable hors appareil.
 */

export interface Extracted {
  title: string | null;
  description: string | null;
  content: string | null;
  author: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  publishedAt: number | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  ccedil: "ç",
  ugrave: "ù",
  ocirc: "ô",
  icirc: "î",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (match, body) => {
    const b = body as string;
    if (b[0] === "#") {
      const code =
        b[1] === "x" || b[1] === "X"
          ? parseInt(b.slice(2), 16)
          : parseInt(b.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[b.toLowerCase()];
    return named ?? match;
  });
}

/** Balises dont le contenu n'appartient jamais au texte de l'article. */
const DROPPED_BLOCKS =
  /<(script|style|noscript|svg|canvas|template|iframe|form|button|select|textarea|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Balises produisant une coupure de ligne une fois le balisage retiré. */
const BLOCK_LEVEL =
  /<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|tr|br|blockquote|pre|figcaption|dd|dt)\b[^>]*>/gi;

function stripTags(html: string): string {
  return html
    .replace(DROPPED_BLOCKS, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK_LEVEL, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToText(html: string): string {
  return decodeEntities(stripTags(html))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Lit un attribut d'une balise, quel que soit l'ordre des attributs et le type
 * de guillemets.
 */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const m = tag.match(re);
  if (!m) return null;
  const value = m[2] ?? m[3] ?? m[4] ?? "";
  return decodeEntities(value).trim();
}

function metaTags(html: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    const value = attr(tag, "content");
    if (key && value) out.push({ key: key.toLowerCase(), value });
  }
  return out;
}

function firstMeta(
  metas: { key: string; value: string }[],
  keys: string[],
): string | null {
  for (const key of keys) {
    const hit = metas.find((m) => m.key === key && m.value.length > 0);
    if (hit) return hit.value;
  }
  return null;
}

export function resolveUrl(base: string, href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

/** Isole la zone de contenu principale, si la page en signale une. */
function mainRegion(html: string): string | null {
  const candidates: string[] = [];
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) candidates.push(m[1]);
  }
  if (candidates.length === 0) return null;
  // La plus longue : sur les pages de liste, chaque teaser est un <article>.
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

export interface ExtractOptions {
  /** Nombre de caractères de texte conservés. */
  maxContentChars?: number;
}

export function extractFromHtml(
  html: string,
  url: string,
  opts: ExtractOptions = {},
): Extracted {
  const maxContentChars = opts.maxContentChars ?? 200_000;
  const metas = metaTags(html);

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    firstMeta(metas, ["og:title", "twitter:title", "title"]) ??
    (titleTag ? decodeEntities(titleTag[1]).replace(/\s+/g, " ").trim() : null);

  const description = firstMeta(metas, [
    "og:description",
    "twitter:description",
    "description",
  ]);

  const siteName = firstMeta(metas, ["og:site_name", "application-name"]);
  const author = firstMeta(metas, ["author", "article:author", "twitter:creator"]);

  const imageUrl = resolveUrl(
    url,
    firstMeta(metas, ["og:image", "og:image:url", "twitter:image"]),
  );

  const publishedAt = parseDate(
    firstMeta(metas, [
      "article:published_time",
      "og:published_time",
      "datepublished",
      "date",
    ]),
  );

  // Icône : on prend le premier <link rel> qui ressemble à une icône, sinon on
  // se rabat sur /favicon.ico à la racine du domaine.
  let faviconUrl: string | null = null;
  const linkRe = /<link\b[^>]*>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) !== null) {
    const rel = (attr(lm[0], "rel") ?? "").toLowerCase();
    if (rel.split(/\s+/).some((r) => r === "icon" || r === "shortcut")) {
      faviconUrl = resolveUrl(url, attr(lm[0], "href"));
      if (faviconUrl) break;
    }
  }
  faviconUrl ??= resolveUrl(url, "/favicon.ico");

  const region = mainRegion(html);
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const source = region ?? bodyMatch?.[1] ?? html;
  let content = htmlToText(source);

  // Une zone <article> trop courte est probablement un chapeau : le corps de
  // page donne alors un meilleur résultat.
  if (region && content.length < 200 && bodyMatch) {
    const fallback = htmlToText(bodyMatch[1]);
    if (fallback.length > content.length) content = fallback;
  }

  if (content.length > maxContentChars) {
    content = content.slice(0, maxContentChars);
  }

  return {
    title: title || null,
    description: description || null,
    content: content.length > 0 ? content : null,
    author: author || null,
    siteName: siteName || null,
    imageUrl,
    faviconUrl,
    publishedAt,
  };
}
