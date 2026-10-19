import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { passageKey, splitParagraphs } from "../archive/paragraphs";
import {
  listHighlights,
  setHighlightNote,
  toggleHighlight,
  type Highlight,
} from "../db/highlights";
import { Card } from "./components";
import { radius, spacing, useTheme } from "./theme";

/**
 * Texte extrait, surlignable paragraphe par paragraphe.
 *
 * Un appui long surligne le passage ; un second appui long le retire. Les
 * passages surlignés sont regroupés en tête, chacun avec sa note : c'est ce
 * qu'on veut retrouver d'un coup d'œil en rouvrant l'idée des mois plus tard.
 */
export function HighlightableContent({
  bookmarkId,
  content,
}: {
  bookmarkId: string;
  content: string;
}) {
  const t = useTheme();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const paragraphs = useMemo(() => splitParagraphs(content), [content]);

  const load = useCallback(async () => {
    const list = await listHighlights(bookmarkId);
    setHighlights(list);
    setDrafts(Object.fromEntries(list.map((h) => [h.id, h.note ?? ""])));
  }, [bookmarkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const marked = useMemo(
    () => new Set(highlights.map((h) => passageKey(h.text))),
    [highlights],
  );

  const toggle = (text: string, position: number) => {
    void toggleHighlight(bookmarkId, text, position).then(load);
  };

  return (
    <>
      {highlights.length > 0 && (
        <Card>
          <Text style={[styles.label, { color: t.textMuted }]}>Passages surlignés</Text>
          {highlights.map((h) => (
            <View key={h.id} style={[styles.quote, { borderColor: t.accent }]}>
              <Text style={[styles.body, { color: t.text }]}>{h.text}</Text>
              <TextInput
                value={drafts[h.id] ?? ""}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [h.id]: v }))}
                onBlur={() => {
                  if ((drafts[h.id] ?? "") !== (h.note ?? "")) {
                    void setHighlightNote(h.id, drafts[h.id] ?? "").then(load);
                  }
                }}
                placeholder="Ajouter une note…"
                placeholderTextColor={t.textFaint}
                multiline
                style={[styles.note, { color: t.text, backgroundColor: t.surfaceAlt }]}
              />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <View style={styles.header}>
          <Text style={[styles.label, { color: t.textMuted, flex: 1 }]}>Contenu extrait</Text>
          <Ionicons name="color-fill-outline" size={14} color={t.textFaint} />
          <Text style={[styles.tip, { color: t.textFaint }]}>appui long pour surligner</Text>
        </View>
        {paragraphs.map((p, i) => {
          const on = marked.has(passageKey(p));
          return (
            <Pressable
              key={`${i}-${p.slice(0, 16)}`}
              onLongPress={() => toggle(p, i)}
              delayLongPress={350}
              accessibilityHint={on ? "Retirer le surlignage" : "Surligner ce passage"}
              style={[
                styles.para,
                on && { backgroundColor: t.surfaceAlt, borderLeftColor: t.accent },
              ]}
            >
              <Text style={[styles.body, { color: t.text }]}>{p}</Text>
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tip: { fontSize: 11.5 },
  body: { fontSize: 14.5, lineHeight: 22 },
  para: {
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  note: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13.5,
  },
});
