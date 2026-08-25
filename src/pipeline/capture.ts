import { adoptFile, downloadAsset, saveText } from "../db/assets";
import { saveExtractedContent, setFetchStatus } from "../db/bookmarks";
import { attachTags } from "../db/tags";
import { detectSource, planFor, youtubeThumbnail } from "../archive/sources";
import {
  captionWithoutHashtags,
  hashtagsFrom,
  instagramEmbedUrl,
  isStatsBoilerplate,
  looksLikeLoginWall,
  pickCarousel,
} from "../archive/instagram";
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
  // Ce sont des mots-clés choisis par l'auteur : plus fiables que ce qu'un
  // petit modèle déduirait d'une légende de deux lignes, et gratuits.
  if (kind === "instagram" && content) {
    const tags = hashtagsFrom(content);
    if (tags.length > 0) {
      await attachTags(bookmarkId, tags, "ai");
      outcome.hashtags = tags.length;
      // Le texte soumis au modèle se passe des hashtags, déjà exploités.
      const stripped = captionWithoutHashtags(content);
      if (stripped.length > 0) {
        await saveExtractedContent(bookmarkId, { content: stripped });
      }
    }
  }

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

  // --- Images ---------------------------------------------------------
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
  } else {
    images = [...page.images].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    );
    if (kind === "youtube") {
      const thumb = youtubeThumbnail(url);
      if (thumb) {
        images.unshift({ url: thumb, width: 1280, height: 720, alt: null });
      }
    }
    images = images.slice(0, plan.maxImages);
  }

  for (const img of images) {
    if (await downloadAsset(bookmarkId, "image", img.url)) outcome.images++;
  }

  // --- Vidéos ---
  if (plan.wantVideo) {
    for (const video of page.videos.filter((v) => v.kind === "file").slice(0, 3)) {
      const asset = await downloadAsset(
        bookmarkId,
        "video",
        video.url,
        200 * 1024 * 1024,
      );
      if (asset) outcome.videos++;
    }
    if (outcome.videos === 0 && kind === "youtube") {
      // YouTube ne sert pas de flux téléchargeable : ses adresses média sont
      // signées et éphémères. Il faudrait yt-dlp, absent d'Android sans
      // module natif dédié.
      notes.push(
        "Vidéo YouTube non conservée : titre, description et miniature le sont.",
      );
    }
  }

  await setFetchStatus(bookmarkId, blocked ? "error" : "success",
    blocked ? notes[0] : undefined);
  return outcome;
}
