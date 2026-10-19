import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { getDb } from "../db/client";
import { ACTIVITY_SINCE, recapSentence } from "../db/recap.sql";
import { radius, spacing, useTheme } from "./theme";

const KEY = "recap.lastSeenAt";

/**
 * Bilan de ce que l'application a fait seule depuis la dernière ouverture.
 *
 * L'utilisateur n'ouvre presque jamais l'application : sans ce bilan, rien ne
 * lui dit que la séance de nuit a tourné ni ce qu'elle a produit. Calculé une
 * fois par lancement ; la date de visite est avancée aussitôt, pour que le
 * prochain bilan ne reprenne que la nouveauté.
 */
let computedThisLaunch: string | null | undefined;

async function computeRecap(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [KEY],
  );
  const since = row ? Number(row.value) : 0;
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [KEY, String(Date.now())],
  );
  // Première ouverture après installation : un bilan de toute l'histoire
  // n'aurait pas de sens.
  if (!row) return null;
  const a = await db.getFirstAsync<{
    filed: number | null;
    unfiled: number | null;
    gone: number | null;
    remaining: number | null;
  }>(ACTIVITY_SINCE, [since, since, since]);
  return recapSentence({
    filed: a?.filed ?? 0,
    unfiled: a?.unfiled ?? 0,
    gone: a?.gone ?? 0,
    remaining: a?.remaining ?? 0,
  });
}

export function RecapBanner() {
  const t = useTheme();
  const [text, setText] = useState<string | null>(computedThisLaunch ?? null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (computedThisLaunch !== undefined) return;
    computedThisLaunch = null;
    void computeRecap()
      .then((r) => {
        computedThisLaunch = r;
        setText(r);
      })
      .catch(() => {});
  }, []);

  if (!text || hidden) return null;

  return (
    <Pressable
      onPress={() => setHidden(true)}
      accessibilityRole="button"
      accessibilityHint="Masquer le bilan"
      style={({ pressed }) => [
        styles.bar,
        { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name="moon-outline" size={16} color={t.accent} />
      <Text style={[styles.text, { color: t.text }]}>{text}</Text>
      <Ionicons name="close" size={15} color={t.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 13.5 },
});
