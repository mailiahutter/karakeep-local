import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { countPendingReviews } from "../db/reviews";
import { loadSettings } from "../db/settings";
import { useBookmarksRevision } from "./events";
import { radius, spacing, useTheme } from "./theme";

/**
 * Invitation à relire ce que le modèle a proposé.
 *
 * Ouvre la relecture une fois par lancement, comme demandé : c'est au moment
 * où l'on rouvre l'application que l'on se souvient de ce qui clochait. Le
 * drapeau vit au niveau du module, pas du composant — revenir sur l'onglet
 * d'accueil ne doit pas rouvrir l'écran une seconde fois.
 */
let promptedThisLaunch = false;

export function ReviewBanner() {
  const t = useTheme();
  const router = useRouter();
  const revision = useBookmarksRevision();
  const { hasShareIntent } = useShareIntentContext();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void countPendingReviews().then(setPending);
  }, [revision]);

  useEffect(() => {
    // Un lien vient d'être partagé : l'utilisateur attend de le voir arriver,
    // pas de se faire interroger sur les précédents.
    if (hasShareIntent || promptedThisLaunch) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const settings = await loadSettings();
        if (cancelled || !settings.reviewOnLaunch) return;
        if ((await countPendingReviews()) === 0) return;
        promptedThisLaunch = true;
        router.push("/review");
      })();
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasShareIntent, router]);

  if (pending === 0) return null;

  return (
    <Pressable
      onPress={() => router.push("/review")}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.bar,
        {
          backgroundColor: t.surface,
          borderColor: t.accent,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="sparkles-outline" size={16} color={t.accent} />
      <Text style={[styles.text, { color: t.text }]}>
        {pending} lien{pending > 1 ? "s" : ""} à relire — le rangement était-il
        bon ?
      </Text>
      <Ionicons name="chevron-forward" size={15} color={t.accent} />
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
