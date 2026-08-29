import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { listBookmarks, setFavourite } from "../../src/db/bookmarks";
import type { Bookmark } from "../../src/db/types";
import { processPending, subscribe } from "../../src/pipeline/queue";
import { BookmarkCard } from "../../src/ui/BookmarkCard";
import { EmptyState } from "../../src/ui/components";
import { QueueBanner } from "../../src/ui/QueueBanner";
import { ReviewBanner } from "../../src/ui/ReviewBanner";
import { notifyBookmarksChanged, useBookmarksRevision } from "../../src/ui/events";
import { radius, spacing, useTheme } from "../../src/ui/theme";

type Filter = "all" | "favourites" | "archived";

export default function BookmarksScreen() {
  const t = useTheme();
  const router = useRouter();
  const revision = useBookmarksRevision();

  const [filter, setFilter] = useState<Filter>("all");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await listBookmarks({
      archived: filter === "archived",
      favourited: filter === "favourites" ? true : undefined,
      limit: 200,
    });
    setBookmarks(rows);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  // La file d'arrière-plan enrichit les favoris après coup : la liste doit
  // refléter titres et tags dès qu'ils arrivent.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "bookmark-updated" || event.type === "idle") {
        void load();
      }
    });
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await processPending();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggleFavourite = useCallback(async (bookmark: Bookmark) => {
    await setFavourite(bookmark.id, !bookmark.favourited);
    notifyBookmarksChanged();
  }, []);

  const emptyMessage: Record<Filter, { title: string; message: string }> = {
    all: {
      title: "Aucun favori",
      message:
        "Partage un lien depuis ton navigateur vers Karakeep Local, ou ajoute-le avec le bouton +.",
    },
    favourites: {
      title: "Aucun favori marqué",
      message: "Touche l'étoile sur une fiche pour la retrouver ici.",
    },
    archived: {
      title: "Rien d'archivé",
      message: "Les liens archivés disparaissent de la liste principale.",
    },
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <View style={styles.filters}>
        {(
          [
            ["all", "Tous"],
            ["favourites", "Favoris"],
            ["archived", "Archivés"],
          ] as const
        ).map(([value, label]) => {
          const active = filter === value;
          return (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              style={[
                styles.filter,
                {
                  backgroundColor: active ? t.accent : t.surface,
                  borderColor: active ? t.accent : t.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterLabel,
                  { color: active ? t.accentText : t.textMuted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <QueueBanner />
      <ReviewBanner />

      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.accent}
          />
        }
        renderItem={({ item }) => (
          <BookmarkCard
            bookmark={item}
            onPress={() => router.push(`/bookmark/${item.id}`)}
            onToggleFavourite={() => void toggleFavourite(item)}
          />
        )}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="bookmark-outline"
              title={emptyMessage[filter].title}
              message={emptyMessage[filter].message}
            />
          )
        }
      />

      <Pressable
        onPress={() => router.push("/add")}
        style={[styles.fab, { backgroundColor: t.accent }]}
        accessibilityRole="button"
        accessibilityLabel="Ajouter un lien"
      >
        <Ionicons name="add" size={28} color={t.accentText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filters: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filter: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterLabel: { fontSize: 13, fontWeight: "600" },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xl,
    width: 58,
    height: 58,
    borderRadius: radius.lg + 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },
});
