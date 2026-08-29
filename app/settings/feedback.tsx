import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { countPendingReviews, reviewCounts, unexportedReviews } from "../../src/db/reviews";
import { tally } from "../../src/feedback/format";
import { NothingToExportError, exportReviews } from "../../src/feedback/share";
import { Button, Card, Row } from "../../src/ui/components";
import { spacing, useTheme } from "../../src/ui/theme";

/**
 * Transmission des retours.
 *
 * Les avis restent sur l'appareil : rien ne part sans une action explicite.
 * L'export produit un fichier Markdown que la feuille de partage d'Android
 * envoie où l'utilisateur veut — courriel, messagerie, notes.
 */
export default function FeedbackScreen() {
  const t = useTheme();
  const router = useRouter();
  const [counts, setCounts] = useState({ total: 0, unexported: 0 });
  const [pending, setPending] = useState(0);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCounts(await reviewCounts());
    setPending(await countPendingReviews());
    setSummary(tally(await unexportedReviews()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = (all: boolean) => {
    setBusy(true);
    void (async () => {
      try {
        const { count } = await exportReviews({ all });
        await load();
        Alert.alert(
          "Retours transmis",
          `${count} avis exporté${count > 1 ? "s" : ""}.`,
        );
      } catch (err) {
        Alert.alert(
          err instanceof NothingToExportError ? "Rien à transmettre" : "Export impossible",
          (err as Error).message,
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <Card>
        <Text style={[styles.intro, { color: t.textMuted }]}>
          Chaque avis dit si le thème, les tags, les images et le résumé
          proposés par le modèle tombaient juste. L'export rassemble ceux qui
          n'ont pas encore été transmis dans un fichier texte, que tu envoies
          où tu veux. Il contient le titre et l'adresse des liens jugés : rien
          ne part sans que tu le déclenches.
        </Text>
      </Card>

      <Card>
        <Row>
          <Ionicons name="albums-outline" size={19} color={t.accent} />
          <Text style={[styles.stat, { color: t.text }]}>
            {counts.unexported} avis à transmettre
          </Text>
        </Row>
        <Text style={[styles.hint, { color: t.textFaint }]}>
          {counts.total} avis donnés au total · {pending} lien
          {pending > 1 ? "s" : ""} encore à relire
        </Text>

        {Object.entries(summary).map(([label, value]) => (
          <Text key={label} style={[styles.hint, { color: t.textMuted }]}>
            {label} : {value}
          </Text>
        ))}
      </Card>

      <Button
        label="Transmettre les nouveaux avis"
        icon="share-outline"
        loading={busy}
        onPress={() => run(false)}
      />

      <Button
        label="Tout réexporter"
        icon="refresh"
        variant="secondary"
        disabled={busy || counts.total === 0}
        onPress={() => run(true)}
      />
      <Text style={[styles.hint, { color: t.textFaint }]}>
        À utiliser si un export précédent s'est perdu : reprend tout
        l'historique, y compris ce qui a déjà été transmis.
      </Text>

      <View style={styles.spacer} />

      <Button
        label={
          pending > 0 ? `Relire ${pending} lien${pending > 1 ? "s" : ""}` : "Relire les liens"
        }
        icon="sparkles-outline"
        variant="secondary"
        onPress={() => router.push("/review")}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  intro: { fontSize: 13.5, lineHeight: 20 },
  stat: { fontSize: 16, fontWeight: "700", flex: 1 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  spacer: { height: spacing.md },
});
