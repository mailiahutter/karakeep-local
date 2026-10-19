/**
 * Lecture des données d'une publication Instagram.
 *
 * Méthode reprise de Cobalt (github.com/imputnet/cobalt, AGPL-3.0, comme ce
 * projet) : plutôt que de deviner les médias en lisant la page affichée, on
 * interroge les adresses qu'Instagram utilise pour ses intégrations et son
 * application, qui renvoient des données structurées — chaque élément du
 * carrousel dans l'ordre, l'adresse de la vidéo en pleine qualité, la
 * légende. C'est ce qui manquait pour en finir avec les mauvaises photos de
 * carrousel, les vignettes parasites et les vidéos absentes ou en double.
 *
 * Deux formes de données coexistent : celle de la page d'intégration et de
 * l'API GraphQL du site (`shortcode_media`), et celle de l'API mobile
 * (`items[0]`). Ce module les ramène à une seule.
 *
 * Module pur : testable hors appareil.
 */

export type IgMediaType = "photo" | "video";

export interface IgMedia {
  type: IgMediaType;
  /** Fichier à conserver : la photo, ou la vidéo. */
  url: string;
  /** Image fixe correspondante ; pour une vidéo, sa vignette. */
  thumb: string | null;
  width: number;
  height: number;
}

export interface IgPost {
  shortcode: string | null;
  caption: string;
  author: string | null;
  /** Secondes depuis l'époque Unix, quand Instagram la fournit. */
  takenAt: number | null;
  items: IgMedia[];
}

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Extrait les données de la page d'intégration (`/p/<code>/embed/captioned/`).
 *
 * Elles sont enfouies dans un appel `"init",[],[{…contextJSON…}]` : une chaîne
 * JSON dans du JSON. Toute variation de forme renvoie `null` plutôt qu'une
 * exception — l'appelant passera alors à la méthode suivante.
 */
export function parseEmbedContext(html: string): Json | null {
  const match = html.match(/"init",\[\],\[(.*?)\]\],/);
  if (!match) return null;
  try {
    const outer = obj(JSON.parse(match[1]));
    const context = str(outer?.contextJSON);
    if (!context) return null;
    const inner = obj(JSON.parse(context));
    return obj(obj(inner?.gql_data)?.shortcode_media);
  } catch {
    return null;
  }
}

/** La plus grande des variantes proposées : Instagram en sert plusieurs. */
function largest(candidates: unknown[]): Json | null {
  let best: Json | null = null;
  for (const c of candidates) {
    const o = obj(c);
    if (!o || !str(o.url ?? o.src)) continue;
    const area = num(o.width ?? o.config_width) * num(o.height ?? o.config_height);
    const bestArea = best
      ? num(best.width ?? best.config_width) * num(best.height ?? best.config_height)
      : -1;
    if (area > bestArea) best = o;
  }
  return best;
}

/** Un élément au format GraphQL : publication simple ou nœud de carrousel. */
function fromGqlNode(node: Json): IgMedia | null {
  const dims = obj(node.dimensions);
  const photo = str(node.display_url) ?? str(largest(arr(node.display_resources))?.src);
  const video = node.is_video === true ? str(node.video_url) : null;
  if (!photo && !video) return null;
  return {
    type: video ? "video" : "photo",
    url: (video ?? photo) as string,
    thumb: photo,
    width: num(dims?.width),
    height: num(dims?.height),
  };
}

/** Un élément au format de l'API mobile. */
function fromMobileNode(node: Json): IgMedia | null {
  const image = largest(arr(obj(node.image_versions2)?.candidates));
  const video = largest(arr(node.video_versions));
  const photoUrl = str(image?.url);
  const videoUrl = str(video?.url);
  if (!photoUrl && !videoUrl) return null;
  const chosen = videoUrl ? video : image;
  return {
    type: videoUrl ? "video" : "photo",
    url: (videoUrl ?? photoUrl) as string,
    thumb: photoUrl,
    width: num(chosen?.width ?? node.original_width),
    height: num(chosen?.height ?? node.original_height),
  };
}

