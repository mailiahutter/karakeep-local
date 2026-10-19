import { Ionicons } from "@expo/vector-icons";
import * as BackgroundTask from "expo-background-task";
import * as IntentLauncher from "expo-intent-launcher";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { countPendingWork, requeueUnfinished } from "../../src/db/bookmarks";
import { processPending } from "../../src/pipeline/queue";
import { notifyBookmarksChanged } from "../../src/ui/events";
import { loadSettings, saveSetting } from "../../src/db/settings";
import {
  cancelDailyWork,
  isWorkerAvailable,
  isWorkerRunning,
  scheduleDailyWork,
  startWorker,
  stopWorker,
  workerDiagnostics,
  type WorkerDiagnostics,
} from "../../modules/karakeep-worker/src";
import {
  formatWindow,
  nextOccurrence,
  parseWindow,
  untilLabel,
} from "../../src/pipeline/schedule";
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
  const [working, setWorking] = useState(false);
  const [windowText, setWindowText] = useState("");
  const [diag, setDiag] = useState<WorkerDiagnostics | null>(null);

  const load = useCallback(async () => {
    setLog(await readBackgroundLog());
    setPending(await countPendingWork());
    setWorking(isWorkerRunning());
    setDiag(workerDiagnostics());
    setWindowText((await loadSettings()).nightlyWork);
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
          Une séance de travail traite les liens en attente sans que
          l'application soit ouverte : elle tient le processeur éveillé, écran
          éteint, et s'arrête quand il n'y a plus rien à faire. Une
          notification permanente l'accompagne — c'est ce qu'Android exige
          pour autoriser ce travail, et c'est aussi comment tu l'arrêtes.
        </Text>
      </Card>

      <Card style={working ? { borderColor: t.success } : undefined}>
        <Row>
          <Ionicons
            name={working ? "sync" : "moon-outline"}
            size={19}
            color={working ? t.success : t.accent}
          />
          <Text style={[styles.stat, { color: t.text }]}>
            {working ? "Séance en cours" : "Séance à la demande"}
          </Text>
        </Row>
        <Text style={[styles.hint, { color: t.textMuted }]}>
          {pending} lien{pending > 1 ? "s" : ""} en attente. Lance une séance
          maintenant, pose le téléphone, et reviens plus tard.
        </Text>
        <Button
          label={working ? "Arrêter la séance" : "Travailler maintenant"}
          icon={working ? "stop-circle-outline" : "play"}
          variant={working ? "secondary" : "primary"}
          onPress={() => {
            if (working) {
              stopWorker();
              setWorking(false);
              return;
            }
            if (!startWorker()) {
              Alert.alert(
                "Service indisponible",
                "Cette version de l'application n'embarque pas le service de travail. Installe la dernière version.",
              );
              return;
            }
            setWorking(true);
          }}
        />
      </Card>

      <Card>
        <Row>
          <Ionicons name="refresh-circle-outline" size={19} color={t.accent} />
          <Text style={[styles.stat, { color: t.text }]}>Tout relancer</Text>
        </Row>
        <Text style={[styles.hint, { color: t.textMuted }]}>
          Remet en file chaque lien resté en plan : page jamais lue ou en
          erreur, fiche vide, analyse sautée, rangement ou résumé manquant. Ce
          que tu as rangé à la main reste à sa place.
        </Text>
        <Button
          label="Tout relancer"
          icon="refresh"
          variant="secondary"
          onPress={() => {
            void (async () => {
              const n = await requeueUnfinished();
              setPending(n);
              notifyBookmarksChanged();
              void processPending().then(notifyBookmarksChanged);
              Alert.alert(
                "Relance faite",
                n === 0
                  ? "Tout est déjà traité."
                  : `${n} lien${n > 1 ? "s" : ""} en attente. Ils avancent dès qu'une séance tourne — de nuit, ou avec « Travailler maintenant ».`,
              );
            })();
          }}
        />
      </Card>

      <Card>
        <Row>
          <Ionicons name="alarm-outline" size={19} color={t.accent} />
          <Text style={[styles.stat, { color: t.text }]}>Séance de nuit</Text>
        </Row>
        <Text style={[styles.hint, { color: t.textMuted }]}>
          À l'heure indiquée, chaque nuit, l'application se met au travail
          seule. Le mode avion ne la gêne pas : l'analyse par le modèle est
          entièrement locale — seule la lecture des pages neuves demande du
          réseau.
        </Text>
        <Row>
          <TextInput
            value={windowText}
            onChangeText={setWindowText}
            placeholder="03:00"
            placeholderTextColor={t.textFaint}
            keyboardType="numbers-and-punctuation"
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.surface },
            ]}
          />
          <Button
            label="Programmer"
            icon="checkmark"
            style={styles.grow}
            onPress={() => {
              const parsed = parseWindow(windowText);
              if (!parsed) {
                Alert.alert(
                  "Heure illisible",
                  "Écris l'heure sous la forme 03:00.",
                );
                return;
              }
              void (async () => {
                const at = scheduleDailyWork(parsed.hour, parsed.minute);
                await saveSetting("nightlyWork", formatWindow(parsed));
                await load();
                Alert.alert(
                  "Séance programmée",
                  `Prochaine séance ${untilLabel(at ?? nextOccurrence(parsed))}.`,
                );
              })();
            }}
          />
        </Row>
        <Button
          label="Supprimer la séance de nuit"
          variant="ghost"
          onPress={() => {
            cancelDailyWork();
            void saveSetting("nightlyWork", "").then(load);
          }}
        />
        {!isWorkerAvailable() && (
          <Text style={[styles.hint, { color: t.warning }]}>
            Le service n'est pas présent dans cette version de l'application.
          </Text>
        )}

        {/* Android peut refuser le démarrage de deux façons, toutes deux
            silencieuses. Les taire, c'est reproduire exactement le problème
            qu'on vient de passer des semaines à chercher. */}
        {diag && !diag.canScheduleExact && (
          <Text style={[styles.hint, { color: t.warning }]}>
            Android interdit les alarmes exactes à cette application. Sans
            elles, il refusera de démarrer la séance de nuit. Autorise
            « Alarmes et rappels » dans les réglages de l'application.
          </Text>
        )}
        {diag && !diag.ignoringBatteryOptimizations && (
          <Text style={[styles.hint, { color: t.warning }]}>
            L'application est soumise à l'optimisation de batterie. C'est la
            cause la plus fréquente d'une séance qui ne démarre jamais : passe
            par le bouton ci-dessous.
          </Text>
        )}
        {diag?.lastAlarmResult && diag.lastAlarmResult !== "ok" && (
          <Text style={[styles.hint, { color: t.warning }]}>
            Dernier déclenchement refusé par le système :{" "}
            {diag.lastAlarmResult}
          </Text>
        )}
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
  grow: { flex: 1 },
  input: {
    width: 96,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    textAlign: "center",
  },
  run: { paddingHorizontal: spacing.lg },
  runTime: { fontSize: 11.5, fontWeight: "600" },
});
