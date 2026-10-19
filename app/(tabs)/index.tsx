import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { countDoubts, listDrawers, type Drawer } from "../../src/db/verify";
import { getDb } from "../../src/db/client";
import { processPending, subscribe } from "../../src/pipeline/queue";
import { QueueBanner } from "../../src/ui/QueueBanner";
import { RecapBanner } from "../../src/ui/RecapBanner";
import { ThemeIcon } from "../../src/ui/ThemeIcon";
import { useBookmarksRevision } from "../../src/ui/events";
import { previousVisit } from "../../src/ui/lastVisit";
import { radius, spacing, useTheme } from "../../src/ui/theme";

/**
 * Accueil « Mes tiroirs », validé au tour 2.
 *
 * Le matin : en haut, seulement ce dont l'IA doute ; en dessous, une commode
 * — un tiroir par thème, avec sa photo de couverture, son nombre d'idées, et
 * un badge pour ce qui est arrivé depuis la dernière visite.
 */
export default function DrawersScreen() {
  const t = useTheme();
  const router = useRouter();
  const revision = useBookmarksRevision();
  const [drawers, setDrawers] = useState<Drawer[]>([]);
  const [doubts, setDoubts] = useState(0);
  const [unsorted, setUnsorted] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { at } = await previousVisit();
    const [d, n] = await Promise.all([listDrawers(at), countDoubts()]);
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM bookmarks WHERE archived = 0 AND theme_id IS NULL AND verified_at IS NOT NULL",
    );
    setDrawers(d);
    setDoubts(n);
    setUnsorted(row?.n ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "bookmark-updated" || event.type === "idle") void load();
      }),
    [load],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await processPending();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />
        }
      >
        {doubts > 0 ? (
          <Pressable
            onPress={() => router.push("/verify")}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.banner,
              { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.bannerCount, { color: t.accentText }]}>{doubts}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: t.accentText }]}>
                {doubts > 1 ? "rangements à vérifier" : "rangement à vérifier"}
              </Text>
              <Text style={[styles.bannerHint, { color: t.accentText }]}>
                L'IA hésite. Un toucher suffit pour chacun.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.accentText} />
          </Pressable>
        ) : (
          <View style={[styles.banner, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
            <Text style={[styles.bannerCount, { color: t.success }]}>✓</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: t.text }]}>Tout est rangé</Text>
              <Text style={[styles.bannerHint, { color: t.textMuted }]}>Rien à vérifier pour l'instant.</Text>
            </View>
          </View>
        )}

        <RecapBanner />
        <QueueBanner />

        <View style={styles.grid}>
          {drawers.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => router.push({ pathname: "/theme/[id]", params: { id: d.id, title: d.name } })}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${d.count} idées`}
              style={({ pressed }) => [
                styles.drawer,
                { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={[styles.cover, { backgroundColor: t.surfaceAlt }]}>
                {d.cover ? (
                  <Image source={{ uri: d.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <ThemeIcon icon={d.icon} size={40} color={t.textFaint} />
                )}
                {d.fresh > 0 && (
                  <View style={[styles.fresh, { backgroundColor: t.accent }]}>
                    <Text style={{ color: t.accentText, fontSize: 12, fontWeight: "700" }}>+{d.fresh}</Text>
                  </View>
                )}
              </View>
              <View style={styles.label}>
                <ThemeIcon icon={d.icon} size={15} color={t.accent} />
                <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
                  {d.name}
                </Text>
                <Text style={[styles.count, { color: t.textFaint }]}>{d.count}</Text>
              </View>
            </Pressable>
          ))}
          {unsorted > 0 && (
            <Pressable
              onPress={() => router.push("/list")}
              style={[styles.drawer, { backgroundColor: t.surface, borderColor: t.border }]}
            >
              <View style={[styles.cover, { backgroundColor: t.surfaceAlt }]}>
                <Text style={{ fontSize: 36 }}>📥</Text>
              </View>
              <View style={styles.label}>
                <Text style={[styles.name, { color: t.text }]}>À trier</Text>
                <Text style={[styles.count, { color: t.textFaint }]}>{unsorted}</Text>
              </View>
            </Pressable>
          )}
        </View>

        <Pressable onPress={() => router.push("/list")} style={styles.all}>
          <Text style={{ color: t.accent, fontWeight: "600" }}>Toutes les idées, en liste</Text>
        </Pressable>
      </ScrollView>

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
  content: { padding: spacing.lg, paddingBottom: 110 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  bannerCount: { fontSize: 26, fontWeight: "800", minWidth: 30, textAlign: "center" },
  bannerTitle: { fontSize: 15, fontWeight: "700" },
  bannerHint: { fontSize: 12.5, opacity: 0.9, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  drawer: {
    width: "48%",
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  cover: { aspectRatio: 4 / 3, alignItems: "center", justifyContent: "center" },
  fresh: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  label: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.md },
  name: { flex: 1, fontSize: 14, fontWeight: "700" },
  count: { fontSize: 13 },
  all: { alignSelf: "center", padding: spacing.lg },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xl,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },
});