/**
 * Ramène une publication, quelle que soit sa provenance, à une forme unique.
 * Renvoie `null` si elle ne contient aucun média exploitable.
 */
export function normalizePost(raw: unknown): IgPost | null {
  const media = obj(raw);
  if (!media) return null;

  const isMobile = "image_versions2" in media || "carousel_media" in media || "video_versions" in media;
  let items: IgMedia[];
  let caption: string;
  let author: string | null;
  let takenAt: number | null;

  if (isMobile) {
    const carousel = arr(media.carousel_media).map(obj).filter((n): n is Json => n !== null);
    items = (carousel.length ? carousel : [media])
      .map(fromMobileNode)
      .filter((m): m is IgMedia => m !== null);
    caption = str(obj(media.caption)?.text) ?? "";
    author = str(obj(media.user)?.username);
    takenAt = num(media.taken_at) || null;
  } else {
    const edges = arr(obj(media.edge_sidecar_to_children)?.edges)
      .map((e) => obj(obj(e)?.node))
      .filter((n): n is Json => n !== null);
    items = (edges.length ? edges : [media])
      .map(fromGqlNode)
      .filter((m): m is IgMedia => m !== null);
    const firstCaption = obj(arr(obj(media.edge_media_to_caption)?.edges)[0]);
    caption = str(obj(firstCaption?.node)?.text) ?? "";
    author = str(obj(media.owner)?.username);
    takenAt = num(media.taken_at_timestamp) || null;
  }

  if (items.length === 0) return null;
  return { shortcode: str(media.shortcode) ?? str(media.code), caption, author, takenAt, items };
}

// --- Choix de la méthode -------------------------------------------------

export type CaptureMethod = "api" | "page" | "ytdlp";

export interface MethodStats {
  ok: number;
  fail: number;
}

/**
 * Ordre dans lequel essayer les méthodes : la plus fiable d'abord.
 *
 * La fiabilité se mesure sur l'usage réel de l'appareil, avec un lissage pour
 * qu'un seul échec en début de vie ne fasse pas basculer l'ordre. À égalité,
 * la méthode « api » passe en premier : c'est celle qui a donné les meilleurs
 * résultats lors des essais sur de vraies publications.
 */
export function rankMethods(
  stats: Partial<Record<CaptureMethod, MethodStats>>,
): CaptureMethod[] {
  const rate = (m: CaptureMethod) => {
    const s = stats[m] ?? { ok: 0, fail: 0 };
    // Lissage de Laplace, avec un a priori favorable à « api ». yt-dlp part
    // dernier : plus lent, il télécharge tout avant de rendre la main.
    const prior = m === "api" ? 2 : m === "page" ? 1 : 0.5;
    return (s.ok + prior) / (s.ok + s.fail + 2);
  };
  return (["api", "page", "ytdlp"] as CaptureMethod[]).sort((a, b) => rate(b) - rate(a));
}

/** Met à jour les statistiques après une tentative. */
export function recordAttempt(
  stats: Partial<Record<CaptureMethod, MethodStats>>,
  method: CaptureMethod,
  ok_: boolean,
): Partial<Record<CaptureMethod, MethodStats>> {
  const prev = stats[method] ?? { ok: 0, fail: 0 };
  let ok = prev.ok + (ok_ ? 1 : 0);
  let fail = prev.fail + (ok_ ? 0 : 1);
  // Au-delà de cinquante essais, l'historique est divisé par deux : une
  // méthode qui se dégrade aujourd'hui doit pouvoir perdre la première place
  // sans que des mois de succès passés la protègent.
  if (ok + fail > 50) {
    ok = Math.round(ok / 2);
    fail = Math.round(fail / 2);
  }
  return { ...stats, [method]: { ok, fail } };
}
