import { downloadAsset, saveText, adoptFile } from "../db/assets";
import { saveExtractedContent, setFetchStatus } from "../db/bookmarks";
import { detectSource, planFor, youtubeThumbnail } from "../archive/sources";
import { enqueue, isWorkerReady } from "../archive/queue";
import type { ArchiveResult } from "../archive/types";
import { getDb } from "../db/client";

/**
 * Capture complète d'un lien : rendu de la page par le moteur d'Android,
 * extraction du contenu, puis conservation des pièces.
 *
 * Remplace le worker `crawler` de Karakeep. La différence avec la version
 * précédente de cette application est décisive : le JavaScript du site est
 * exécuté avant extraction, comme le ferait le Chrome sans interface côté
 * serveur.
 */

export interface CaptureOutcome {
  screenshot: boolean;
  archive: boolean;
  images: number;
  videos: number;
  notes: string[];
}

async function setSourceKind(id: string, kind: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE bookmarks SET source_kind = ? WHERE id = ?", [
    kind,
    id,
  ]);
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

  let result: ArchiveResult;
  try {
    result = await enqueue(url, {
      wantArchive: plan.wantArchive,
      wantScreenshot: plan.wantScreenshot,
      sourceKind: plan.kind,
      extraSettleMs: plan.extraSettleMs,
    });
  } catch (err) {
    await setFetchStatus(bookmarkId, "error", (err as Error).message);
    throw err;
  }

  const page = result.page;

  await saveExtractedContent(bookmarkId, {
    title: page.title,
    description: page.description,
    content: page.content || null,
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
    notes,
  };

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

  // --- Images d'illustration ---
  // Triées par surface : les plus grandes sont les illustrations, les petites
  // des icônes ou des avatars.
  const images = [...page.images].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  if (kind === "youtube") {
    const thumb = youtubeThumbnail(url);
    if (thumb) images.unshift({ url: thumb, width: 1280, height: 720, alt: null });
  }
  for (const img of images.slice(0, plan.maxImages)) {
    const asset = await downloadAsset(bookmarkId, "image", img.url);
    if (asset) outcome.images++;
  }

  // --- Vidéos ---
  if (plan.wantVideo) {
    const direct = page.videos.filter((v) => v.kind === "file");
    for (const video of direct.slice(0, 3)) {
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
      // signées et changent à chaque lecture. Récupérer la vidéo demanderait
      // yt-dlp, qui n'existe pas sur Android sans module natif dédié.
      notes.push(
        "Vidéo YouTube non conservée : seuls le titre, la description et la miniature le sont.",
      );
    } else if (outcome.videos === 0 && page.videos.length > 0) {
      notes.push("Vidéo repérée mais non téléchargeable directement.");
    }
  }

  await setFetchStatus(bookmarkId, "success");
  return outcome;
}
