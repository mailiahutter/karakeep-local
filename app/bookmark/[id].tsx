import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
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

  const load = useCallback(async () => {
    if (!id) return;
    const found = await getBookmark(id);
    setBookmark(found);
    setNoteDraft(found?.note ?? "");
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

      {bookmark.description && (
        <Card>
          <Text style={[styles.description, { color: t.textMuted }]}>
            {bookmark.description}
          </Text>
        </Card>
      )}

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
              {bookmark.aiStatus === "skipped"
                ? "Aucun modèle installé — ajoute des tags à la main ou installe un modèle dans les réglages."
                : "Aucun tag pour l'instant."}
            </Text>
          )}
        </View>
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

const styles = StyleSheet.create({
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
