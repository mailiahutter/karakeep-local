import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDb } from "../../src/db/client";
import { listThemes, type Theme } from "../../src/db/themes";
import { rowToBookmark, type Bookmark, type BookmarkRow } from "../../src/db/types";
import { EmptyState } from "../../src/ui/components";
import { useBookmarksRevision } from "../../src/ui/events";
import { radius, spacing, useTheme } from "../../src/ui/theme";

/**
 * Un tiroir ouvert : les sous-thèmes en filtres, puis une grille de photos.
 * Toucher une photo ouvre l'idée.
 */
export default function DrawerScreen() {
  const t = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const revision = useBookmarksRevision();
  const { id, subtheme, title } = useLocalSearchParams<{ id: string; subtheme?: string; title?: string }>();

  const [theme, setTheme] = useState<Theme | null>(null);
  const [sub, setSub] = useState<string | null>(subtheme ?? null);
  const [items, setItems] = useState<Bookmark[]>([]);

  const load = useCallback(async () => {
    const themes = await listThemes();
    setTheme(themes.find((x) => x.id === id) ?? null);
    const db = await getDb();
    const rows = await db.getAllAsync<BookmarkRow & { thumb: string | null }>(
      `SELECT b.*, (SELECT a.path FROM assets a WHERE a.bookmark_id = b.id AND a.kind = 'image'
                     ORDER BY a.created_at LIMIT 1) AS thumb
         FROM bookmarks b WHERE b.theme_id = ? AND b.archived = 0 ORDER BY b.created_at DESC`,
      [id],
    );
    setItems(rows.map((r) => rowToBookmark(r, [], r.thumb)));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useLayoutEffect(() => {
    const label = theme ? `${theme.icon ?? ""} ${theme.name}`.trim() : (title ?? "Tiroir");
    navigation.setOptions({ title: label });
  }, [navigation, theme, title]);

  const shown = useMemo(() => (sub ? items.filter((b) => b.subthemeId === sub) : items), [items, sub]);
  const subName = (sid: string | null) => theme?.subthemes.find((s) => s.id === sid)?.name ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {theme && theme.subthemes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subs} style={{ flexGrow: 0 }}>
          {[{ id: null as string | null, name: "Tout" }, ...theme.subthemes].map((s) => {
            const active = sub === s.id;
            return (
              <Pressable
                key={s.id ?? "all"}
                onPress={() => setSub(s.id)}
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  { backgroundColor: active ? t.accent : t.surface, borderColor: active ? t.accent : t.border },
                ]}
              >
                <Text style={{ color: active ? t.accentText : t.textMuted, fontWeight: "600", fontSize: 13 }}>{s.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <FlatList
        data={shown}
        keyExtractor={(b) => b.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <EmptyState icon="file-tray-outline" title="Rien ici" message="Aucune idée rangée ici pour l'instant." />
        }
        renderItem={({ item, index }) => {
          const thumb = item.thumbnailPath ?? item.imageUrl;
          return (
            <Pressable
              onPress={() => router.push(`/bookmark/${item.id}`)}
              style={({ pressed }) => [styles.tile, { backgroundColor: t.surface, opacity: pressed ? 0.8 : 1 }]}
            >
              {thumb ? (
                <Image
                  source={{ uri: thumb }}
                  style={[styles.photo, { aspectRatio: index % 3 === 0 ? 3 / 4 : 1, backgroundColor: t.surfaceAlt }]}
                />
              ) : (
                <View style={[styles.photo, { aspectRatio: 1, backgroundColor: t.surfaceAlt }]} />
              )}
              <Text style={[styles.tileTitle, { color: t.text }]} numberOfLines={2}>
                {item.title ?? item.url}
              </Text>
              {!sub && !!subName(item.subthemeId) && (
                <Text style={[styles.tileSub, { color: t.textFaint }]}>{subName(item.subthemeId)}</Text>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subs: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 999, borderWidth: 1 },
  grid: { padding: spacing.lg, gap: spacing.md },
  tile: { flex: 1, borderRadius: radius.lg, overflow: "hidden", paddingBottom: spacing.sm, maxWidth: "50%" },
  photo: { width: "100%" },
  tileTitle: { fontSize: 13.5, fontWeight: "600", paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  tileSub: { fontSize: 12, paddingHorizontal: spacing.sm },
});
