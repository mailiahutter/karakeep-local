import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getBookmark } from "../src/db/bookmarks";
import { listThemes, type Theme } from "../src/db/themes";
import type { Bookmark } from "../src/db/types";
import { hostLabel } from "../src/db/urls";
import {
  acceptSuggestion,
  fileByUser,
  getClassificationDetails,
  listDoubtIds,
  type ClassificationDetails,
} from "../src/db/verify";
import { getDb } from "../src/db/client";
import { DrawerPicker } from "../src/ui/DrawerPicker";
import { EmptyState } from "../src/ui/components";
import { notifyBookmarksChanged } from "../src/ui/events";
import { radius, spacing, useTheme } from "../src/ui/theme";

interface Doubt {
  bookmark: Bookmark;
  details: ClassificationDetails;
}

/**
 * « À vérifier » : les idées sous le seuil de certitude, la plus douteuse
 * d'abord. Un toucher sur la proposition ou sur une alternative range
 * l'idée ; quand aucun tiroir ne convient, l'app propose d'en créer un.
 */
export default function VerifyScreen() {
  const t = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Doubt[] | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ids, th] = await Promise.all([listDoubtIds(50), listThemes()]);
    const out: Doubt[] = [];
    for (const id of ids) {
      const [bookmark, details] = await Promise.all([getBookmark(id), getClassificationDetails(id)]);
      if (bookmark && details) out.push({ bookmark, details });
    }
    setThemes(th);
    setItems(out);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (id: string) => {
    setItems((list) => (list ?? []).filter((d) => d.bookmark.id !== id));
    notifyBookmarksChanged();
  };

  const file = async (id: string, themeId: string, subthemeId: string | null) => {
    await fileByUser(id, themeId, subthemeId);
    done(id);
  };

  const leaveUnsorted = async (id: string) => {
    const db = await getDb();
    await db.runAsync("UPDATE bookmarks SET verified_at = ? WHERE id = ?", [Date.now(), id]);
    done(id);
  };

  const label = (themeId: string | null, subthemeId: string | null) => {
    const theme = themes.find((x) => x.id === themeId);
    if (!theme) return "?";
    const sub = theme.subthemes.find((s) => s.id === subthemeId);
    return sub ? `${theme.icon ?? ""} ${theme.name} › ${sub.name}` : `${theme.icon ?? ""} ${theme.name}`;
  };

  if (items === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.content}>
        {items.length === 0 && (
          <EmptyState
            icon="checkmark-done-outline"
            title="Tout est rangé"
            message="Tes corrections serviront à l'IA pour les prochaines idées qui ressemblent."
          />
        )}
        {items.map(({ bookmark, details }) => {
          const pct = details.confidence !== null ? Math.round(details.confidence * 100) : null;
          const thumb = bookmark.thumbnailPath ?? bookmark.imageUrl;
          return (
            <View key={bookmark.id} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Pressable onPress={() => router.push(`/bookmark/${bookmark.id}`)} style={styles.head}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={[styles.thumb, { backgroundColor: t.surfaceAlt }]} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: t.surfaceAlt }]} />
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.src, { color: t.textFaint }]}>{hostLabel(bookmark.url)}</Text>
                  <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
                    {bookmark.title ?? bookmark.url}
                  </Text>
                  {bookmark.subject && (
                    <Text style={[styles.understood, { color: t.textMuted }]} numberOfLines={3}>
                      L'IA a compris : « {bookmark.subject} »
                    </Text>
                  )}
                </View>
              </Pressable>

              {details.themeId ? (
                <>
                  {pct !== null && (
                    <View style={styles.confRow}>
                      <Text style={[styles.conf, { color: t.textMuted }]}>Sûre à {pct} %</Text>
                      <View style={[styles.bar, { backgroundColor: t.surfaceAlt }]}>
                        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: t.warning, borderRadius: 3 }} />
                      </View>
                    </View>
                  )}
                  <Choice
                    main
                    text={`✓ ${label(details.themeId, details.subthemeId)}`}
                    pct={pct}
                    onPress={() => void file(bookmark.id, details.themeId!, details.subthemeId)}
                  />
                  {details.alternatives.map((a) => (
                    <Choice
                      key={a.id}
                      text={label(a.id, null)}
                      pct={Math.round(a.p * 100)}
                      onPress={() => void file(bookmark.id, a.id, null)}
                    />
                  ))}
                  <Choice ghost text="Un autre tiroir, ou en créer / modifier un…" onPress={() => setPicking(bookmark.id)} />
                </>
              ) : details.suggestion ? (
                <SuggestionBlock
                  suggestion={details.suggestion}
                  onCreate={(s) => void acceptSuggestion(bookmark.id, s).then(() => done(bookmark.id))}
                  onPick={() => setPicking(bookmark.id)}
                  onLeave={() => void leaveUnsorted(bookmark.id)}
                />
              ) : (
                <>
                  <Text style={[styles.conf, { color: t.textMuted }]}>Aucun tiroir ne convient.</Text>
                  <Choice main text="Choisir ou créer un tiroir…" onPress={() => setPicking(bookmark.id)} />
                  <Choice ghost text="Laisser à trier" onPress={() => void leaveUnsorted(bookmark.id)} />
                </>
              )}
            </View>
          );
        })}
      </ScrollView>

      <DrawerPicker
        visible={picking !== null}
        onThemesChanged={() => void listThemes().then(setThemes)}
        onClose={() => setPicking(null)}
        onPick={(themeId, subId) => {
          const id = picking;
          setPicking(null);
          if (id) void file(id, themeId, subId);
        }}
      />
    </View>
  );
}

