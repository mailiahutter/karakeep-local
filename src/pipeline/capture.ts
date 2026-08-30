import {
  adoptFile,
  deleteAssetsFor,
  downloadAsset,
  saveText,
} from "../db/assets";
import { saveExtractedContent, setFetchStatus } from "../db/bookmarks";
import { detectSource, planFor, youtubeThumbnail } from "../archive/sources";
import {
  captionWithoutHashtags,
  hashtagsFrom,
  instagramEmbedUrl,
  isStatsBoilerplate,
  looksLikeLoginWall,
  usefulHashtags,
  mediaIdentity,
  pickCarousel,
} from "../archive/instagram";
import { pickImages } from "../archive/images";
import { enqueue, isWorkerReady } from "../archive/queue";
import type { ArchiveResult, CapturedImage } from "../archive/types";
import { getDb } from "../db/client";

/**
 * Capture complète d'un lien : rendu par le moteur d'Android, extraction, puis
 * conservation des pièces sur l'appareil.
 *
 * Remplace le worker `crawler` de Karakeep. Le JavaScript du site est exécuté
 * avant extraction, comme le ferait un Chrome sans interface côté serveur.
 */

export interface CaptureOutcome {
  screenshot: boolean;
  archive: boolean;
  images: number;
  videos: number;
  hashtags: number;
  notes: string[];
}

async function setSourceKind(id: string, kind: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET source_kind = ? WHERE id = ?", [
    kind,
    id,
  ]);
}

/** Le contenu récolté est-il exploitable, ou avons-nous reçu une page vide ? */
function isUsable(result: ArchiveResult): boolean {
  const { title, content } = result.page;
  return !looksLikeLoginWall(title, content) && content.trim().length >= 40;
}

