import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";

import { searchBookmarks, setFavourite } from "../../src/db/bookmarks";
import type { Bookmark } from "../../src/db/types";
import { BookmarkCard } from "../../src/ui/BookmarkCard";
import { EmptyState } from "../../src/ui/components";
import { notifyBookmarksChanged } from "../../src/ui/events";
import { radius, spacing, useTheme } from "../../src/ui/theme";

export default function SearchScreen() {
  const t = useTheme();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Bookmark[]>([]);

  // Anti-rebond : la recherche part sur chaque frappe, mais la requête FTS5
  // n'est lancée qu'une fois la saisie stabilisée.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchBookmarks(trimmed).then((rows) => {
        if (!cancelled) setResults(rows);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <View
        style={[
          styles.searchBar,
          { backgroundColor: t.surface, borderColor: t.border },
        ]}
      >
        <Ionicons name="search" size={18} color={t.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Titre, description, contenu…"
          placeholderTextColor={t.textFaint}
          style={[styles.input, { color: t.text }]}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
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
          query.trim().length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="Recherche plein texte"
              message="La recherche porte sur le titre, la description et le contenu extrait de chaque page. Tout se passe sur l'appareil."
            />
          ) : (
            <EmptyState
              icon="file-tray-outline"
              title="Aucun résultat"
              message={`Rien ne correspond à « ${query.trim()} ».`}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.lg,
    marginBottom: 0,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 46,
  },
  input: { flex: 1, fontSize: 15, height: "100%" },
  list: { padding: spacing.lg, gap: spacing.md },
});
