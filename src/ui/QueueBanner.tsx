import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { countPendingWork } from "../db/bookmarks";
import { processPending, subscribe } from "../pipeline/queue";
import { notifyBookmarksChanged, useBookmarksRevision } from "./events";
import { radius, spacing, useTheme } from "./theme";

/**
 * Bandeau d'activité de la file.
 *
 * Sans lui, un favori affichant « en cours de génération » ne dit pas s'il
 * reste des heures en attente ou s'il est réellement en train d'être analysé.
 * L'utilisateur n'avait aucun moyen de faire la différence, ni de relancer.
 */
/** Ce que le modèle est en train de produire. */
const STEP_LABEL = {
  classify: "Rangement par thème",
  tags: "Génération des tags",
  summary: "Rédaction du résumé",
} as const;

export function QueueBanner() {
  const t = useTheme();
  const revision = useBookmarksRevision();
  const [label, setLabel] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [kicking, setKicking] = useState(false);

  useEffect(() => {
    void countPendingWork().then(setWaiting);
  }, [revision, label]);

  useEffect(
    () =>
      subscribe((event) => {
        switch (event.type) {
          case "fetching":
            setLabel("Extraction de la page…");
            break;
          case "tagging":
            setLabel("Analyse par le modèle…");
            break;
          case "loading-model":
            // « 100 % » restait affiché pendant toute l'inférence qui suit :
            // le chargement était fini, et l'écran laissait croire qu'il
            // durait des heures.
            setLabel(
              event.percent >= 100
                ? "Modèle chargé, analyse en cours…"
                : `Chargement du modèle ${Math.round(event.percent)} %`,
            );
            break;
          case "generating":
            setLabel(`${STEP_LABEL[event.step]} — ${event.tokens} jetons`);
            break;
          case "idle":
            setLabel(null);
            break;
        }
      }),
    [],
  );

  const busy = label !== null;
  if (!busy && waiting === 0) return null;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: t.surface, borderColor: t.border },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.accent} />
      ) : (
        <Ionicons name="hourglass-outline" size={16} color={t.textFaint} />
      )}
      <Text style={[styles.text, { color: busy ? t.text : t.textMuted }]}>
        {busy
          ? label
          : `${waiting} lien${waiting > 1 ? "s" : ""} en attente de traitement`}
      </Text>
      {!busy && (
        <Pressable
          disabled={kicking}
          onPress={() => {
            setKicking(true);
            void processPending()
              .then(notifyBookmarksChanged)
              .finally(() => setKicking(false));
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.action, { color: t.accent }]}>Relancer</Text>
        </Pressable>
      )}
    </View>
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
  action: { fontSize: 13.5, fontWeight: "700" },
});
