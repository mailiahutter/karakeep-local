import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  deleteBookmark,
  getBookmark,
  setArchived,
  setFavourite,
  setNote,
} from "../../src/db/bookmarks";
import { listAssets, type Asset } from "../../src/db/assets";
import { AssetViewer } from "../../src/ui/AssetViewer";
import { attachTags, detachTag } from "../../src/db/tags";
import type { Bookmark } from "../../src/db/types";
import { hostLabel } from "../../src/db/urls";
import { retryBookmark } from "../../src/pipeline/queue";
import { Button, Card, Chip, Row } from "../../src/ui/components";
import { notifyBookmarksChanged } from "../../src/ui/events";
import { radius, spacing, useTheme } from "../../src/ui/theme";

export default function BookmarkScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const found = await getBookmark(id);
    setBookmark(found);
    setNoteDraft(found?.note ?? "");
    setAssets(found ? await listAssets(found.id) : []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (fn: () => Promise<void>) => {
      await fn();
      notifyBookmarksChanged();
      await load();
    },
    [load],
  );

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  if (!bookmark) {
    return (
      <View style={[styles.missing, { backgroundColor: t.bg }]}>
        <Ionicons name="help-circle-outline" size={40} color={t.textFaint} />
        <Text style={{ color: t.textMuted }}>Ce favori n'existe plus.</Text>
      </View>
    );
  }

  const host = hostLabel(bookmark.url);
  const failed =
    bookmark.fetchStatus === "error" || bookmark.aiStatus === "error";
  // 'skipped' n'est pas une erreur mais reste un non-traitement : le taire
  // laissait l'utilisateur devant une fiche sans tags et sans explication.
  const aiIncomplete =
    bookmark.aiStatus === "skipped" ||
    bookmark.aiStatus === "pending" ||
    bookmark.aiStatus === "running";

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
    >
      {bookmark.imageUrl && (
        <Image
          source={{ uri: bookmark.imageUrl }}
          style={[styles.hero, { backgroundColor: t.surfaceAlt }]}
          resizeMode="cover"
        />
      )}

      <Text style={[styles.title, { color: t.text }]}>
        {bookmark.title ?? bookmark.url}
      </Text>

      <Text style={[styles.source, { color: t.textFaint }]}>
        {host ?? bookmark.url}
        {bookmark.author ? ` · ${bookmark.author}` : ""}
      </Text>

      <Row style={styles.actions}>
        <Button
          label="Ouvrir"
          icon="open-outline"
          onPress={() => void WebBrowser.openBrowserAsync(bookmark.url)}
          style={styles.grow}
        />
        <Button
          label={bookmark.favourited ? "Favori" : "Marquer"}
          icon={bookmark.favourited ? "star" : "star-outline"}
          variant="secondary"
          onPress={() =>
            void mutate(() => setFavourite(bookmark.id, !bookmark.favourited))
          }
          style={styles.grow}
        />
      </Row>

      {bookmark.summary && (
        <Card style={{ borderColor: t.accent }}>
          <Row>
            <Ionicons name="sparkles" size={16} color={t.accent} />
            <Text style={[styles.sectionLabel, { color: t.accent }]}>
              Résumé
            </Text>
          </Row>
          <Text style={[styles.description, { color: t.text }]}>
            {bookmark.summary}
          </Text>
        </Card>
      )}

      {bookmark.description && (
        <Card>
          <Text style={[styles.description, { color: t.textMuted }]}>
            {bookmark.description}
          </Text>
        </Card>
      )}

      {assets.length > 0 && <AssetsCard assets={assets} />}

      <Card>
        <Text style={[styles.sectionLabel, { color: t.textMuted }]}>Tags</Text>
        <View style={styles.tags}>
          {bookmark.tags.map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              tone={tag.source === "ai" ? "ai" : "neutral"}
              onRemove={() =>
                void mutate(() => detachTag(bookmark.id, tag.id))
              }
            />
          ))}
          {bookmark.tags.length === 0 && (
            <Text style={[styles.hint, { color: t.textFaint }]}>
              Aucun tag pour l'instant.
            </Text>
          )}
        </View>
        {aiIncomplete && (
          <Row>
            <Ionicons
              name={
                bookmark.aiStatus === "skipped"
                  ? "alert-circle-outline"
                  : "hourglass-outline"
              }
              size={15}
              color={bookmark.aiStatus === "skipped" ? t.warning : t.textFaint}
            />
            <Text
              style={[
                styles.hint,
                {
                  flex: 1,
                  color:
                    bookmark.aiStatus === "skipped" ? t.warning : t.textFaint,
                },
              ]}
            >
              {bookmark.aiStatus === "skipped"
                ? `Tagging non effectué : ${bookmark.aiError ?? "raison inconnue"}. Vérifie Réglages → Modèle IA.`
                : "Tags en cours de génération…"}
            </Text>
          </Row>
        )}

        <TextInput
          value={tagDraft}
          onChangeText={setTagDraft}
          placeholder="Ajouter un tag puis valider"
          placeholderTextColor={t.textFaint}
          style={[
            styles.input,
            { color: t.text, backgroundColor: t.surfaceAlt },
          ]}
          returnKeyType="done"
          onSubmitEditing={() => {
            const value = tagDraft.trim();
            if (!value) return;
            setTagDraft("");
            void mutate(() => attachTags(bookmark.id, [value], "human"));
          }}
        />
      </Card>

      <Card>
        <Text style={[styles.sectionLabel, { color: t.textMuted }]}>Note</Text>
        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          onBlur={() => {
            if (noteDraft !== (bookmark.note ?? "")) {
              void mutate(() => setNote(bookmark.id, noteDraft));
            }
          }}
          placeholder="Pourquoi ce lien t'intéresse…"
          placeholderTextColor={t.textFaint}
          multiline
          style={[
            styles.input,
            styles.noteInput,
            { color: t.text, backgroundColor: t.surfaceAlt },
          ]}
        />
      </Card>

      {failed && (
        <Card style={{ borderColor: t.warning }}>
          <Row>
            <Ionicons name="alert-circle-outline" size={19} color={t.warning} />
            <Text style={[styles.sectionLabel, { color: t.warning, flex: 1 }]}>
              Traitement incomplet
            </Text>
          </Row>
          <Text style={[styles.hint, { color: t.textMuted }]}>
            {bookmark.fetchError ?? bookmark.aiError}
          </Text>
          <Button
            label="Relancer"
            icon="refresh"
            variant="secondary"
            loading={retrying}
            onPress={() => {
              setRetrying(true);
              void (async () => {
                try {
                  await retryBookmark(bookmark.id);
                  notifyBookmarksChanged();
                  await load();
                } finally {
                  setRetrying(false);
                }
              })();
            }}
          />
        </Card>
      )}

      {bookmark.content && (
        <Card>
          <Text style={[styles.sectionLabel, { color: t.textMuted }]}>
            Contenu extrait
          </Text>
          <Text style={[styles.body, { color: t.text }]}>
            {bookmark.content}
          </Text>
        </Card>
      )}

      <Row style={styles.actions}>
        <Button
          label={bookmark.archived ? "Désarchiver" : "Archiver"}
          icon="archive-outline"
          variant="secondary"
          style={styles.grow}
          onPress={() =>
            void mutate(() => setArchived(bookmark.id, !bookmark.archived))
          }
        />
        <Button
          label="Supprimer"
          icon="trash-outline"
          variant="danger"
          style={styles.grow}
          onPress={() =>
            Alert.alert(
              "Supprimer ce favori",
              "Cette action est définitive.",
              [
                { text: "Annuler", style: "cancel" },
                {
                  text: "Supprimer",
                  style: "destructive",
                  onPress: () => {
                    void (async () => {
                      await deleteBookmark(bookmark.id);
                      notifyBookmarksChanged();
                      router.back();
                    })();
                  },
                },
              ],
            )
          }
        />
      </Row>
    </ScrollView>
  );
}

