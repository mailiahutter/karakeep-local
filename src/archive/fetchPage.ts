import { parseLightPage } from "./lightweight";
import type { ArchiveResult } from "./types";

/**
 * Récupération d'une page sans moteur de rendu, pour le travail d'arrière-plan.
 *
 * Aucune WebView n'existe quand le système réveille l'application sans
 * interface. On lit alors le HTML servi tel quel : moins fidèle qu'un rendu
 * complet — le JavaScript de la page n'est pas exécuté, ni capture d'écran ni
 * archive autonome ne sont produites — mais suffisant pour le titre, le texte,
 * les métadonnées et les médias. C'est ce qu'il faut au modèle pour ranger.
 */

/** Un site qui se croit visité par un robot sert souvent une page vide. */
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Mobile Safari/537.36";

const TIMEOUT_MS = 30_000;
/** Au-delà, ce n'est plus une page mais un fichier. */
const MAX_HTML_BYTES = 4 * 1024 * 1024;

export class NotHtmlError extends Error {
  constructor(type: string) {
    super(`La réponse n'est pas une page web (${type}).`);
    this.name = "NotHtmlError";
  }
}

export async function fetchPage(url: string): Promise<ArchiveResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Le site a répondu ${response.status}.`);
    }

    const type = response.headers.get("content-type") ?? "";
    if (type.length > 0 && !/html|xml|text\/plain/i.test(type)) {
      throw new NotHtmlError(type.split(";")[0]);
    }

    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_HTML_BYTES) {
      throw new Error("Page trop volumineuse pour être lue.");
    }

    const html = await response.text();
    const page = parseLightPage(html, response.url || url);

    return {
      page: {
        url: response.url || url,
        title: page.title,
        description: page.description,
        siteName: page.siteName,
        author: page.author,
        publishedAt: page.publishedAt,
        imageUrl: page.imageUrl,
        content: page.content,
        images: page.images,
        videos: page.videos,
      },
      // Ni capture d'écran ni archive autonome : les deux demandent un rendu.
      // La fiche sera complétée à la prochaine ouverture de l'application.
      archiveHtml: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
