import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { getBookmark } from "../src/db/bookmarks";
import { listThemes, type Theme } from "../src/db/themes";
import type { Bookmark } from "../src/db/types";
import { getClassificationDetails, listFiledSinceIds } from "../src/db/verify";
import { EmptyState } from "../src/ui/components";
import { previousVisit } from "../src/ui/lastVisit";
import { radius, spacing, useTheme } from "../src/ui/theme";

interface Row {
  bookmark: Bookmark;
  confidence: number | null;
}

/** Ce que l'IA a rangé seule depuis la dernière visite. Facultatif. */
export default function FiledScreen() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);

  useEffect(() => {
    void (async () => {
      const { at } = await previousVisit();
      const [ids, th] = await Promise.all([listFiledSinceIds(at), listThemes()]);
      const out: Row[] = [];
      for (const id of ids) {
        const [b, d] = await Promise.all([getBookmark(id), getClassificationDetails(id)]);
        if (b) out.push({ bookmark: b, confidence: d?.confidence ?? null });
      }
      setThemes(th);
      setRows(out);
    })();
  }, []);

  const place = (b: Bookmark) => {
    const theme = themes.find((x) => x.id === b.themeId);
    const sub = theme?.subthemes.find((s) => s.id === b.subthemeId);
    return theme ? `${theme.icon ?? ""} ${theme.name}${sub ? ` › ${sub.name}` : ""}` : "";
  };

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.list}
      data={rows ?? []}
      keyExtractor={(r) => r.bookmark.id}
      ListHeaderComponent={
        rows && rows.length > 0 ? (
          <Text style={{ color: t.textMuted, marginBottom: spacing.sm }}>
            {rows.length} idée{rows.length > 1 ? "s" : ""}, sans ton aide
          </Text>
        ) : null
      }
      ListEmptyComponent={
        rows ? (
          <EmptyState icon="moon-outline" title="Rien de neuf" message="L'IA n'a rien rangé seule depuis ta dernière visite." />
        ) : null
      }
      renderItem={({ item }) => {
        const thumb = item.bookmark.thumbnailPath ?? item.bookmark.imageUrl;
        return (
          <Pressable
            onPress={() => router.push(`/bookmark/${item.bookmark.id}`)}
            style={({ pressed }) => [styles.row, { backgroundColor: t.surface, opacity: pressed ? 0.8 : 1 }]}
          >
            {thumb ? (
              <Image source={{ uri: thumb }} style={[styles.thumb, { backgroundColor: t.surfaceAlt }]} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: t.surfaceAlt }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: "700" }} numberOfLines={2}>
                {item.bookmark.title ?? item.bookmark.url}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 12.5 }}>
                {place(item.bookmark)}
                {item.confidence !== null ? ` · sûre à ${Math.round(item.confidence * 100)} %` : ""}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.lg },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
});