function Choice({
  text,
  pct,
  main,
  ghost,
  onPress,
}: {
  text: string;
  pct?: number | null;
  main?: boolean;
  ghost?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: main ? t.accent : ghost ? "transparent" : t.surfaceAlt,
          borderColor: ghost ? t.border : "transparent",
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ flex: 1, color: main ? t.accentText : ghost ? t.textMuted : t.text, fontWeight: main ? "700" : "500" }}>
        {text}
      </Text>
      {pct != null && (
        <Text style={{ color: main ? t.accentText : t.textFaint, fontSize: 12.5 }}>{pct} %</Text>
      )}
    </Pressable>
  );
}

function SuggestionBlock({
  suggestion,
  onCreate,
  onPick,
  onLeave,
}: {
  suggestion: { name: string; emoji: string; description: string };
  onCreate: (s: { name: string; emoji: string; description: string }) => void;
  onPick: () => void;
  onLeave: () => void;
}) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(suggestion.name);
  const [emoji, setEmoji] = useState(suggestion.emoji);
  const [description, setDescription] = useState(suggestion.description);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.newTheme, { backgroundColor: t.surfaceAlt }]}>
        {editing ? (
          <>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput
                value={emoji}
                onChangeText={setEmoji}
                style={[styles.input, { width: 52, textAlign: "center", color: t.text, backgroundColor: t.surface }]}
                accessibilityLabel="Emoji du tiroir"
              />
              <TextInput
                value={name}
                onChangeText={setName}
                style={[styles.input, { flex: 1, color: t.text, backgroundColor: t.surface }]}
                accessibilityLabel="Nom du tiroir"
              />
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              style={[styles.input, { color: t.text, backgroundColor: t.surface }]}
              accessibilityLabel="Ce qu'on range dans ce tiroir"
            />
          </>
        ) : (
          <>
            <Text style={{ color: t.text, fontWeight: "700" }}>
              Aucun tiroir ne convient. Créer {emoji} {name} ?
            </Text>
            {!!description && <Text style={{ color: t.textMuted, fontSize: 13 }}>« {description} »</Text>}
          </>
        )}
      </View>
      <Choice
        main
        text="Créer ce tiroir et y ranger l'idée"
        onPress={() => name.trim() && onCreate({ name: name.trim(), emoji: emoji.trim() || "📁", description })}
      />
      {!editing && <Choice text="Modifier le nom, l'emoji ou la description" onPress={() => setEditing(true)} />}
      <Choice text="Choisir un tiroir existant…" onPress={onPick} />
      <Choice ghost text="Laisser à trier" onPress={onLeave} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 60 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: "row", gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
  src: { fontSize: 12 },
  title: { fontSize: 15, fontWeight: "700" },
  understood: { fontSize: 13, fontStyle: "italic" },
  confRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  conf: { fontSize: 12.5 },
  bar: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  newTheme: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
  input: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14.5 },
});
