import { Share } from "react-native";

import type { Bookmark } from "../db/types";

/** « Partager une idée à quelqu'un » : titre, ce que c'est, et le lien. */
export async function shareIdea(bookmark: Bookmark): Promise<void> {
  const lines = [
    bookmark.title ?? "",
    bookmark.summary ?? bookmark.subject ?? "",
    bookmark.url,
  ].filter((l) => l.trim().length > 0);
  await Share.share({ message: lines.join("\n\n"), title: bookmark.title ?? undefined });
}