const ASSET_LABEL: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  screenshot: { icon: "image-outline", label: "Capture d'écran" },
  archive: { icon: "document-text-outline", label: "Page archivée" },
  pdf: { icon: "document-outline", label: "PDF" },
  image: { icon: "images-outline", label: "Image" },
  video: { icon: "videocam-outline", label: "Vidéo" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

/**
 * Ce qui a été conservé sur l'appareil. C'est cette liste qui garantit que le
 * contenu survit à la disparition du site.
 */
function AssetsCard({ assets }: { assets: Asset[] }) {
  const t = useTheme();
  const [viewing, setViewing] = useState<number | null>(null);

  // Les vignettes ne montrent que ce qui a un rendu visuel ; la liste
  // dessous donne accès à tout, archive comprise.
  const previewable = assets.filter(
    (a) => a.kind === "image" || a.kind === "screenshot" || a.kind === "video",
  );

  return (
    <Card>
      <Text style={[styles.sectionLabel, { color: t.textMuted }]}>
        Conservé sur l'appareil
      </Text>

      {previewable.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.thumbRow}>
            {previewable.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setViewing(assets.indexOf(a))}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Ouvrir ${ASSET_LABEL[a.kind]?.label ?? a.kind}`}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <Image
                  source={{ uri: a.path }}
                  style={[styles.thumb, { backgroundColor: t.surfaceAlt }]}
                  resizeMode="cover"
                />
                {a.kind === "video" && (
                  // Une vignette de vidéo est indistinguable d'une image : le
                  // pictogramme dit qu'il y a quelque chose à lire.
                  <View style={styles.playBadge}>
                    <Ionicons name="play" size={20} color="#FFFFFF" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {assets.map((a) => {
        const meta = ASSET_LABEL[a.kind] ?? {
          icon: "cube-outline" as const,
          label: a.kind,
        };
        return (
          <Pressable
            key={a.id}
            onPress={() => setViewing(assets.indexOf(a))}
            style={({ pressed }) => [styles.assetRow, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <Ionicons name={meta.icon} size={16} color={t.textMuted} />
            <Text style={[styles.hint, { color: t.text, flex: 1 }]}>
              {meta.label}
            </Text>
            <Text style={[styles.hint, { color: t.textFaint }]}>
              {formatSize(a.bytes)}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={t.textFaint} />
          </Pressable>
        );
      })}

      {viewing !== null && (
        <AssetViewer
          assets={assets}
          startIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  thumbRow: { flexDirection: "row", gap: spacing.sm },
  thumb: { width: 120, height: 90, borderRadius: radius.md },
  playBadge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: radius.md,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
  },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  hero: { width: "100%", height: 180, borderRadius: radius.lg },
  title: { fontSize: 21, fontWeight: "800", lineHeight: 28 },
  source: { fontSize: 13 },
  actions: { gap: spacing.md },
  grow: { flex: 1 },
  description: { fontSize: 14.5, lineHeight: 21 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  hint: { fontSize: 13, lineHeight: 18 },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 14.5,
  },
  noteInput: { minHeight: 80, textAlignVertical: "top" },
  body: { fontSize: 14.5, lineHeight: 22 },
});
