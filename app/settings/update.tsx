import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { formatBytes } from "../../src/ai/models";
import {
  canInstallPackages,
  checkForUpdate,
  currentBuild,
  currentVersion,
  downloadAndInstall,
  openInstallPermissionSettings,
  releasesUrl,
  UpdateError,
  type ReleaseInfo,
  type UpdateCheck,
} from "../../src/update/updater";
import { Button, Card, ProgressBar, Row } from "../../src/ui/components";
import { spacing, useTheme } from "../../src/ui/theme";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "checked"; result: UpdateCheck }
  | { kind: "downloading"; release: ReleaseInfo; ratio: number | null; written: number; total: number }
  | { kind: "installing" }
  | { kind: "error"; message: string; canRetry: boolean };

export default function UpdateScreen() {
  const t = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [needsPermission, setNeedsPermission] = useState(false);

  const check = useCallback(async () => {
    setPhase({ kind: "checking" });
    try {
      const result = await checkForUpdate();
      setPhase({ kind: "checked", result });
    } catch (err) {
      setPhase({
        kind: "error",
        message: (err as Error).message,
        canRetry: !(err instanceof UpdateError && err.kind === "not-found"),
      });
    }
  }, []);

  // La vérification part dès l'ouverture de l'écran : c'est la raison d'y venir.
  useEffect(() => {
    void check();
  }, [check]);

  const install = useCallback(async (release: ReleaseInfo) => {
    // Sans l'autorisation « installer des applications inconnues », l'intent
    // d'installation est rejeté silencieusement : on la vérifie avant de
    // télécharger 60 Mo pour rien.
    if (!(await canInstallPackages())) {
      setNeedsPermission(true);
      return;
    }
    setNeedsPermission(false);
    setPhase({
      kind: "downloading",
      release,
      ratio: 0,
      written: 0,
      total: release.apkSize,
    });
    try {
      await downloadAndInstall(release, ({ ratio, written, total }) => {
        setPhase({ kind: "downloading", release, ratio, written, total });
      });
      setPhase({ kind: "installing" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: (err as Error).message,
        canRetry: true,
      });
    }
  }, []);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <Card>
        <Row style={styles.between}>
          <Text style={[styles.label, { color: t.textMuted }]}>
            Version installée
          </Text>
          <Text style={[styles.version, { color: t.text }]}>
            {currentVersion()} ({currentBuild()})
          </Text>
        </Row>
      </Card>

      {needsPermission && (
        <Card style={{ borderColor: t.warning }}>
          <Row>
            <Ionicons name="shield-outline" size={20} color={t.warning} />
            <Text style={[styles.cardTitle, { color: t.warning }]}>
              Autorisation requise
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            Android demande une autorisation explicite pour qu'une application
            puisse en installer une autre. Active « Autoriser depuis cette
            source » pour Karakeep Local, puis reviens ici.
          </Text>
          <Button
            label="Ouvrir les réglages Android"
            icon="open-outline"
            variant="secondary"
            onPress={() => void openInstallPermissionSettings()}
          />
        </Card>
      )}

      {phase.kind === "checking" && (
        <Card>
          <Row>
            <Ionicons name="sync-outline" size={20} color={t.accent} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Recherche en cours…
            </Text>
          </Row>
          <ProgressBar ratio={null} />
        </Card>
      )}

      {phase.kind === "checked" && phase.result.status === "up-to-date" && (
        <Card>
          <Row>
            <Ionicons name="checkmark-circle" size={22} color={t.success} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Tu es à jour
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            Aucune version plus récente n'est publiée.
          </Text>
          <Button label="Vérifier à nouveau" icon="refresh" variant="secondary" onPress={() => void check()} />
        </Card>
      )}

      {phase.kind === "checked" && phase.result.status === "no-release" && (
        <Card>
          <Row>
            <Ionicons name="information-circle-outline" size={22} color={t.textMuted} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Aucune version publiée
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            Le dépôt ne contient pas encore de release. Une fois qu'une version
            sera publiée, elle apparaîtra ici.
          </Text>
          <Button label="Vérifier à nouveau" icon="refresh" variant="secondary" onPress={() => void check()} />
        </Card>
      )}

      {phase.kind === "checked" && phase.result.status === "no-apk" && (
        <Card>
          <Row>
            <Ionicons name="alert-circle-outline" size={22} color={t.warning} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Version {phase.result.release} disponible
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            Cette version ne publie pas de fichier APK : impossible de
            l'installer automatiquement.
          </Text>
          <Button
            label="Ouvrir la page des versions"
            icon="logo-github"
            variant="secondary"
            onPress={() => void WebBrowser.openBrowserAsync(releasesUrl())}
          />
        </Card>
      )}

      {phase.kind === "checked" && phase.result.status === "available" && (
        <Card style={{ borderColor: t.accent }}>
          <Row>
            <Ionicons name="arrow-up-circle" size={22} color={t.accent} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Version {phase.result.release.version} disponible
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            {formatBytes(phase.result.release.apkSize)}
            {phase.result.release.publishedAt
              ? ` · publiée le ${new Date(phase.result.release.publishedAt).toLocaleDateString("fr-FR")}`
              : ""}
          </Text>
          {phase.result.release.notes.length > 0 && (
            <View style={[styles.notes, { backgroundColor: t.surfaceAlt }]}>
              <Text style={[styles.notesText, { color: t.textMuted }]}>
                {phase.result.release.notes.trim().slice(0, 1200)}
              </Text>
            </View>
          )}
          <Button
            label="Télécharger et installer"
            icon="download-outline"
            onPress={() => {
              if (phase.result.status === "available") {
                void install(phase.result.release);
              }
            }}
          />
        </Card>
      )}

      {phase.kind === "downloading" && (
        <Card>
          <Row>
            <Ionicons name="cloud-download-outline" size={20} color={t.accent} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Téléchargement de {phase.release.version}
            </Text>
          </Row>
          <ProgressBar ratio={phase.ratio} />
          <Text style={[styles.body, { color: t.textMuted }]}>
            {formatBytes(phase.written)}
            {phase.total > 0 ? ` sur ${formatBytes(phase.total)}` : ""}
          </Text>
        </Card>
      )}

      {phase.kind === "installing" && (
        <Card>
          <Row>
            <Ionicons name="phone-portrait-outline" size={20} color={t.success} />
            <Text style={[styles.cardTitle, { color: t.text }]}>
              Installation lancée
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            Android a pris le relais : confirme l'installation dans la fenêtre
            système. Tes données restent en place, la mise à jour se fait par
            dessus.
          </Text>
        </Card>
      )}

      {phase.kind === "error" && (
        <Card style={{ borderColor: t.danger }}>
          <Row>
            <Ionicons name="close-circle-outline" size={22} color={t.danger} />
            <Text style={[styles.cardTitle, { color: t.danger }]}>
              Échec
            </Text>
          </Row>
          <Text style={[styles.body, { color: t.textMuted }]}>
            {phase.message}
          </Text>
          {phase.canRetry && (
            <Button label="Réessayer" icon="refresh" variant="secondary" onPress={() => void check()} />
          )}
        </Card>
      )}

      <Text style={[styles.footnote, { color: t.textFaint }]}>
        Les mises à jour proviennent des releases publiées sur le dépôt GitHub du
        projet. L'application ne transmet aucune donnée : elle lit la liste des
        versions et télécharge le fichier APK, rien d'autre.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  between: { justifyContent: "space-between" },
  label: { fontSize: 14 },
  version: { fontSize: 15, fontWeight: "700" },
  cardTitle: { fontSize: 16, fontWeight: "700", flex: 1 },
  body: { fontSize: 13.5, lineHeight: 19 },
  notes: { borderRadius: 8, padding: spacing.md, maxHeight: 220 },
  notesText: { fontSize: 12.5, lineHeight: 18 },
  footnote: {
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
