import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createSubtheme,
  createTheme,
  listThemes,
  updateSubtheme,
  updateTheme,
  type Theme,
} from "../db/themes";
import { normalizeIconInput } from "./icons";
import { ThemeIcon } from "./ThemeIcon";
import { notifyBookmarksChanged } from "./events";
import { radius, spacing, useTheme } from "./theme";

type Form =
  | { kind: "new-theme" }
  | { kind: "edit-theme"; theme: Theme }
  | { kind: "new-sub"; theme: Theme }
  | { kind: "edit-sub"; theme: Theme; subId: string };

/**
 * « Ranger dans… » : tous les tiroirs et leurs sous-thèmes.
 *
 * Retour du 21 octobre : vérifier sans pouvoir créer ni corriger un tiroir ne
 * menait nulle part. On crée donc un tiroir ou un sous-thème, on renomme, on
 * change l'emoji et — surtout — on écrit ce qu'on y range, sans quitter la
 * vérification. L'idée en cours y est rangée aussitôt créée.
 */
export function DrawerPicker({
  visible,
  onPick,
  onClose,
  onThemesChanged,
}: {
  visible: boolean;
  onPick: (themeId: string, subthemeId: string | null) => void;
  onClose: () => void;
  onThemesChanged?: () => void;
}) {
  const t = useTheme();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => setThemes(await listThemes()), []);
  useEffect(() => {
    if (visible) {
      setForm(null);
      void load();
    }
  }, [visible, load]);

  const open = (next: Form) => {
    setForm(next);
    if (next.kind === "edit-theme") {
      setName(next.theme.name);
      setEmoji(next.theme.icon ?? "");
      setDescription(next.theme.description ?? "");
    } else if (next.kind === "edit-sub") {
      const sub = next.theme.subthemes.find((s) => s.id === next.subId);
      setName(sub?.name ?? "");
      setDescription(sub?.description ?? "");
      setEmoji("");
    } else {
      setName("");
      setEmoji(next.kind === "new-theme" ? "📁" : "");
      setDescription("");
    }
  };

  const changed = async () => {
    await load();
    notifyBookmarksChanged();
    onThemesChanged?.();
  };

  const save = async () => {
    if (!form) return;
    const label = name.trim();
    if (!label) {
      Alert.alert("Nom manquant", "Donne un nom au tiroir.");
      return;
    }
    try {
      if (form.kind === "new-theme") {
        const id = await createTheme(label, normalizeIconInput(emoji) ?? "📁", description);
        await changed();
        onPick(id, null);
      } else if (form.kind === "edit-theme") {
        await updateTheme(form.theme.id, {
          name: label,
          icon: normalizeIconInput(emoji),
          description,
        });
        await changed();
        setForm(null);
      } else if (form.kind === "new-sub") {
        const id = await createSubtheme(form.theme.id, label, description);
        await changed();
        onPick(form.theme.id, id);
      } else {
        await updateSubtheme(form.subId, { name: label, description });
        await changed();
        setForm(null);
      }
    } catch (err) {
      // Nom déjà pris : l'index unique de la base le refuse.
      Alert.alert("Impossible d'enregistrer", /UNIQUE/i.test(String(err)) ? "Ce nom existe déjà." : String(err));
    }
  };

  const formTitle =
    form?.kind === "new-theme"
      ? "Nouveau tiroir"
      : form?.kind === "edit-theme"
        ? "Modifier le tiroir"
        : form?.kind === "new-sub"
          ? `Nouveau sous-thème dans ${form.theme.name}`
          : "Modifier le sous-thème";
  const withEmoji = form?.kind === "new-theme" || form?.kind === "edit-theme";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Fermer">
          <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
            <View style={[styles.grab, { backgroundColor: t.border }]} />

            {form ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
                <Text style={[styles.title, { color: t.text }]}>{formTitle}</Text>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {withEmoji && (
                    <TextInput
                      value={emoji}
                      onChangeText={setEmoji}
                      placeholder="🙂"
                      style={[styles.input, { width: 56, textAlign: "center", color: t.text, backgroundColor: t.surfaceAlt }]}
                      accessibilityLabel="Emoji (n'importe lequel de ton clavier)"
                    />
                  )}
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Nom"
                    placeholderTextColor={t.textFaint}
                    autoFocus
                    style={[styles.input, { flex: 1, color: t.text, backgroundColor: t.surfaceAlt }]}
                  />
                </View>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Ce qu'on y range — l'IA lit cette phrase pour décider. Ex. : laisses, harnais et colliers pour chien."
                  placeholderTextColor={t.textFaint}
                  multiline
                  style={[styles.input, { minHeight: 70, textAlignVertical: "top", color: t.text, backgroundColor: t.surfaceAlt }]}
                />
                <Pressable onPress={() => void save()} style={[styles.primary, { backgroundColor: t.accent }]}>
                  <Text style={{ color: t.accentText, fontWeight: "700" }}>
                    {form.kind === "new-theme" || form.kind === "new-sub" ? "Créer et y ranger l'idée" : "Enregistrer"}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setForm(null)} style={styles.secondary}>
                  <Text style={{ color: t.textMuted }}>Annuler</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <>
                <View style={styles.header}>
                  <Text style={[styles.title, { color: t.text, flex: 1 }]}>Ranger dans…</Text>
                  <Pressable
                    onPress={() => open({ kind: "new-theme" })}
                    style={[styles.add, { backgroundColor: t.accent }]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="add" size={16} color={t.accentText} />
                    <Text style={{ color: t.accentText, fontWeight: "700", fontSize: 13 }}>Nouveau tiroir</Text>
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
                  {themes.map((theme) => (
                    <View key={theme.id} style={styles.group}>
                      <View style={styles.themeRow}>
                        <Pressable
                          onPress={() => onPick(theme.id, null)}
                          style={({ pressed }) => [styles.theme, { opacity: pressed ? 0.6 : 1 }]}
                        >
                          <ThemeIcon icon={theme.icon} size={18} color={t.accent} />
                          <Text style={[styles.themeName, { color: t.text }]}>{theme.name}</Text>
                        </Pressable>
                        <Pressable onPress={() => open({ kind: "new-sub", theme })} hitSlop={8} accessibilityLabel={`Ajouter un sous-thème à ${theme.name}`}>
                          <Ionicons name="add-circle-outline" size={21} color={t.textMuted} />
                        </Pressable>
                        <Pressable onPress={() => open({ kind: "edit-theme", theme })} hitSlop={8} accessibilityLabel={`Modifier ${theme.name}`}>
                          <Ionicons name="create-outline" size={20} color={t.textMuted} />
                        </Pressable>
                      </View>
                      {!!theme.description && (
                        <Text style={[styles.desc, { color: t.textFaint }]} numberOfLines={2}>
                          {theme.description}
                        </Text>
                      )}
                      {theme.subthemes.map((sub) => (
                        <View key={sub.id} style={[styles.sub, { backgroundColor: t.surfaceAlt }]}>
                          <Pressable onPress={() => onPick(theme.id, sub.id)} style={{ flex: 1, paddingVertical: spacing.sm }}>
                            <Text style={{ color: t.text, fontSize: 14 }}>{sub.name}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => open({ kind: "edit-sub", theme, subId: sub.id })}
                            hitSlop={8}
                            accessibilityLabel={`Modifier ${sub.name}`}
                          >
                            <Ionicons name="create-outline" size={17} color={t.textFaint} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: spacing.md },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "700" },
  add: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: 999 },
  group: { marginBottom: spacing.md, gap: spacing.xs },
  themeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  theme: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  themeName: { fontSize: 15, fontWeight: "700" },
  desc: { fontSize: 12, marginLeft: spacing.xl, marginTop: -4 },
  sub: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginLeft: spacing.xl,
  },
  input: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
  primary: { alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  secondary: { alignItems: "center", paddingVertical: spacing.sm },
});
