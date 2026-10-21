import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getDb } from "../../src/db/client";
import { listThemes, unfileBookmarks, type Theme } from "../../src/db/themes";
import { rowToBookmark, type Bookmark, type BookmarkRow } from "../../src/db/types";
import { fileByUser } from "../../src/db/verify";
import { DrawerPicker } from "../../src/ui/DrawerPicker";
import { EmptyState } from "../../src/ui/components";
import { notifyBookmarksChanged, useBookmarksRevision } from "../../src/ui/events";
import { ThemeEditorSheet, type ThemeFormMode } from "../../src/ui/ThemeForm";
import { radius, spacing, useTheme } from "../../src/ui/theme";

/**
 * Un tiroir ouvert : les sous-thèmes en filtres, puis une grille de photos.
 *
 * Tout se règle ici, sans passer par les réglages : modifier le tiroir,
 * ajouter, renommer ou supprimer un sous-thème (appui long sur son nom), et
 * déplacer des idées — appui long sur une photo pour en sélectionner, puis
 * « Déplacer » vers un autre tiroir, ou vers un tiroir créé à l'instant.
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
  const [editing, setEditing] = useState<ThemeFormMode | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const selecting = selected.size > 0;

  const load = useCallback(async () => {
    const themes = await listThemes();
    const found = themes.find((x) => x.id === id) ?? null;
    setTheme(found);
    if (!found) return;
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
    navigation.setOptions({
      title: selecting ? `${selected.size} sélectionnée${selected.size > 1 ? "s" : ""}` : label,
      headerRight: () =>
        theme && !selecting ? (
          <Pressable onPress={() => setEditing({ kind: "edit-theme", theme })} hitSlop={10} accessibilityLabel="Modifier le tiroir">
            <Ionicons name="create-outline" size={22} color={t.accent} />
          </Pressable>
        ) : null,
    });
  }, [navigation, theme, title, selecting, selected.size, t.accent]);

  const shown = useMemo(() => (sub ? items.filter((b) => b.subthemeId === sub) : items), [items, sub]);
  const subName = (sid: string | null) => theme?.subthemes.find((s) => s.id === sid)?.name ?? "";

  const toggle = (bid: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(bid)) next.delete(bid);
      else next.add(bid);
      return next;
    });

  const moveTo = async (themeId: string, subId: string | null) => {
    for (const bid of selected) await fileByUser(bid, themeId, subId);
    setSelected(new Set());
    notifyBookmarksChanged();
    await load();
  };

  const remove = () =>
    Alert.alert(
      "Retirer du tiroir ?",
      "Les idées ne sont pas effacées : elles vont dans « À vérifier » pour être rangées ailleurs.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer",
          style: "destructive",
          onPress: () =>
            void (async () => {
              await unfileBookmarks([...selected]);
              setSelected(new Set());
              notifyBookmarksChanged();
              await load();
            })(),
        },
      ],
    );

  if (!theme) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <EmptyState icon="file-tray-outline" title="Tiroir introuvable" message="Il a peut-être été supprimé." />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subs} style={{ flexGrow: 0 }}>
        {[{ id: null as string | null, name: "Tout" }, ...theme.subthemes].map((s) => {
          const active = sub === s.id;
          return (
            <Pressable
              key={s.id ?? "all"}
              onPress={() => setSub(s.id)}
              onLongPress={() => s.id && setEditing({ kind: "edit-sub", theme, subId: s.id })}
              accessibilityState={{ selected: active }}
              accessibilityHint={s.id ? "Appui long pour modifier ce sous-thème" : undefined}
              style={[
                styles.chip,
                { backgroundColor: active ? t.accent : t.surface, borderColor: active ? t.accent : t.border },
              ]}
            >
              <Text style={{ color: active ? t.accentText : t.textMuted, fontWeight: "600", fontSize: 13 }}>{s.name}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setEditing({ kind: "new-sub", theme })}
          accessibilityLabel="Ajouter un sous-thème"
          style={[styles.chip, { borderColor: t.border, borderStyle: "dashed", flexDirection: "row", gap: 4 }]}
        >
          <Ionicons name="add" size={15} color={t.accent} />
          <Text style={{ color: t.accent, fontWeight: "600", fontSize: 13 }}>Sous-thème</Text>
        </Pressable>
      </ScrollView>

      {!selecting && items.length > 0 && (
        <Text style={[styles.tip, { color: t.textFaint }]}>Appui long sur une photo pour déplacer des idées.</Text>
      )}

      <FlatList
        data={shown}
        keyExtractor={(b) => b.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={[styles.grid, selecting && { paddingBottom: 110 }]}
        ListEmptyComponent={
          <EmptyState icon="file-tray-outline" title="Rien ici" message="Aucune idée rangée ici pour l'instant." />
        }
        renderItem={({ item, index }) => {
          const thumb = item.thumbnailPath ?? item.imageUrl;
          const isOn = selected.has(item.id);
          return (
            <Pressable
              onPress={() => (selecting ? toggle(item.id) : router.push(`/bookmark/${item.id}`))}
              onLongPress={() => toggle(item.id)}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: t.surface,
                  borderColor: isOn ? t.accent : "transparent",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              {thumb ? (
                <Image
                  source={{ uri: thumb }}
                  style={[styles.photo, { aspectRatio: index % 3 === 0 ? 3 / 4 : 1, backgroundColor: t.surfaceAlt }]}
                />
              ) : (
                <View style={[styles.photo, { aspectRatio: 1, backgroundColor: t.surfaceAlt }]} />
              )}
              {selecting && (
                <View style={[styles.check, { backgroundColor: isOn ? t.accent : "rgba(0,0,0,0.35)" }]}>
                  {isOn && <Ionicons name="checkmark" size={16} color={t.accentText} />}
                </View>
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

      {selecting && (
        <View style={[styles.bar, { backgroundColor: t.surface, borderTopColor: t.border }]}>
          <Pressable onPress={() => setMoving(true)} style={[styles.barButton, { backgroundColor: t.accent }]}>
            <Ionicons name="file-tray-stacked-outline" size={18} color={t.accentText} />
            <Text style={{ color: t.accentText, fontWeight: "700" }}>Déplacer…</Text>
          </Pressable>
          <Pressable onPress={remove} style={[styles.barButton, { backgroundColor: t.surfaceAlt }]}>
            <Ionicons name="return-up-back-outline" size={18} color={t.text} />
            <Text style={{ color: t.text, fontWeight: "600" }}>Retirer</Text>
          </Pressable>
          <Pressable onPress={() => setSelected(new Set())} hitSlop={10} style={{ padding: spacing.sm }}>
            <Text style={{ color: t.textMuted }}>Annuler</Text>
          </Pressable>
        </View>
      )}

      <DrawerPicker
        visible={moving}
        onClose={() => setMoving(false)}
        onPick={(themeId, subId) => {
          setMoving(false);
          void moveTo(themeId, subId);
        }}
      />
      <ThemeEditorSheet
        mode={editing}
        onClose={() => setEditing(null)}
        onDone={(r) => {
          if (r.deleted && editing?.kind === "edit-theme") {
            router.back();
            return;
          }
          if (r.deleted) setSub(null);
          void load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subs: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 999, borderWidth: 1, alignItems: "center" },
  tip: { fontSize: 12, paddingHorizontal: spacing.lg },
  grid: { padding: spacing.lg, gap: spacing.md },
  tile: { flex: 1, borderRadius: radius.lg, overflow: "hidden", paddingBottom: spacing.sm, maxWidth: "50%", borderWidth: 2 },
  photo: { width: "100%" },
  check: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitle: { fontSize: 13.5, fontWeight: "600", paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  tileSub: { fontSize: 12, paddingHorizontal: spacing.sm },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
});
