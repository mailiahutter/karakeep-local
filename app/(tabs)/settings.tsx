import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { isModelInstalled } from "../../src/ai/download";
import { findModel, formatBytes } from "../../src/ai/models";
import { countBookmarks } from "../../src/db/bookmarks";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSetting,
  type Settings,
} from "../../src/db/settings";
import { listTags } from "../../src/db/tags";
import { Card, Row, SectionTitle } from "../../src/ui/components";
import { currentBuild, currentVersion, releasesUrl } from "../../src/update/updater";
import { spacing, useTheme } from "../../src/ui/theme";

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [modelReady, setModelReady] = useState(false);
  const [stats, setStats] = useState({ total: 0, archived: 0, tags: 0 });

  const refresh = useCallback(async () => {
    const s = await loadSettings();
    setSettings(s);

    const model = findModel(s.modelId);
    setModelReady(model ? await isModelInstalled(model) : false);

    const counts = await countBookmarks();
    const tags = await listTags();
    setStats({
      total: counts.total,
      archived: counts.archived,
      tags: tags.length,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const update = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      // Optimiste : l'interrupteur ne doit pas attendre l'écriture SQLite.
      setSettings((prev) => ({ ...prev, [key]: value }));
      await saveSetting(key, value);
    },
    [],
  );

  const model = findModel(settings.modelId);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <View>
        <SectionTitle>Intelligence artificielle</SectionTitle>
        <Card>
          <Row style={styles.between}>
            <View style={styles.grow}>
              <Text style={[styles.label, { color: t.text }]}>
                Modèle de tagging
              </Text>
              <Text style={[styles.hint, { color: t.textMuted }]}>
                {model
                  ? `${model.label} · ${formatBytes(model.bytes)}`
                  : "Aucun modèle sélectionné"}
              </Text>
            </View>
            <Row>
              <Ionicons
                name={modelReady ? "checkmark-circle" : "alert-circle-outline"}
                size={18}
                color={modelReady ? t.success : t.warning}
              />
              <Text
                style={[
                  styles.badge,
                  { color: modelReady ? t.success : t.warning },
                ]}
              >
                {modelReady ? "Installé" : "Absent"}
              </Text>
            </Row>
          </Row>

          <NavRow
            icon="cube-outline"
            label="Gérer le modèle"
            onPress={() => router.push("/settings/model")}
          />

          <NavRow
            icon="albums-outline"
            label="Thèmes et sous-thèmes"
            hint="Les tiroirs où le modèle range les liens, et la consigne qu'il lit pour décider."
            onPress={() => router.push("/settings/themes")}
          />

          <NavRow
            icon="logo-instagram"
            label="Compte Instagram"
            hint="Sans session, Instagram masque légendes et carrousels."
            onPress={() => router.push("/settings/instagram")}
          />

          <ToggleRow
            label="Tagger automatiquement"
            hint="Génère des tags après chaque enregistrement."
            value={settings.autoTag}
            onChange={(v) => void update("autoTag", v)}
          />
          <ToggleRow
            label="Lire le contenu des pages"
            hint="Télécharge et extrait le texte pour la recherche plein texte."
            value={settings.autoFetch}
            onChange={(v) => void update("autoFetch", v)}
          />
        </Card>
      </View>

      <View>
        <SectionTitle>Bibliothèque</SectionTitle>
        <Card>
          <Row style={styles.between}>
            <Text style={[styles.label, { color: t.text }]}>Liens</Text>
            <Text style={[styles.value, { color: t.textMuted }]}>
              {stats.total}
            </Text>
          </Row>
          <Row style={styles.between}>
            <Text style={[styles.label, { color: t.text }]}>Archivés</Text>
            <Text style={[styles.value, { color: t.textMuted }]}>
              {stats.archived}
            </Text>
          </Row>
          <Row style={styles.between}>
            <Text style={[styles.label, { color: t.text }]}>Tags</Text>
            <Text style={[styles.value, { color: t.textMuted }]}>
              {stats.tags}
            </Text>
          </Row>
          <Text style={[styles.hint, { color: t.textFaint }]}>
            Toutes les données sont stockées sur cet appareil. Aucun serveur,
            aucun compte, aucune synchronisation.
          </Text>
        </Card>
      </View>

      <View>
        <SectionTitle>Application</SectionTitle>
        <Card>
          <Row style={styles.between}>
            <Text style={[styles.label, { color: t.text }]}>Version</Text>
            <Text style={[styles.value, { color: t.textMuted }]}>
              {currentVersion()} ({currentBuild()})
            </Text>
          </Row>

          <NavRow
            icon="cloud-download-outline"
            label="Rechercher une mise à jour"
            hint="Interroge les nouvelles versions publiées sur GitHub."
            onPress={() => router.push("/settings/update")}
            highlight
          />

          <NavRow
            icon="logo-github"
            label="Voir les versions publiées"
            onPress={() => void WebBrowser.openBrowserAsync(releasesUrl())}
          />
        </Card>
        <Text style={[styles.footer, { color: t.textFaint }]}>
          Karakeep Local — dérivé de karakeep-app/karakeep, sous licence
          AGPL-3.0.
        </Text>
      </View>
    </ScrollView>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Row style={styles.between}>
      <View style={styles.grow}>
        <Text style={[styles.label, { color: t.text }]}>{label}</Text>
        <Text style={[styles.hint, { color: t.textMuted }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent, false: t.border }}
      />
    </Row>
  );
}

function NavRow({
  icon,
  label,
  hint,
  onPress,
  highlight = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  highlight?: boolean;
}) {
  const t = useTheme();
  const color = highlight ? t.accent : t.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.navRow,
        { borderTopColor: t.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={icon} size={19} color={color} />
      <View style={styles.grow}>
        <Text
          style={[styles.label, { color, fontWeight: highlight ? "700" : "600" }]}
        >
          {label}
        </Text>
        {hint && (
          <Text style={[styles.hint, { color: t.textMuted }]}>{hint}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={17} color={t.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  between: { justifyContent: "space-between" },
  grow: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12.5, lineHeight: 17 },
  value: { fontSize: 14, fontWeight: "600" },
  badge: { fontSize: 12, fontWeight: "700" },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    fontSize: 11.5,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 16,
  },
});
