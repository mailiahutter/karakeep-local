import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { getDb } from "../db/client";
import { ACTIVITY_SINCE, recapSentence } from "../db/recap.sql";
import { previousVisit } from "./lastVisit";
import { useBookmarksRevision } from "./events";
import { radius, spacing, useTheme } from "./theme";

/**
 * « Cette nuit » : ce que l'application a fait seule depuis la dernière
 * ouverture. L'utilisateur n'ouvre presque jamais l'application ; sans cette
 * ligne, rien ne lui dit que la séance de nuit a tourné. Toucher la ligne
 * ouvre la liste de ce qui a été rangé sans lui.
 */
export function RecapBanner() {
  const t = useTheme();
  const router = useRouter();
  const revision = useBookmarksRevision();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { at, first } = await previousVisit();
      if (first) return setText(null);
      const db = await getDb();
      const a = await db.getFirstAsync<{
        filed: number | null;
        unfiled: number | null;
        gone: number | null;
        remaining: number | null;
      }>(ACTIVITY_SINCE, [at, at, at]);
      setText(
        recapSentence({
          filed: a?.filed ?? 0,
          unfiled: a?.unfiled ?? 0,
          gone: a?.gone ?? 0,
          remaining: a?.remaining ?? 0,
        }),
      );
    })().catch(() => {});
  }, [revision]);

  if (!text) return null;

  return (
    <Pressable
      onPress={() => router.push("/filed")}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="moon-outline" size={16} color={t.accent} />
      <Text style={[styles.text, { color: t.text }]}>{text}</Text>
      <Text style={[styles.link, { color: t.accent }]}>Voir</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 13.5 },
  link: { fontSize: 13.5, fontWeight: "700" },
});
