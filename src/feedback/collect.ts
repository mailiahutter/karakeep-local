import * as Application from "expo-application";

import { listAssets } from "../db/assets";
import { getBookmark } from "../db/bookmarks";
import { listThemes } from "../db/themes";
import { loadSettings } from "../db/settings";
import { formatBytes } from "../ai/models";
import type { ReviewSnapshot } from "./format";

/**
 * Fige ce que le modèle a proposé pour un favori.
 *
 * Cette copie est prise au moment de l'avis, jamais à l'export : entre les
 * deux, l'utilisateur aura probablement corrigé le thème ou retiré un tag, et
 * le retour porterait alors sur une proposition qui n'existe plus.
 */

const KIND_LABEL: Record<string, string> = {
  screenshot: "capture d'écran",
  archive: "page archivée",
  image: "image",
  video: "vidéo",
  pdf: "PDF",
};

export async function buildSnapshot(
  bookmarkId: string,
): Promise<ReviewSnapshot | null> {
  const bookmark = await getBookmark(bookmarkId);
  if (!bookmark) return null;

  const [assets, themes, settings] = await Promise.all([
    listAssets(bookmarkId),
    listThemes(),
    loadSettings(),
  ]);

  let theme: string | null = null;
  const parent = themes.find((t) => t.id === bookmark.themeId);
  if (parent) {
    const sub = parent.subthemes.find((s) => s.id === bookmark.subthemeId);
    theme = sub ? `${parent.name} › ${sub.name}` : parent.name;
  }

  return {
    url: bookmark.url,
    title: bookmark.title,
    sourceKind: bookmark.sourceKind,
    subject: bookmark.subject,
    theme,
    tags: bookmark.tags.map((t) => t.name),
    assets: assets.map(
      (a) => `${KIND_LABEL[a.kind] ?? a.kind} ${formatBytes(a.bytes)}`,
    ),
    summary: bookmark.summary,
    modelId: settings.modelId,
  };
}

export function appVersion(): string {
  return Application.nativeApplicationVersion ?? "inconnue";
}
