import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  attachExistingDownload,
  CellularBlockedError,
  connectionKind,
  deleteModel,
  downloadModel,
  isModelInstalled,
  modelPathFor,
  partialBytes,
  type ConnectionKind,
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
  resumed: boolean;
}

export default function ModelScreen() {
  const t = useTheme();

  const [selectedId, setSelectedId] = useState<string>("");
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [partials, setPartials] = useState<Record<string, number>>({});
  const [connection, setConnection] = useState<ConnectionKind>("other");
  const activeDownload = useRef<ModelDownload | null>(null);

  const refresh = useCallback(async () => {
    const settings = await loadSettings();
    setSelectedId(settings.modelId);
    const state: Record<string, boolean> = {};
    const partial: Record<string, number> = {};
    for (const model of MODELS) {
      state[model.id] = await isModelInstalled(model);
      // Un transfert interrompu laisse des octets acquis : ils seront repris,
      // pas retéléchargés.
      if (!state[model.id]) partial[model.id] = await partialBytes(model);
    }
    setInstalled(state);
    setPartials(partial);
    setConnection(await connectionKind());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Le gestionnaire système poursuit application fermée : au retour sur
  // l'écran, il faut se rebrancher sur le transfert en cours plutôt que d'en
  // lancer un second.
  useEffect(() => {
    void (async () => {
      for (const model of MODELS) {
        const running = await attachExistingDownload(
          model,
          ({ ratio, written, total }) => {
            setDownload({
              modelId: model.id,
              ratio,
              written,
              total,
              resumed: true,
            });
          },
        );
        if (running) {
          activeDownload.current = running;
          void running.promise
            .then(() => refresh())
            .catch(() => {})
            .finally(() => setDownload(null));
          break;
        }
      }
    })();
  }, [refresh]);

  // Un téléchargement en cours doit être annulé si l'utilisateur quitte
  // l'écran, sinon il continue sans aucun moyen de l'arrêter.
  // Quitter l'écran n'interrompt plus rien : le gestionnaire système poursuit
  // le transfert, application fermée s'il le faut.

  const start = useCallback(
    async (model: ModelDescriptor, allowCellular = false) => {
      setDownload({
        modelId: model.id,
        ratio: 0,
        written: 0,
        total: model.bytes,
        resumed: false,
      });
      const task = await downloadModel(
        model,
        ({ ratio, written, total }) => {
          setDownload({ modelId: model.id, ratio, written, total, resumed: false });
        },
        { allowCellular },
      );
      activeDownload.current = task;
      try {
        await task.promise;
        await saveSetting("modelPath", modelPathFor(model));
        await saveSetting("modelId", model.id);
        await refresh();
      } catch (err) {
        const message = (err as Error).message;
        if (err instanceof CellularBlockedError) {
          Alert.alert("Données mobiles", message, [
            { text: "Annuler", style: "cancel" },
            {
              text: "Télécharger quand même",
              style: "destructive",
              onPress: () => void start(model, true),
            },
          ]);
        } else if (!message.includes("annulé")) {
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

      <Card
        style={{
          borderColor: connection === "cellular" ? t.warning : t.border,
        }}
      >
        <Row>
          <Ionicons
            name={
              connection === "wifi"
                ? "wifi"
                : connection === "cellular"
                  ? "cellular"
                  : "cloud-offline-outline"
            }
            size={18}
            color={connection === "wifi" ? t.success : t.warning}
          />
          <Text style={[styles.notes, { color: t.textMuted, flex: 1 }]}>
            {connection === "wifi"
              ? "Connecté en Wi-Fi : le téléchargement peut se lancer."
              : connection === "cellular"
                ? "Données mobiles. Le téléchargement est bloqué : un modèle représente plusieurs gigaoctets, soit un forfait entier."
                : connection === "none"
                  ? "Aucune connexion réseau."
                  : "Connexion réseau détectée."}
          </Text>
        </Row>
      </Card>

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
                <Row>
                  <Button
                    label="Mettre en pause"
                    icon="pause"
                    variant="secondary"
                    style={{ flex: 1 }}
                    onPress={() => void activeDownload.current?.pause()}
                  />
                  <Button
                    label="Abandonner"
                    variant="ghost"
                    onPress={() => void activeDownload.current?.cancel()}
                  />
                </Row>
              </View>
            )}

            {!busy && !isInstalled && (
              <Button
                label={
                  (partials[model.id] ?? 0) > 0
                    ? `Reprendre (${formatBytes(partials[model.id])} déjà reçus)`
                    : `Télécharger (${formatBytes(model.bytes)})`
                }
                icon={
                  (partials[model.id] ?? 0) > 0
                    ? "play-forward-outline"
                    : "download-outline"
                }
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
        Un transfert interrompu reprend là où il s'était arrêté : rien n'est
        retéléchargé. Le modèle reste en mémoire pendant
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
