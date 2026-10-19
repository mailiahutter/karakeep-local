import {
  adoptFile,
  deleteAssets,
  downloadAsset,
  listAssets,
  saveText,
} from "../db/assets";
import { saveExtractedContent, setFetchStatus } from "../db/bookmarks";
import { detectSource, planFor, youtubeThumbnail, type SourcePlan } from "../archive/sources";
import {
  captionWithoutHashtags,
  hashtagsFrom,
  instagramEmbedUrl,
  instagramShortcode,
  isStatsBoilerplate,
  looksLikeLoginWall,
  usefulHashtags,
  mediaIdentity,
  pickCarousel,
} from "../archive/instagram";
import { fetchInstagramPost } from "../archive/igApi";
import type { IgMedia } from "../archive/igParse";
import { noteAttempt, rankedMethods } from "../archive/igMethods";
import { pickImages } from "../archive/images";
import { fetchPage } from "../archive/fetchPage";
import { enqueue, isWorkerReady } from "../archive/queue";
import type { CapturedImage, CapturedVideo } from "../archive/types";
import { getDb } from "../db/client";
import { isNetworkFailure } from "./retry";
import { summarizeYtdlp, type LocalMedia } from "../archive/ytdlpInfo";
import { connectionKind } from "../ai/download";
import { setOcrText } from "../db/ocr";
import { hasMediaTools, ytdlpDownload } from "../../modules/karakeep-worker/src";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Capture complète d'un lien : lecture, extraction, puis conservation des
 * pièces sur l'appareil.
 *
 * Pour Instagram, deux méthodes coexistent et se relaient :
 * - « api » interroge les adresses de données d'Instagram, à la manière de
 *   Cobalt : médias exacts, carrousel complet et dans l'ordre ;
 * - « page » lit la page elle-même, par la WebView quand l'interface est
 *   montée, ou par une simple requête sinon.
 * La plus fiable sur cet appareil passe en premier ; si elle échoue, l'autre
 * prend le relais. Les autres sites passent par la lecture de page.
 */

export interface CaptureOutcome {
  screenshot: boolean;
  archive: boolean;
  images: number;
  videos: number;
  hashtags: number;
  /** Méthode qui a fourni les données, pour le journal. */
  via: string | null;
  notes: string[];
}

/** Ce qu'une méthode a pu rassembler, avant tout enregistrement. */
interface Gathered {
  via: string;
  title: string | null;
  description: string | null;
  content: string;
  author: string | null;
  siteName: string | null;
  imageUrl: string | null;
  publishedAt: number | null;
  screenshotUri?: string;
  archiveHtml?: string | null;
  archiveError?: string;
  /** Médias connus exactement (API), ou à trier parmi ceux de la page. */
  exact: IgMedia[] | null;
  /** Fichiers déjà téléchargés sur l'appareil (yt-dlp). */
  local?: LocalMedia[];
  images: CapturedImage[];
  videos: CapturedVideo[];
  /** La page a-t-elle livré quelque chose d'exploitable ? */
  usable: boolean;
  /** Lue sans moteur de rendu : capture d'écran et archive manquent. */
  light: boolean;
}

async function setSourceKind(id: string, kind: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET source_kind = ? WHERE id = ?", [kind, id]);
}

async function setCaptureMode(id: string, mode: "light" | "full"): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET capture_mode = ? WHERE id = ?", [mode, id]);
}

/**
 * Un titre lisible tiré de la légende.
 *
 * La liste affichait « Instagram » sur chaque publication, ce qui ne disait
 * rien de son contenu. La première phrase de la légende, débarrassée de ses
 * hashtags, fait bien mieux.
 */
export function titleFromCaption(caption: string, author: string | null): string | null {
  const clean = captionWithoutHashtags(caption).split(/\n+/)[0]?.trim() ?? "";
  if (clean.length > 0) {
    const sentence = clean.split(/(?<=[.!?])\s/)[0];
    return sentence.length <= 90 ? sentence : `${sentence.slice(0, 87).trimEnd()}…`;
  }
  return author ? `Publication de @${author}` : null;
}

