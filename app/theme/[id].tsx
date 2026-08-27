import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { getDb } from "../../src/db/client";
import { setFavourite } from "../../src/db/bookmarks";
import { rowToBookmark, type Bookmark, type BookmarkRow } from "../../src/db/types";
import { BookmarkCard } from "../../src/ui/BookmarkCard";
import { EmptyState } from "../../src/ui/components";
import { notifyBookmarksChanged, useBookmarksRevision } from "../../src/ui/events";
import { spacing, useTheme } from "../../src/ui/theme";

/** Favoris d'un thème, ou d'un de ses sous-thèmes. */
export default function ThemeScreen() {
  const t = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const revision = useBookmarksRevision();
  const { id, subtheme, title } = useLocalSearchParams<{
    id: string;
    subtheme?: string;
    title?: string;
  }>();

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: title ?? "Thème" });
  }, [navigation, title]);

  const load = useCallback(async () => {
    const db = await getDb();
    const rows = subtheme
      ? await db.getAllAsync<BookmarkRow>(
          "SELECT * FROM bookmarks WHERE subtheme_id = ? AND archived = 0 ORDER BY created_at DESC",
          [subtheme],
        )
      : await db.getAllAsync<BookmarkRow>(
          "SELECT * FROM bookmarks WHERE theme_id = ? AND archived = 0 ORDER BY created_at DESC",
          [id],
        );

    // Les tags ne sont pas affichés sur cet écran : on évite la jointure.
    setBookmarks(rows.map((r) => rowToBookmark(r, [])));
  }, [id, subtheme]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <BookmarkCard
            bookmark={item}
            onPress={() => router.push(`/bookmark/${item.id}`)}
            onToggleFavourite={() =>
              void setFavourite(item.id, !item.favourited).then(
                notifyBookmarksChanged,
              )
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="file-tray-outline"
            title="Rien ici"
            message="Aucun lien n'a encore été rangé dans cette catégorie."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.md },
});
