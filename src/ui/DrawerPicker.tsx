import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { Theme } from "../db/themes";
import { ThemeIcon } from "./ThemeIcon";
import { radius, spacing, useTheme } from "./theme";

/** « Ranger dans… » : tous les tiroirs et leurs sous-thèmes, en feuille. */
export function DrawerPicker({
  visible,
  themes,
  onPick,
  onClose,
}: {
  visible: boolean;
  themes: Theme[];
  onPick: (themeId: string, subthemeId: string | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Fermer">
        <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
          <View style={[styles.grab, { backgroundColor: t.border }]} />
          <Text style={[styles.title, { color: t.text }]}>Ranger dans…</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {themes.map((theme) => (
              <View key={theme.id} style={styles.group}>
                <Pressable
                  onPress={() => onPick(theme.id, null)}
                  style={({ pressed }) => [styles.theme, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <ThemeIcon icon={theme.icon} size={18} color={t.accent} />
                  <Text style={[styles.themeName, { color: t.text }]}>{theme.name}</Text>
                </Pressable>
                {theme.subthemes.map((sub) => (
                  <Pressable
                    key={sub.id}
                    onPress={() => onPick(theme.id, sub.id)}
                    style={({ pressed }) => [
                      styles.sub,
                      { backgroundColor: t.surfaceAlt, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text style={{ color: t.text, fontSize: 14 }}>{sub.name}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "80%",
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "700", marginBottom: spacing.md },
  group: { marginBottom: spacing.md, gap: spacing.xs },
  theme: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  themeName: { fontSize: 15, fontWeight: "700" },
  sub: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginLeft: spacing.xl,
  },
});
