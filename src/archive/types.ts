export interface CapturedImage {
  url: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface CapturedVideo {
  url: string;
  /** `file` : flux directement téléchargeable. `embed` : lecteur tiers. */
  kind: "file" | "embed";
}

/** Ce que le script injecté renvoie après exécution du JavaScript de la page. */
export interface RenderedPage {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  content: string;
  images: CapturedImage[];
  videos: CapturedVideo[];
  /** Instagram : légende réelle, si la page en a servi une. */
  igCaption?: string | null;
  /** Instagram : la phrase « N likes, M comments », à ne pas confondre. */
  igOgDescription?: string | null;
  /** YouTube : durée en secondes. */
  durationSec?: number;
}

export interface ArchiveResult {
  page: RenderedPage;
  /** Document autonome, styles et images intégrés. */
  archiveHtml: string | null;
  archiveError?: string;
  /** Fichier temporaire de la capture d'écran, à déplacer avant expiration. */
  screenshotUri?: string;
}

export type AssetKind =
  | "screenshot"
  | "pdf"
  | "archive"
  | "image"
  | "video";
