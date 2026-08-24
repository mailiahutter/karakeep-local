import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { listBookmarks, setFavourite } from "../../src/db/bookmarks";
import { listTags, type TagWithCount } from "../../src/db/tags";
import type { Bookmark } from "../../src/db/types";
import { BookmarkCard } from "../../src/ui/BookmarkCard";
import { EmptyState } from "../../src/ui/components";
import { notifyBookmarksChanged, useBookmarksRevision } from "../../src/ui/events";
import { spacing, useTheme } from "../../src/ui/theme";

export default function TagsScreen() {
  const t = useTheme();
  const router = useRouter();
  const revision = useBookmarksRevision();

  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [selected, setSelected] = useState<TagWithCount | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    void listTags().then(setTags);
  }, [revision]);

  const loadForTag = useCallback(async (tag: TagWithCount | null) => {
    if (!tag) {
      setBookmarks([]);
      return;
    }
    setBookmarks(await listBookmarks({ tagId: tag.id, limit: 200 }));
  }, []);

  useEffect(() => {
    void loadForTag(selected);
  }, [selected, loadForTag, revision]);

  // Un tag peut disparaître (dernier favori supprimé) alors qu'il est
  // sélectionné : on relâche la sélection au lieu d'afficher une liste morte.
  useEffect(() => {
    if (selected && !tags.some((tag) => tag.id === selected.id)) {
      setSelected(null);
    }
  }, [tags, selected]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      {tags.length > 0 && (
        <View style={styles.cloud}>
          {tags.map((tag) => {
            const active = selected?.id === tag.id;
            return (
              <Pressable
                key={tag.id}
                onPress={() => setSelected(active ? null : tag)}
                style={[
                  styles.tag,
                  {
                    backgroundColor: active ? t.accent : t.surface,
                    borderColor: active ? t.accent : t.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tagLabel,
                    { color: active ? t.accentText : t.text },
                  ]}
                >
                  {tag.name}
                </Text>
                <Text
                  style={[
                    styles.tagCount,
                    { color: active ? t.accentText : t.textFaint },
                  ]}
                >
                  {tag.count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

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
          tags.length === 0 ? (
            <EmptyState
              icon="pricetags-outline"
              title="Aucun tag pour l'instant"
              message="Les tags sont générés par le modèle embarqué après l'enregistrement d'un lien. Installe un modèle dans les réglages si ce n'est pas déjà fait."
            />
          ) : !selected ? (
            <EmptyState
              icon="hand-left-outline"
              title="Choisis un tag"
              message="Touche un tag ci-dessus pour voir les liens correspondants."
            />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  cloud: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: 0,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagLabel: { fontSize: 13, fontWeight: "600" },
  tagCount: { fontSize: 11, fontWeight: "700" },
  list: { padding: spacing.lg, gap: spacing.md },
});
