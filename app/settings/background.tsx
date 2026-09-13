import { Ionicons } from "@expo/vector-icons";
import * as BackgroundTask from "expo-background-task";
import * as IntentLauncher from "expo-intent-launcher";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { countPendingWork } from "../../src/db/bookmarks";
import { AI_QUEUE_TASK, registerAiBackgroundTask } from "../../src/pipeline/background";
import { readBackgroundLog, type BackgroundRun } from "../../src/pipeline/heartbeat";
import { Button, Card, Row, SectionTitle } from "../../src/ui/components";
import { spacing, useTheme } from "../../src/ui/theme";

/**
 * État du traitement d'arrière-plan.
 *
 * Un utilisateur qui n'ouvre jamais l'application n'a aucun moyen de savoir si
 * elle travaille. Et sans journal, « le système ne réveille pas » et « le
 * réveil a lieu mais ne trouve rien » se ressemblent — alors que le premier se
 * corrige dans les réglages batterie d'Android et le second pas du tout.
 */
export default function BackgroundScreen() {
  const t = useTheme();
  const [log, setLog] = useState<BackgroundRun[]>([]);
  const [pending, setPending] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLog(await readBackgroundLog());
    setPending(await countPendingWork());
    try {
      const status = await BackgroundTask.getStatusAsync();
      setAvailable(status === BackgroundTask.BackgroundTaskStatus.Available);
    } catch {
      setAvailable(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const last = log[0];
  // Android n'accorde pas ces réveils à la minute près : au-delà d'une demi-
  // journée sans aucun, c'est le gestionnaire de batterie qui bloque.
  const stale = !last || Date.now() - last.at > 12 * 3_600_000;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <Card>
        <Text style={[styles.intro, { color: t.textMuted }]}>
          Android réveille l'application à intervalles qu'il choisit lui-même,
          au minimum toutes les quinze minutes. Chaque réveil lit les pages en
          attente et les fait analyser par le modèle. C'est lent, mais ça
          avance sans que tu aies à ouvrir l'application.
        </Text>
      </Card>

      <Card style={stale ? { borderColor: t.warning } : undefined}>
        <Row>
          <Ionicons
            name={stale ? "warning-outline" : "checkmark-circle-outline"}
            size={19}
            color={stale ? t.warning : t.success}
          />
          <Text style={[styles.stat, { color: stale ? t.warning : t.text }]}>
            {last
              ? `Dernier réveil ${relative(last.at)}`
              : "Aucun réveil enregistré"}
          </Text>
        </Row>
        <Text style={[styles.hint, { color: t.textMuted }]}>
          {pending} lien{pending > 1 ? "s" : ""} en attente de traitement
          {available === false
            ? " · le système refuse le travail d'arrière-plan"
            : ""}
        </Text>
        {stale && (
          <Text style={[styles.hint, { color: t.textMuted }]}>
            Si rien ne bouge, c'est presque toujours le gestionnaire de
            batterie du téléphone qui gèle l'application. Mets Karakeep Local
            en « non restreint » ci-dessous.
          </Text>
        )}
      </Card>

      <Button
        label="Ouvrir les réglages de batterie"
        icon="battery-charging-outline"
        variant="secondary"
        onPress={() => {
          void IntentLauncher.startActivityAsync(
            "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
          ).catch(() =>
            Alert.alert(
              "Réglage introuvable",
              "Ouvre Paramètres → Applications → Karakeep Local → Batterie, et choisis « Non restreint ».",
            ),
          );
        }}
      />

      <Button
        label="Réenregistrer la tâche"
        icon="refresh"
        variant="secondary"
        onPress={() => {
          void (async () => {
            const ok = await registerAiBackgroundTask();
            await load();
            Alert.alert(
              ok ? "Tâche enregistrée" : "Enregistrement refusé",
              ok
                ? `La tâche « ${AI_QUEUE_TASK} » est déclarée auprès du système.`
                : "Le système n'accorde pas de travail d'arrière-plan à cette application.",
            );
          })();
        }}
      />

      {log.length > 0 && (
        <>
          <SectionTitle>Derniers réveils</SectionTitle>
          {log.map((run) => (
            <View key={run.at} style={styles.run}>
              <Text style={[styles.runTime, { color: t.textFaint }]}>
                {new Date(run.at).toLocaleString("fr-FR")}
              </Text>
              <Text style={[styles.hint, { color: t.textMuted }]}>
                {run.outcome}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function relative(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  intro: { fontSize: 13.5, lineHeight: 20 },
  stat: { fontSize: 15.5, fontWeight: "700", flex: 1 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  run: { paddingHorizontal: spacing.lg },
  runTime: { fontSize: 11.5, fontWeight: "600" },
});
