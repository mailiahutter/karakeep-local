/**
 * Reconnaissance de la nature d'un lien et réglages d'extraction associés.
 *
 * Module pur : testable hors appareil.
 */

export type SourceKind = "website" | "youtube" | "instagram";

export interface SourcePlan {
  kind: SourceKind;
  /** Construire une archive HTML autonome. */
  wantArchive: boolean;
  /** Capturer l'écran de la page rendue. */
  wantScreenshot: boolean;
  /** Nombre d'images d'illustration conservées. */
  maxImages: number;
  /** Tenter de conserver la vidéo. */
  wantVideo: boolean;
  /** Délai supplémentaire avant extraction, pour les pages lentes. */
  extraSettleMs: number;
}

const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
];

const INSTAGRAM_HOSTS = ["instagram.com", "www.instagram.com"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectSource(url: string): SourceKind {
  const host = hostOf(url);
  if (!host) return "website";
  if (YOUTUBE_HOSTS.includes(host)) return "youtube";
  if (INSTAGRAM_HOSTS.includes(host)) return "instagram";
  return "website";
}

export function planFor(kind: SourceKind): SourcePlan {
  switch (kind) {
    case "youtube":
      return {
        kind,
        // Archiver le lecteur YouTube n'a aucun intérêt : la page est un
        // squelette et la vidéo n'y est pas.
        wantArchive: false,
        // Une capture du lecteur ne montre rien que la miniature ne montre
        // mieux : elle n'ajouterait qu'un fichier inutile.
        wantScreenshot: false,
        maxImages: 1, // la miniature
        wantVideo: true,
        extraSettleMs: 2000,
      };
    case "instagram":
      return {
        kind,
        wantArchive: false,
        // La capture ne montre que la page d'intégration, cadre et zones
        // blanches comprises. Les images et la vidéo de la publication sont
        // conservées telles quelles : la capture ferait doublon en moins bien.
        wantScreenshot: false,
        maxImages: 10, // un carrousel peut en contenir plusieurs
        wantVideo: true,
        extraSettleMs: 3500, // chargement différé systématique
      };
    case "website":
    default:
      return {
        kind,
        wantArchive: true,
        // Sur un site, la capture est la trace visuelle de la mise en page :
        // elle garde une valeur propre si le site disparaît.
        wantScreenshot: true,
        maxImages: 2, // une à deux illustrations, comme demandé
        wantVideo: false,
        extraSettleMs: 0,
      };
  }
}

/**
 * Identifiant d'une vidéo YouTube, quelle que soit la forme de l'adresse.
 * Sert à reconstruire l'URL de la miniature, qui elle est publique et stable.
 */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (YOUTUBE_HOSTS.includes(host)) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /shorts/<id>, /embed/<id>, /live/<id>
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function youtubeThumbnail(url: string): string | null {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : null;
}
