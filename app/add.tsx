import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { createBookmark } from "../src/db/bookmarks";
import { extractUrl } from "../src/db/urls";
import { processPending } from "../src/pipeline/queue";
import { Button, Card } from "../src/ui/components";
import { notifyBookmarksChanged } from "../src/ui/events";
import { radius, spacing, useTheme } from "../src/ui/theme";

export default function AddScreen() {
  const t = useTheme();
  const router = useRouter();

  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const url = extractUrl(value);
    if (!url) {
      setError("Saisis une adresse web valide.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { created } = await createBookmark(url, {
        note: note.trim() || undefined,
      });
      notifyBookmarksChanged();
      router.back();
      // Le traitement continue après la fermeture de l'écran.
      void processPending().then(notifyBookmarksChanged);
      if (!created) {
        setError("Ce lien était déjà enregistré.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Card>
        <Text style={[styles.label, { color: t.textMuted }]}>Adresse</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="https://…"
          placeholderTextColor={t.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          style={[styles.input, { color: t.text, backgroundColor: t.surfaceAlt }]}
        />

        <Text style={[styles.label, { color: t.textMuted }]}>
          Note (facultatif)
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Pourquoi ce lien t'intéresse…"
          placeholderTextColor={t.textFaint}
          multiline
          style={[
            styles.input,
            styles.note,
            { color: t.text, backgroundColor: t.surfaceAlt },
          ]}
        />

        {error && <Text style={[styles.error, { color: t.danger }]}>{error}</Text>}

        <Button
          label="Enregistrer"
          icon="bookmark-outline"
          loading={saving}
          onPress={() => void save()}
        />
      </Card>

      <Text style={[styles.tip, { color: t.textFaint }]}>
        Plus simple au quotidien : depuis n'importe quelle application, utilise
        « Partager » et choisis Karakeep Local.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  note: { minHeight: 76, textAlignVertical: "top" },
  error: { fontSize: 13 },
  tip: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
