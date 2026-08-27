import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { listThemes, type Theme } from "../../src/db/themes";
import { EmptyState } from "../../src/ui/components";
import { radius, spacing, useTheme } from "../../src/ui/theme";

/**
 * Navigation par thème, l'ossature de l'application.
 *
 * On met des idées de côté pour les retrouver par sujet : une recette, une
 * amélioration pour la voiture, une idée d'aménagement de van. Les tags
 * restent un détail de la fiche ; le thème est la manière de circuler.
 */
export default function ThemesScreen() {
  const t = useTheme();
  const router = useRouter();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      void listThemes().then((rows) => {
        setThemes(rows);
        setLoading(false);
      });
    }, []),
  );

  const total = themes.reduce((n, th) => n + (th.count ?? 0), 0);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      {!loading && total === 0 && (
        <EmptyState
          icon="albums-outline"
          title="Rien de rangé pour l'instant"
          message="Les liens enregistrés sont classés automatiquement dans ces thèmes. Tu peux les modifier depuis Réglages → Thèmes."
        />
      )}

      {themes.map((theme) => {
        const expanded = open[theme.id] ?? false;
        return (
          <View
            key={theme.id}
            style={[
              styles.card,
              { backgroundColor: t.surface, borderColor: t.border },
            ]}
          >
            <Pressable
              onPress={() =>
                setOpen((o) => ({ ...o, [theme.id]: !expanded }))
              }
              style={styles.header}
              accessibilityRole="button"
            >
              <Ionicons
                name={
                  (theme.icon as keyof typeof Ionicons.glyphMap) ??
                  "folder-outline"
                }
                size={21}
                color={t.accent}
              />
              <Text style={[styles.themeName, { color: t.text }]}>
                {theme.name}
              </Text>
              <Text style={[styles.count, { color: t.textFaint }]}>
                {theme.count ?? 0}
              </Text>
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={17}
                color={t.textFaint}
              />
            </Pressable>

            {expanded && (
              <View style={styles.subs}>
                {theme.subthemes.map((sub) => (
                  <Pressable
                    key={sub.id}
                    onPress={() =>
                      router.push(
                        `/theme/${theme.id}?subtheme=${sub.id}&title=${encodeURIComponent(sub.name)}`,
                      )
                    }
                    style={({ pressed }) => [
                      styles.sub,
                      { borderTopColor: t.border, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={[styles.subName, { color: t.textMuted }]}>
                      {sub.name}
                    </Text>
                    <Text style={[styles.count, { color: t.textFaint }]}>
                      {sub.count ?? 0}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={15}
                      color={t.textFaint}
                    />
                  </Pressable>
                ))}

                <Pressable
                  onPress={() =>
                    router.push(
                      `/theme/${theme.id}?title=${encodeURIComponent(theme.name)}`,
                    )
                  }
                  style={({ pressed }) => [
                    styles.sub,
                    { borderTopColor: t.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.subName, { color: t.accent }]}>
                    Tout le thème
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={t.accent} />
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  themeName: { fontSize: 16, fontWeight: "700", flex: 1 },
  count: { fontSize: 13, fontWeight: "600" },
  subs: { paddingHorizontal: spacing.lg },
  sub: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subName: { fontSize: 14.5, flex: 1 },
});
