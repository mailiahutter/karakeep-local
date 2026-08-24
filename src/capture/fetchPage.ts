import { extractFromHtml, type Extracted } from "./extract";

/**
 * Certains sites renvoient une page de consentement ou un 403 aux clients qui
 * n'annoncent pas un navigateur. On se présente comme un mobile courant.
 */
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const TIMEOUT_MS = 20_000;
/** Au-delà, on tronque : inutile de charger une page entière en mémoire. */
const MAX_BYTES = 5 * 1024 * 1024;

export class FetchPageError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "http" | "unsupported" | "timeout",
  ) {
    super(message);
    this.name = "FetchPageError";
  }
}

function charsetFrom(contentType: string | null, head: string): string | null {
  const fromHeader = contentType?.match(/charset=([^;\s]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase().replace(/["']/g, "");
  const fromMeta =
    head.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
    head.match(
      /<meta\b[^>]*content\s*=\s*["'][^"']*charset=([\w-]+)/i,
    )?.[1];
  return fromMeta ? fromMeta.toLowerCase() : null;
}

function decode(bytes: Uint8Array, charset: string | null): string {
  const enc = charset && charset !== "utf8" ? charset : "utf-8";
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch {
    // Encodage exotique ou absent d'Hermes : l'UTF-8 abîme quelques accents
    // mais reste exploitable pour le titre et les tags.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Télécharge une page et en extrait titre, description et texte.
 *
 * Remplace le worker `crawler` de Karakeep. Pas de rendu JavaScript, pas de
 * capture d'écran : uniquement ce que le serveur envoie.
 */
export async function fetchPage(url: string): Promise<Extracted> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = controller.signal.aborted;
    throw new FetchPageError(
      aborted
        ? `Délai dépassé après ${TIMEOUT_MS / 1000} s`
        : `Connexion impossible : ${(err as Error).message}`,
      aborted ? "timeout" : "network",
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new FetchPageError(
      `Le serveur a répondu ${response.status}`,
      "http",
    );
  }

  const contentType = response.headers.get("content-type");
  const finalUrl = response.url || url;

  if (contentType && !/text\/html|application\/xhtml|text\/plain|\+xml|text\/xml/i.test(contentType)) {
    // PDF, image, vidéo… : on garde une fiche minimale sans texte.
    return {
      title: decodeURIComponent(finalUrl.split("/").pop() ?? "") || finalUrl,
      description: null,
      content: null,
      author: null,
      siteName: safeHost(finalUrl),
      imageUrl: null,
      faviconUrl: null,
      publishedAt: null,
    };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(
    buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer,
  );

  // Le charset peut n'apparaître que dans le <head> : on décode d'abord en
  // ASCII-compatible pour le lire, puis on redécode correctement si besoin.
  const probe = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
  const charset = charsetFrom(contentType, probe);
  const html = decode(bytes, charset);

  const extracted = extractFromHtml(html, finalUrl);
  extracted.siteName ??= safeHost(finalUrl);
  return extracted;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