// --- Méthode « api » (Instagram) -----------------------------------------

async function gatherInstagramApi(url: string): Promise<Gathered | null> {
  const shortcode = instagramShortcode(url);
  if (!shortcode) return null;
  const result = await fetchInstagramPost(shortcode);
  if (!result) return null;
  const { post } = result;
  const firstImage = post.items.find((m) => m.thumb)?.thumb ?? null;
  return {
    via: `instagram-${result.via}`,
    title: titleFromCaption(post.caption, post.author),
    description: post.caption || null,
    content: post.caption,
    author: post.author,
    siteName: "Instagram",
    imageUrl: firstImage,
    publishedAt: post.takenAt ? post.takenAt * 1000 : null,
    exact: post.items,
    images: [],
    videos: [],
    usable: true,
    light: false,
  };
}

// --- Méthode « ytdlp » ------------------------------------------------------

function ytdlpDir(bookmarkId: string): string {
  return `${FileSystem.cacheDirectory}ytdlp/${bookmarkId}/`;
}

/**
 * yt-dlp, le moteur de l'application Seal : il connaît plus de mille sites et
 * suit leurs changements de près. Dernier recours pour Instagram, secours
 * pour les autres sites, et seule voie pour les vidéos YouTube.
 */
async function runYtdlp(
  bookmarkId: string,
  url: string,
): Promise<{ summary: ReturnType<typeof summarizeYtdlp> } | null> {
  if (!hasMediaTools()) return null;
  const dir = ytdlpDir(bookmarkId);
  await FileSystem.deleteAsync(dir, { idempotent: true });
  const result = await ytdlpDownload(url, dir.replace(/^file:\/\//, ""));
  const summary = summarizeYtdlp(result.info, result.files);
  return summary.media.length > 0 ? { summary } : null;
}

async function gatherYtdlp(bookmarkId: string, url: string): Promise<Gathered | null> {
  const ran = await runYtdlp(bookmarkId, url);
  if (!ran) return null;
  const { summary } = ran;
  const caption = summary.description ?? "";
  return {
    via: "ytdlp",
    title:
      summary.siteName === "Instagram"
        ? titleFromCaption(caption, summary.author) ?? summary.title
        : summary.title,
    description: summary.description,
    content: caption,
    author: summary.author,
    siteName: summary.siteName,
    imageUrl: summary.thumbnail,
    publishedAt: summary.publishedAt,
    exact: null,
    local: summary.media,
    images: [],
    videos: [],
    usable: true,
    light: false,
  };
}

/** Range les fichiers produits par yt-dlp parmi les pièces du favori. */
async function adoptLocal(
  bookmarkId: string,
  url: string,
  media: LocalMedia[],
  plan: SourcePlan,
  outcome: CaptureOutcome,
): Promise<void> {
  for (const m of media.slice(0, Math.max(plan.maxImages, 1) + 2)) {
    try {
      await adoptFile(bookmarkId, m.type === "video" ? "video" : "image", `file://${m.path}`, url);
      if (m.type === "video") outcome.videos++;
      else outcome.images++;
    } catch (err) {
      outcome.notes.push(`Média non conservé : ${(err as Error).message}`);
    }
  }
  await FileSystem.deleteAsync(ytdlpDir(bookmarkId), { idempotent: true }).catch(() => {});
}

// --- Méthode « page » ------------------------------------------------------

async function gatherPage(
  url: string,
  kind: ReturnType<typeof detectSource>,
  plan: SourcePlan,
): Promise<{ gathered: Gathered | null; error: Error | null }> {
  // La WebView n'existe que dans un arbre React monté. Hors interface, on lit
  // la page sans moteur de rendu plutôt que de renoncer.
  const rendered = isWorkerReady();

  // Instagram sert un mur de connexion sur l'adresse normale ; sa page
  // d'intégration, prévue pour les sites tiers, est essayée en premier.
  const targets: string[] = [];
  if (kind === "instagram") {
    const embed = instagramEmbedUrl(url);
    if (embed) targets.push(embed);
  }
  targets.push(url);

  let best: Gathered | null = null;
  let lastError: Error | null = null;

  for (const target of targets) {
    try {
      const result = rendered
        ? await enqueue(target, {
            wantArchive: plan.wantArchive,
            wantScreenshot: plan.wantScreenshot,
            sourceKind: plan.kind,
            extraSettleMs: plan.extraSettleMs,
          })
        : await fetchPage(target);
      const page = result.page;
      let description = page.description;
      let content = page.content;
      if (kind === "instagram") {
        // « 472 likes, 1 comments - … » n'est pas une légende.
        if (isStatsBoilerplate(description)) description = null;
        if (isStatsBoilerplate(content)) content = "";
        if (page.igCaption) {
          description = page.igCaption;
          content = page.igCaption;
        }
      }
      const usable =
        !looksLikeLoginWall(page.title, page.content) && page.content.trim().length >= 40;
      const gathered: Gathered = {
        via: rendered ? "page-rendue" : "page-lue",
        title:
          kind === "instagram" && content
            ? titleFromCaption(content, page.author) ?? page.title
            : page.title,
        description,
        content,
        author: page.author,
        siteName: page.siteName,
        imageUrl: page.imageUrl,
        publishedAt: page.publishedAt ? Date.parse(page.publishedAt) || null : null,
        screenshotUri: result.screenshotUri,
        archiveHtml: result.archiveHtml,
        archiveError: result.archiveError,
        exact: null,
        images: page.images,
        videos: page.videos,
        usable,
        light: !rendered,
      };
      if (usable) return { gathered, error: null };
      best ??= gathered;
    } catch (err) {
      lastError = err as Error;
    }
  }
  return { gathered: best, error: lastError };
}

// --- Capture ---------------------------------------------------------------

export async function captureBookmark(
  bookmarkId: string,
  url: string,
): Promise<CaptureOutcome> {
  const notes: string[] = [];
  const kind = detectSource(url);
  const plan = planFor(kind);
  await setSourceKind(bookmarkId, kind);
  await setFetchStatus(bookmarkId, "running");

  // Les pièces déjà conservées ne sont remplacées qu'une fois la nouvelle
  // capture réussie. Les effacer d'abord détruisait l'archive d'une
  // publication supprimée entre-temps — ce que l'application doit justement
  // préserver.
  const previous = await listAssets(bookmarkId);

  let source: Gathered | null = null;
  let fallback: Gathered | null = null;
  let lastError: Error | null = null;

  const methods =
    kind === "instagram" ? await rankedMethods() : (["page", "ytdlp"] as const);
  for (const method of methods) {
    if (method === "ytdlp") {
      if (!hasMediaTools()) continue;
      let g: Gathered | null = null;
      try {
        g = await gatherYtdlp(bookmarkId, url);
      } catch (err) {
        // Une coupure réseau constatée plus tôt reste la cause à retenir :
        // c'est elle qui fait différer le lien plutôt que le condamner.
        if (!lastError || !isNetworkFailure(lastError.message)) lastError = err as Error;
      }
      if (kind === "instagram") await noteAttempt("ytdlp", g !== null);
      if (g) {
        source = g;
        break;
      }
    } else if (method === "api") {
      let g: Gathered | null = null;
      try {
        g = await gatherInstagramApi(url);
      } catch (err) {
        lastError = err as Error;
      }
      await noteAttempt("api", g !== null);
      if (g) {
        source = g;
        break;
      }
    } else {
      const { gathered, error } = await gatherPage(url, kind, plan);
      if (error) lastError = error;
      if (kind === "instagram") await noteAttempt("page", !!gathered?.usable);
      if (gathered?.usable) {
        source = gathered;
        break;
      }
      fallback ??= gathered;
    }
    notes.push(`Méthode « ${method} » sans résultat, bascule sur la suivante.`);
  }

  const outcome: CaptureOutcome = {
    screenshot: false,
    archive: false,
    images: 0,
    videos: 0,
    hashtags: 0,
    via: source?.via ?? null,
    notes,
  };

  if (!source) {
    // Rien d'exploitable. Une coupure réseau remonte telle quelle : la file
    // remet alors le lien en attente au lieu de le condamner. Sinon, erreur
    // explicite — et ce qui avait été conservé auparavant reste intact.
    if (!fallback && lastError && isNetworkFailure(lastError.message)) throw lastError;
    const hadMedia = previous.some((a) => a.kind === "image" || a.kind === "video");
    const reason =
      kind === "instagram"
        ? hadMedia
          ? "Instagram ne sert plus cette publication. Ce qui avait été conservé reste disponible."
          : "Instagram n'a pas servi la publication. Connecte-toi depuis Réglages → Compte Instagram, puis relance."
        : lastError?.message ??
          "Rien n'a pu être récupéré de cette page. Ouvre-la pour vérifier qu'elle est toujours en ligne.";
    notes.push(reason);
    await setFetchStatus(bookmarkId, hadMedia ? "success" : "error", hadMedia ? undefined : reason);
    return outcome;
  }

  // --- Texte -----------------------------------------------------------
  let content = source.content;
  if (kind === "instagram" && content) {
    // Les hashtags sont un indice choisi par l'auteur, pas des tags : filtrés,
    // plafonnés, ils rejoignent le texte soumis au modèle.
    const tags = usefulHashtags(hashtagsFrom(content));
    outcome.hashtags = tags.length;
    content = [
      captionWithoutHashtags(content),
      tags.length > 0 ? `Mots-clés de l'auteur : ${tags.join(", ")}` : "",
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
  }

  await saveExtractedContent(bookmarkId, {
    title: source.title,
    description: source.description,
    content: content.trim().length > 0 ? content : null,
    author: source.author,
    siteName: source.siteName,
    imageUrl: source.imageUrl,
    publishedAt: source.publishedAt,
  });

  // --- Capture d'écran et archive ---------------------------------------
  if (source.screenshotUri) {
    try {
      await adoptFile(bookmarkId, "screenshot", source.screenshotUri, url);
      outcome.screenshot = true;
    } catch (err) {
      notes.push(`Capture d'écran non conservée : ${(err as Error).message}`);
    }
  }
  if (source.archiveHtml) {
    try {
      await saveText(bookmarkId, "archive", source.archiveHtml, url);
      outcome.archive = true;
    } catch (err) {
      notes.push(`Archive non conservée : ${(err as Error).message}`);
    }
  } else if (source.archiveError) {
    notes.push(`Archive incomplète : ${source.archiveError}`);
  }

  // --- Médias -----------------------------------------------------------
  if (source.local) {
    await adoptLocal(bookmarkId, url, source.local, plan, outcome);
  } else if (source.exact) {
    await downloadExact(bookmarkId, source.exact, plan, outcome);
  } else {
    await downloadGuessed(bookmarkId, url, kind, plan, source, outcome);
  }

  const fresh = outcome.images + outcome.videos + (outcome.screenshot ? 1 : 0) + (outcome.archive ? 1 : 0);
  if (fresh > 0) {
    await deleteAssets(previous);
    // Nouvelles images : leur texte sera relu avant la prochaine analyse.
    await setOcrText(bookmarkId, null);
  }

  const hasText = !!source.description || content.trim().length > 0;
  const hasMedia = outcome.images + outcome.videos > 0 ||
    previous.some((a) => a.kind === "image" || a.kind === "video");
  if (!hasText && !hasMedia) {
    const reason =
      "Rien n'a pu être récupéré de cette page. Relance la capture, ou ouvre-la pour vérifier qu'elle est toujours en ligne.";
    notes.push(reason);
    await setFetchStatus(bookmarkId, "error", reason);
    return outcome;
  }

  // Une publication lue par l'API est complète : rien à reprendre plus tard.
  await setCaptureMode(bookmarkId, source.light && !source.exact ? "light" : "full");
  await setFetchStatus(bookmarkId, "success");
  return outcome;
}

/** Médias connus exactement : tous, dans l'ordre, sans tri ni filtre de poids. */
async function downloadExact(
  bookmarkId: string,
  items: IgMedia[],
  plan: SourcePlan,
  outcome: CaptureOutcome,
): Promise<void> {
  let coverKept = false;
  for (const item of items.slice(0, plan.maxImages)) {
    if (item.type === "video") {
      if (plan.wantVideo && (await downloadAsset(bookmarkId, "video", item.url, 200 * 1024 * 1024))) {
        outcome.videos++;
      }
      // La vignette de la première vidéo sert de couverture dans la liste.
      if (!coverKept && item.thumb && (await downloadAsset(bookmarkId, "image", item.thumb, 20 * 1024 * 1024))) {
        outcome.images++;
        coverKept = true;
      }
    } else if (await downloadAsset(bookmarkId, "image", item.url, 20 * 1024 * 1024)) {
      outcome.images++;
      coverKept = true;
    }
  }
}

/** Médias à trier parmi ceux de la page : la méthode historique. */
async function downloadGuessed(
  bookmarkId: string,
  url: string,
  kind: ReturnType<typeof detectSource>,
  plan: SourcePlan,
  source: Gathered,
  outcome: CaptureOutcome,
): Promise<void> {
  // Instagram publie le même fichier en plusieurs qualités : sans
  // dédoublonnage, la même vidéo était conservée deux fois.
  const seen = new Set<string>();
  const videos = source.videos.filter((v) => {
    if (v.kind !== "file") return false;
    const key = mediaIdentity(v.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (plan.wantVideo) {
    for (const video of videos.slice(0, 2)) {
      if (await downloadAsset(bookmarkId, "video", video.url, 200 * 1024 * 1024)) outcome.videos++;
    }
    if (outcome.videos === 0 && kind === "youtube") {
      // Une vidéo pèse vite des centaines de mégaoctets : en Wi-Fi seulement.
      if (hasMediaTools() && (await connectionKind()) === "wifi") {
        try {
          const ran = await runYtdlp(bookmarkId, url);
          const videosOnly = ran?.summary.media.filter((m) => m.type === "video") ?? [];
          await adoptLocal(bookmarkId, url, videosOnly, plan, outcome);
        } catch (err) {
          outcome.notes.push(`Vidéo YouTube non conservée : ${(err as Error).message}`);
        }
      }
      if (outcome.videos === 0) {
        outcome.notes.push("Vidéo YouTube non conservée pour l'instant : titre, description et miniature le sont.");
      }
    }
  }

  // Sans dimensions fiables, le poids du fichier écarte icônes et avatars.
  const minImageBytes = kind === "instagram" ? 30_000 : 15_000;
  let images: CapturedImage[];
  if (kind === "instagram") {
    images = pickCarousel(
      source.images.map((i) => ({ url: i.url, width: i.width, height: i.height })),
      plan.maxImages,
    ).map((m) => ({ url: m.url, width: m.width, height: m.height, alt: null }));
    if (outcome.videos > 0) images = images.slice(0, 2);
  } else {
    const ogImage = kind === "youtube" ? (youtubeThumbnail(url) ?? source.imageUrl) : source.imageUrl;
    images = pickImages(source.images, { ogImage, max: plan.maxImages });
  }
  for (const img of images) {
    if (await downloadAsset(bookmarkId, "image", img.url, 20 * 1024 * 1024, minImageBytes)) {
      outcome.images++;
    }
  }
}
