import { useState } from "react";
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
  countUnderSubtheme,
  countUnderTheme,
  createSubtheme,
  createTheme,
  deleteSubtheme,
  deleteTheme,
  setLearnedCriteria,
  updateSubtheme,
  updateTheme,
  type Theme,
} from "../db/themes";
import { normalizeIconInput } from "./icons";
import { notifyBookmarksChanged } from "./events";
import { radius, spacing, useTheme } from "./theme";

export type ThemeFormMode =
  | { kind: "new-theme" }
  | { kind: "edit-theme"; theme: Theme }
  | { kind: "new-sub"; theme: Theme }
  | { kind: "edit-sub"; theme: Theme; subId: string };

export interface ThemeFormResult {
  themeId: string | null;
  subthemeId: string | null;
  created: boolean;
  deleted: boolean;
}

/**
 * Créer, modifier ou supprimer un tiroir ou un sous-thème.
 *
 * Partagé par l'accueil, le tiroir ouvert, la vérification et la fiche : où
 * que l'on soit, on peut corriger l'arborescence sans aller dans les réglages.
 * Les critères que l'IA a appris des rangements sont montrés, et peuvent être
 * effacés s'ils partent dans une mauvaise direction.
 */
export function ThemeForm({
  mode,
  createLabel = "Créer",
  onDone,
  onCancel,
}: {
  mode: ThemeFormMode;
  createLabel?: string;
  onDone: (result: ThemeFormResult) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const editingSub = mode.kind === "edit-sub" ? mode.theme.subthemes.find((s) => s.id === mode.subId) : null;
  const current = mode.kind === "edit-theme" ? mode.theme : editingSub;
  const [name, setName] = useState(current?.name ?? "");
  const [emoji, setEmoji] = useState(mode.kind === "edit-theme" ? (mode.theme.icon ?? "") : mode.kind === "new-theme" ? "📁" : "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [learned, setLearned] = useState(current?.learnedCriteria ?? null);

  const withEmoji = mode.kind === "new-theme" || mode.kind === "edit-theme";
  const isNew = mode.kind === "new-theme" || mode.kind === "new-sub";
  const title =
    mode.kind === "new-theme"
      ? "Nouveau tiroir"
      : mode.kind === "edit-theme"
        ? `Modifier ${mode.theme.name}`
        : mode.kind === "new-sub"
          ? `Nouveau sous-thème dans ${mode.theme.name}`
          : `Modifier ${editingSub?.name ?? "le sous-thème"}`;

  const done = (r: Partial<ThemeFormResult>) => {
    notifyBookmarksChanged();
    onDone({ themeId: null, subthemeId: null, created: false, deleted: false, ...r });
  };

  const save = async () => {
    const label = name.trim();
    if (!label) return Alert.alert("Nom manquant", "Donne-lui un nom.");
    try {
      if (mode.kind === "new-theme") {
        const id = await createTheme(label, normalizeIconInput(emoji) ?? "📁", description);
        done({ themeId: id, created: true });
      } else if (mode.kind === "edit-theme") {
        await updateTheme(mode.theme.id, { name: label, icon: normalizeIconInput(emoji), description });
        done({ themeId: mode.theme.id });
      } else if (mode.kind === "new-sub") {
        const id = await createSubtheme(mode.theme.id, label, description);
        done({ themeId: mode.theme.id, subthemeId: id, created: true });
      } else {
        await updateSubtheme(mode.subId, { name: label, description });
        done({ themeId: mode.theme.id, subthemeId: mode.subId });
      }
    } catch (err) {
      Alert.alert("Impossible d'enregistrer", /UNIQUE/i.test(String(err)) ? "Ce nom existe déjà." : String(err));
    }
  };

  const remove = async () => {
    const isTheme = mode.kind === "edit-theme";
    const id = isTheme ? mode.theme.id : mode.kind === "edit-sub" ? mode.subId : null;
    if (!id) return;
    const n = isTheme ? await countUnderTheme(id) : await countUnderSubtheme(id);
    Alert.alert(
      isTheme ? `Supprimer le tiroir « ${mode.theme.name} » ?` : `Supprimer « ${editingSub?.name} » ?`,
      n === 0
        ? "Il est vide."
        : isTheme
          ? `Ses ${n} idée${n > 1 ? "s" : ""} ne seront pas effacées : elles iront dans « À vérifier » pour être rangées ailleurs.`
          : `Ses ${n} idée${n > 1 ? "s" : ""} restent dans le tiroir, sans sous-thème.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () =>
            void (async () => {
              if (isTheme) await deleteTheme(id);
              else await deleteSubtheme(id);
              done({ deleted: true });
            })(),
        },
      ],
    );
  };

  const forget = async () => {
    if (mode.kind === "edit-theme") await setLearnedCriteria("theme", mode.theme.id, null, 0);
    if (mode.kind === "edit-sub") await setLearnedCriteria("subtheme", mode.subId, null, 0);
    setLearned(null);
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {withEmoji && (
          <TextInput
            value={emoji}
            onChangeText={setEmoji}
            placeholder="🙂"
            style={[styles.input, { width: 56, textAlign: "center", color: t.text, backgroundColor: t.surfaceAlt }]}
            accessibilityLabel="Emoji, n'importe lequel de ton clavier"
          />
        )}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Nom"
          placeholderTextColor={t.textFaint}
          autoFocus={isNew}
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
      {!isNew && (
        <View style={[styles.learned, { backgroundColor: t.surfaceAlt }]}>
          <Text style={[styles.learnedTitle, { color: t.textMuted }]}>Ce que l'IA a appris de tes rangements</Text>
          <Text style={{ color: learned ? t.text : t.textFaint, fontSize: 13.5 }}>
            {learned ?? "Rien encore : il faut quelques idées rangées ou validées par toi ici. Elle complète ces critères la nuit."}
          </Text>
          {learned && (
            <Pressable onPress={() => void forget()} hitSlop={8}>
              <Text style={{ color: t.danger, fontSize: 13, fontWeight: "600" }}>Effacer, elle repartira de tes prochains rangements</Text>
            </Pressable>
          )}
        </View>
      )}
      <Pressable onPress={() => void save()} style={[styles.primary, { backgroundColor: t.accent }]}>
        <Text style={{ color: t.accentText, fontWeight: "700" }}>{isNew ? createLabel : "Enregistrer"}</Text>
      </Pressable>
      {!isNew && (
        <Pressable onPress={() => void remove()} style={styles.secondary}>
          <Text style={{ color: t.danger, fontWeight: "600" }}>
            {mode.kind === "edit-theme" ? "Supprimer ce tiroir" : "Supprimer ce sous-thème"}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={onCancel} style={styles.secondary}>
        <Text style={{ color: t.textMuted }}>Annuler</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Le formulaire dans sa propre feuille, pour l'accueil et le tiroir ouvert. */
export function ThemeEditorSheet({
  mode,
  onClose,
  onDone,
}: {
  mode: ThemeFormMode | null;
  onClose: () => void;
  onDone?: (result: ThemeFormResult) => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
            <View style={[styles.grab, { backgroundColor: t.border }]} />
            {mode && (
              <ThemeForm
                mode={mode}
                onCancel={onClose}
                onDone={(r) => {
                  onClose();
                  onDone?.(r);
                }}
              />
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
    maxHeight: "90%",
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "700" },
  input: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
  learned: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  learnedTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  primary: { alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  secondary: { alignItems: "center", paddingVertical: spacing.sm },
});
