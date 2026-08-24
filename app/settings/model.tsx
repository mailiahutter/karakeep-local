import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  deleteModel,
  downloadModel,
  isModelInstalled,
  modelPathFor,
  type ModelDownload,
} from "../../src/ai/download";
import { releaseModel } from "../../src/ai/llm";
import { MODELS, formatBytes, type ModelDescriptor } from "../../src/ai/models";
import { loadSettings, saveSetting } from "../../src/db/settings";
import { Button, Card, ProgressBar, Row, SectionTitle } from "../../src/ui/components";
import { radius, spacing, useTheme } from "../../src/ui/theme";

interface DownloadState {
  modelId: string;
  ratio: number | null;
  written: number;
  total: number;
}

export default function ModelScreen() {
  const t = useTheme();

  const [selectedId, setSelectedId] = useState<string>("");
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [download, setDownload] = useState<DownloadState | null>(null);
  const activeDownload = useRef<ModelDownload | null>(null);

  const refresh = useCallback(async () => {
    const settings = await loadSettings();
    setSelectedId(settings.modelId);
    const state: Record<string, boolean> = {};
    for (const model of MODELS) {
      state[model.id] = await isModelInstalled(model);
    }
    setInstalled(state);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Un téléchargement en cours doit être annulé si l'utilisateur quitte
  // l'écran, sinon il continue sans aucun moyen de l'arrêter.
  useEffect(() => {
    return () => {
      void activeDownload.current?.cancel();
    };
  }, []);

  const start = useCallback(
    async (model: ModelDescriptor) => {
      setDownload({
        modelId: model.id,
        ratio: 0,
        written: 0,
        total: model.bytes,
      });
      const task = downloadModel(model, ({ ratio, written, total }) => {
        setDownload({ modelId: model.id, ratio, written, total });
      });
      activeDownload.current = task;
      try {
        await task.promise;
        await saveSetting("modelPath", modelPathFor(model));
        await saveSetting("modelId", model.id);
        await refresh();
      } catch (err) {
        const message = (err as Error).message;
        if (!message.includes("annulé")) {
          Alert.alert("Téléchargement interrompu", message);
        }
      } finally {
        activeDownload.current = null;
        setDownload(null);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    (model: ModelDescriptor) => {
      Alert.alert(
        "Supprimer le modèle",
        `${model.label} occupe ${formatBytes(model.bytes)}. Le tagging automatique s'arrêtera tant qu'aucun modèle n'est installé.`,
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: () => {
              void (async () => {
                // Le contexte llama.cpp garde le fichier ouvert : le libérer
                // avant d'effacer évite un fichier fantôme.
                await releaseModel();
                await deleteModel(model);
                await refresh();
              })();
            },
          },
        ],
      );
    },
    [refresh],
  );

  const select = useCallback(
    async (model: ModelDescriptor) => {
      await saveSetting("modelId", model.id);
      await saveSetting("modelPath", modelPathFor(model));
      await releaseModel();
      setSelectedId(model.id);
    },
    [],
  );

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.intro, { color: t.textMuted }]}>
        Le modèle tourne entièrement sur ton téléphone : aucune requête n'est
        envoyée à un service externe. Il est téléchargé une fois depuis
        HuggingFace, puis conservé sur l'appareil.
      </Text>

      <SectionTitle>Modèles disponibles</SectionTitle>

      {MODELS.map((model) => {
        const isInstalled = installed[model.id] ?? false;
        const isSelected = selectedId === model.id;
        const busy = download?.modelId === model.id;

        return (
          <Card
            key={model.id}
            style={isSelected ? { borderColor: t.accent } : undefined}
          >
            <Pressable
              onPress={() => void select(model)}
              disabled={busy}
              style={styles.headRow}
            >
              <Ionicons
                name={isSelected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={isSelected ? t.accent : t.textFaint}
              />
              <View style={styles.grow}>
                <Text style={[styles.name, { color: t.text }]}>
                  {model.label}
                </Text>
                <Text style={[styles.meta, { color: t.textFaint }]}>
                  {formatBytes(model.bytes)} · RAM conseillée : {model.ramHint}
                </Text>
              </View>
              {isInstalled && (
                <Ionicons name="checkmark-circle" size={19} color={t.success} />
              )}
            </Pressable>

            <Text style={[styles.notes, { color: t.textMuted }]}>
              {model.notes}
            </Text>

            {busy && download && (
              <View style={styles.progress}>
                <ProgressBar ratio={download.ratio} />
                <Row style={styles.between}>
                  <Text style={[styles.meta, { color: t.textMuted }]}>
                    {formatBytes(download.written)} / {formatBytes(download.total)}
                  </Text>
                  <Text style={[styles.meta, { color: t.textMuted }]}>
                    {download.ratio === null
                      ? ""
                      : `${Math.round(download.ratio * 100)} %`}
                  </Text>
                </Row>
                <Button
                  label="Annuler"
                  variant="ghost"
                  onPress={() => void activeDownload.current?.cancel()}
                />
              </View>
            )}

            {!busy && !isInstalled && (
              <Button
                label={`Télécharger (${formatBytes(model.bytes)})`}
                icon="download-outline"
                variant={isSelected ? "primary" : "secondary"}
                disabled={download !== null}
                onPress={() => void start(model)}
              />
            )}

            {!busy && isInstalled && (
              <Button
                label="Supprimer du téléphone"
                icon="trash-outline"
                variant="danger"
                onPress={() => remove(model)}
              />
            )}
          </Card>
        );
      })}

      <Text style={[styles.footnote, { color: t.textFaint }]}>
        Télécharge de préférence en Wi-Fi. Le modèle reste en mémoire pendant
        quelques minutes après usage, puis est déchargé pour libérer la RAM.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  intro: { fontSize: 13.5, lineHeight: 19, marginBottom: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, gap: 2 },
  between: { justifyContent: "space-between" },
  name: { fontSize: 15.5, fontWeight: "700" },
  meta: { fontSize: 12 },
  notes: { fontSize: 13, lineHeight: 18 },
  progress: { gap: spacing.sm, borderRadius: radius.sm },
  footnote: {
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