export async function captureBookmark(
  bookmarkId: string,
  url: string,
): Promise<CaptureOutcome> {
  const notes: string[] = [];
  const kind = detectSource(url);
  const plan = planFor(kind);
  await setSourceKind(bookmarkId, kind);

  if (!isWorkerReady()) {
    throw new Error(
      "Le moteur de rendu n'est pas prêt. Rouvre l'application et réessaie.",
    );
  }

  await setFetchStatus(bookmarkId, "running");

  // Instagram sert un mur de connexion sur l'adresse normale. La page
  // d'intégration, prévue pour les sites tiers, rend la légende sans compte :
  // on l'essaie en premier, l'adresse d'origine servant de repli si une
  // session est ouverte dans l'application.
  const attempts: string[] = [];
  if (kind === "instagram") {
    const embed = instagramEmbedUrl(url);
    if (embed) attempts.push(embed);
  }
  attempts.push(url);

  let result: ArchiveResult | null = null;
  let lastError: Error | null = null;

  for (const target of attempts) {
    try {
      const attempt = await enqueue(target, {
        wantArchive: plan.wantArchive,
        wantScreenshot: plan.wantScreenshot,
        sourceKind: plan.kind,
        extraSettleMs: plan.extraSettleMs,
      });
      result = attempt;
      if (isUsable(attempt)) break;
      // Page inexploitable : on garde le résultat comme repli et on tente la
      // suivante plutôt que d'enregistrer du vide.
    } catch (err) {
      lastError = err as Error;
    }
  }

  if (!result) {
    const message = lastError?.message ?? "Aucune page n'a pu être chargée";
    await setFetchStatus(bookmarkId, "error", message);
    throw new Error(message);
  }

  const page = result.page;

  // --- Description et contenu ---------------------------------------
  let description = page.description;
  let content = page.content;

  if (kind === "instagram") {
    // « 472 likes, 1 comments - … » n'est pas une légende : l'enregistrer
    // priverait le tagging et le résumé de toute matière.
    if (isStatsBoilerplate(description)) description = null;
    if (isStatsBoilerplate(content)) content = "";
    if (page.igCaption) {
      description = page.igCaption;
      content = page.igCaption;
    }
  }

  const blocked = !isUsable(result) && kind === "instagram";
  if (blocked) {
    notes.push(
      "Instagram n'a pas servi la publication : mur de connexion. " +
        "Connecte-toi depuis Réglages → Compte Instagram, puis relance.",
    );
  }

  await saveExtractedContent(bookmarkId, {
    title: page.title,
    description,
    content: content.trim().length > 0 ? content : null,
    author: page.author,
    siteName: page.siteName,
    imageUrl: page.imageUrl,
    publishedAt: page.publishedAt ? Date.parse(page.publishedAt) || null : null,
  });

  const outcome: CaptureOutcome = {
    screenshot: false,
    archive: false,
    images: 0,
    videos: 0,
    hashtags: 0,
    notes,
  };

  // --- Hashtags de la légende ---------------------------------------
  //
  // Ils étaient enregistrés tels quels comme tags. Le résultat était
  // inutilisable : vingt-neuf tags sur une publication, mêlant français,
  // anglais et allemand, dont « photooftheday » et « summer ». Deux
  // publications sur le même sujet ne partageaient alors aucun tag.
  //
  // Ce sont pourtant des mots choisis par l'auteur, donc un bon indice. On les
  // garde comme tels — filtrés, plafonnés, joints au texte soumis au modèle —
  // et c'est le modèle qui produit les tags, dans une seule langue.
  if (kind === "instagram" && content) {
    const tags = usefulHashtags(hashtagsFrom(content));
    outcome.hashtags = tags.length;
    const caption = captionWithoutHashtags(content);
    const rebuilt = [
      caption,
      tags.length > 0 ? `Mots-clés de l'auteur : ${tags.join(", ")}` : "",
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    if (rebuilt.length > 0) {
      await saveExtractedContent(bookmarkId, { content: rebuilt });
    }
  }

  // Les pièces d'une capture précédente sont effacées maintenant, et pas
  // avant : une nouvelle tentative qui échouerait ne doit pas laisser la fiche
  // vide. Sans cela, chaque relance empilait un jeu de plus — d'où les
  // « vidéo 57 Mo, vidéo 57 Mo » et les vieilles vignettes de 4 Ko qu'un
  // filtre plus récent aurait écartées.
  await deleteAssetsFor(bookmarkId);

  // --- Capture d'écran ---
  if (result.screenshotUri) {
    try {
      await adoptFile(bookmarkId, "screenshot", result.screenshotUri, url);
      outcome.screenshot = true;
    } catch (err) {
      notes.push(`Capture d'écran non conservée : ${(err as Error).message}`);
    }
  }

  // --- Archive autonome ---
  if (result.archiveHtml) {
    try {
      await saveText(bookmarkId, "archive", result.archiveHtml, url);
      outcome.archive = true;
    } catch (err) {
      notes.push(`Archive non conservée : ${(err as Error).message}`);
    }
  } else if (result.archiveError) {
    notes.push(`Archive incomplète : ${result.archiveError}`);
  }

  // --- Vidéos (avant les images : leur présence change le tri) ---------
  // Instagram publie le même fichier en plusieurs qualités : sans
  // dédoublonnage, la même vidéo était conservée deux fois.
  const seenVideos = new Set<string>();
  const videoUrls = page.videos.filter((v) => {
    if (v.kind !== "file") return false;
    const key = mediaIdentity(v.url);
    if (seenVideos.has(key)) return false;
    seenVideos.add(key);
    return true;
  });
  if (plan.wantVideo) {
    for (const video of videoUrls.slice(0, 2)) {
      if (
        await downloadAsset(bookmarkId, "video", video.url, 200 * 1024 * 1024)
      ) {
        outcome.videos++;
      }
    }
    if (outcome.videos === 0 && kind === "youtube") {
      // YouTube ne sert pas de flux téléchargeable : ses adresses média sont
      // signées et éphémères. Il faudrait yt-dlp, absent d'Android sans
      // module natif dédié.
      notes.push(
        "Vidéo YouTube non conservée : titre, description et miniature le sont.",
      );
    } else if (outcome.videos === 0 && kind === "instagram") {
      notes.push(
        "Aucune vidéo trouvée. Si la publication en contient une, connecte-toi " +
          "depuis Réglages → Compte Instagram : l'adresse du fichier n'est " +
          "servie qu'à une session ouverte.",
      );
    }
  }

  // --- Images ---------------------------------------------------------
  // Une icône pèse quelques kilo-octets, une vraie illustration bien plus.
  // C'est le seul critère fiable : le DOM annonce des dimensions nulles tant
  // que l'image n'est pas chargée.
  const minImageBytes = kind === "instagram" ? 30_000 : 15_000;

  let images: CapturedImage[];
  if (kind === "instagram") {
    // Dédoublonne le carrousel : Instagram sert chaque média en plusieurs
    // résolutions, et y mêle avatars et icônes.
    images = pickCarousel(
      page.images.map((i) => ({
        url: i.url,
        width: i.width,
        height: i.height,
      })),
      plan.maxImages,
    ).map((m) => ({ url: m.url, width: m.width, height: m.height, alt: null }));

    // Sur une publication vidéo, les « images » ne sont que des vignettes du
    // lecteur : une seule suffit comme illustration.
    if (outcome.videos > 0) images = images.slice(0, 2);
  } else {
    // La vignette du site — son `og:image` — passe en tête : c'est l'image
    // qu'il a lui-même choisie pour représenter la page, et celle que
    // l'application affiche déjà. Ne pas la conserver revenait à montrer une
    // photo qui s'évapore le jour où le site ferme.
    const ogImage =
      kind === "youtube" ? (youtubeThumbnail(url) ?? page.imageUrl) : page.imageUrl;
    images = pickImages(page.images, { ogImage, max: plan.maxImages });
  }

  for (const img of images) {
    if (
      await downloadAsset(
        bookmarkId,
        "image",
        img.url,
        20 * 1024 * 1024,
        minImageBytes,
      )
    ) {
      outcome.images++;
    }
  }

  await setFetchStatus(bookmarkId, blocked ? "error" : "success",
    blocked ? notes[0] : undefined);
  return outcome;
}
