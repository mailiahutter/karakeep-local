/**
 * Lecture du résultat de yt-dlp.
 *
 * yt-dlp écrit une ligne JSON par élément téléchargé — une seule pour une
 * vidéo, une par image ou vidéo pour un carrousel. On en tire la fiche
 * (titre, légende, auteur, date) et la nature de chaque fichier produit.
 *
 * Module pur : testable hors appareil.
 */

export interface LocalMedia {
  path: string;
  type: "photo" | "video";
}

export interface YtdlpSummary {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  thumbnail: string | null;
  publishedAt: number | null;
  media: LocalMedia[];
}

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov)$/i;
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|gif)$/i;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function summarizeYtdlp(
  info: Record<string, unknown>[],
  files: string[],
): YtdlpSummary {
  const first = info[0] ?? {};
  const media: LocalMedia[] = [];
  for (const path of files) {
    if (VIDEO_EXT.test(path)) media.push({ path, type: "video" });
    else if (PHOTO_EXT.test(path)) media.push({ path, type: "photo" });
  }
  const ts =
    typeof first.timestamp === "number"
      ? first.timestamp * 1000
      : typeof first.upload_date === "string" && /^\d{8}$/.test(first.upload_date)
        ? Date.parse(
            `${first.upload_date.slice(0, 4)}-${first.upload_date.slice(4, 6)}-${first.upload_date.slice(6, 8)}`,
          ) || null
        : null;
  return {
    title: str(first.title) ?? str(first.fulltitle),
    description: str(first.description),
    author: str(first.uploader) ?? str(first.channel) ?? str(first.uploader_id),
    siteName: str(first.extractor_key) ?? str(first.webpage_url_domain),
    thumbnail: str(first.thumbnail),
    publishedAt: ts,
    media,
  };
}
