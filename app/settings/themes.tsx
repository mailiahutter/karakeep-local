import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { requeueAutoClassified } from "../../src/db/bookmarks";
import { processPending } from "../../src/pipeline/queue";
import {
  countUnderSubtheme,
  countUnderTheme,
  createSubtheme,
  createTheme,
  deleteSubtheme,
  deleteTheme,
  listThemes,
  updateSubtheme,
  updateTheme,
  type Theme,
} from "../../src/db/themes";
import { Button, Card, Row } from "../../src/ui/components";
import { notifyBookmarksChanged } from "../../src/ui/events";
import { radius, spacing, useTheme } from "../../src/ui/theme";

/**
 * Édition de l'arborescence de rangement.
 *
 * Les thèmes étaient jusqu'ici figés dans le code : impossible d'en ajouter,
 * d'en retirer ou d'en corriger un. Or ce sont les tiroirs de l'utilisateur,
 * pas les miens.
 *
 * La description n'est pas un commentaire décoratif : c'est le texte donné au
 * modèle au moment du classement. Elle est le seul moyen de distinguer
 * « Moto › Ma sélection » de « Destinations roadtrip › Roadtrip moto », dont
 * les intitulés seuls ne disent rien.
 */

/** Icônes proposées à la création d'un thème. */
const ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  "folder-outline",
  "restaurant-outline",
  "map-outline",
  "bicycle-outline",
  "bus-outline",
  "car-sport-outline",
  "home-outline",
  "barbell-outline",
  "briefcase-outline",
  "book-outline",
  "musical-notes-outline",
  "camera-outline",
  "leaf-outline",
  "construct-outline",
  "airplane-outline",
  "cash-outline",
];

type Editing =
  | { kind: "theme"; id: string | null; name: string; description: string; icon: string }
  | { kind: "subtheme"; id: string | null; themeId: string; name: string; description: string };

export default function ThemesSettingsScreen() {
  const t = useTheme();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [requeuing, setRequeuing] = useState(false);

  const load = useCallback(async () => {
    setThemes(await listThemes());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (name.length === 0) {
      Alert.alert("Nom manquant", "Donne un nom à cette catégorie.");
      return;
    }
    setSaving(true);
    try {
      if (editing.kind === "theme") {
        if (editing.id) {
          await updateTheme(editing.id, {
            name,
            icon: editing.icon,
            description: editing.description,
          });
        } else {
          await createTheme(name, editing.icon, editing.description);
        }
      } else if (editing.id) {
        await updateSubtheme(editing.id, {
          name,
          description: editing.description,
        });
      } else {
        await createSubtheme(editing.themeId, name, editing.description);
      }
      setEditing(null);
      await load();
      // Le rangement affiché ailleurs dépend de cette arborescence.
      notifyBookmarksChanged();
    } catch (err) {
      // Le nom est unique en base : le heurt doit être expliqué, pas avalé.
      Alert.alert(
        "Enregistrement impossible",
        `${(err as Error).message}\n\nUn thème ou un sous-thème du même nom existe peut-être déjà.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const requeue = () => {
    Alert.alert(
      "Reclasser les liens ?",
      "Le modèle repassera sur chaque lien qu'il avait rangé lui-même. Les " +
        "rangements que tu as corrigés à la main sont conservés. Sur un grand " +
        "nombre de liens, cela peut prendre un long moment.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Reclasser",
          onPress: () => {
            setRequeuing(true);
            void (async () => {
              try {
                const n = await requeueAutoClassified();
                notifyBookmarksChanged();
                void processPending().then(notifyBookmarksChanged);
                Alert.alert(
                  "Reclassement lancé",
                  n === 0
                    ? "Aucun lien à reclasser."
                    : `${n} lien${n > 1 ? "s repassent" : " repasse"} au modèle. Laisse l'application ouverte pour que ça avance.`,
                );
              } finally {
                setRequeuing(false);
              }
            })();
          },
        },
      ],
    );
  };

  const confirmDelete = async (
    kind: "theme" | "subtheme",
    id: string,
    label: string,
  ) => {
    const used =
      kind === "theme" ? await countUnderTheme(id) : await countUnderSubtheme(id);
    Alert.alert(
      `Supprimer « ${label} » ?`,
      used > 0
        ? `${used} lien${used > 1 ? "s y sont rangés" : " y est rangé"}. ` +
          "Ils sont conservés : ils redeviennent simplement non rangés."
        : "Cette catégorie est vide.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (kind === "theme") await deleteTheme(id);
              else await deleteSubtheme(id);
              await load();
              notifyBookmarksChanged();
            })();
          },
        },
      ],
    );
  };

  return (
    <>
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={styles.content}
      >
        <Card>
          <Text style={[styles.intro, { color: t.textMuted }]}>
            Ces thèmes sont les tiroirs où le modèle range chaque lien
            enregistré. La description compte autant que le nom : c'est elle
            que le modèle lit pour décider. Écris-la comme tu l'expliquerais à
            quelqu'un — « modèles de motos que j'envisage d'acheter » plutôt
            que « motos ».
          </Text>
        </Card>

        {themes.map((theme) => {
          const expanded = open[theme.id] ?? false;
          return (
            <Card key={theme.id} style={styles.themeCard}>
              <Pressable
                onPress={() => setOpen((o) => ({ ...o, [theme.id]: !expanded }))}
                style={styles.themeHeader}
                accessibilityRole="button"
              >
                <Ionicons
                  name={
                    (theme.icon as keyof typeof Ionicons.glyphMap) ??
                    "folder-outline"
                  }
                  size={20}
                  color={t.accent}
                />
                <View style={styles.grow}>
                  <Text style={[styles.themeName, { color: t.text }]}>
                    {theme.name}
                  </Text>
                  <Text
                    style={[
                      styles.description,
                      { color: theme.description ? t.textFaint : t.warning },
                    ]}
                    numberOfLines={expanded ? undefined : 2}
                  >
                    {theme.description ??
                      "Aucune consigne : le modèle ne sait pas ce qui va ici."}
                  </Text>
                </View>
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={17}
                  color={t.textFaint}
                />
              </Pressable>

              {expanded && (
                <View style={styles.body}>
                  {theme.subthemes.map((sub) => (
                    <View
                      key={sub.id}
                      style={[styles.sub, { borderTopColor: t.border }]}
                    >
                      <View style={styles.grow}>
                        <Text style={[styles.subName, { color: t.text }]}>
                          {sub.name}
                        </Text>
                        <Text
                          style={[
                            styles.description,
                            {
                              color: sub.description ? t.textFaint : t.warning,
                            },
                          ]}
                        >
                          {sub.description ?? "Aucune consigne."}
                        </Text>
                      </View>
                      <IconButton
                        name="create-outline"
                        label={`Modifier ${sub.name}`}
                        onPress={() =>
                          setEditing({
                            kind: "subtheme",
                            id: sub.id,
                            themeId: theme.id,
                            name: sub.name,
                            description: sub.description ?? "",
                          })
                        }
                      />
                      <IconButton
                        name="trash-outline"
                        label={`Supprimer ${sub.name}`}
                        tone="danger"
                        onPress={() =>
                          void confirmDelete("subtheme", sub.id, sub.name)
                        }
                      />
                    </View>
                  ))}

                  <Row style={styles.themeActions}>
                    <Button
                      label="Sous-thème"
                      icon="add"
                      variant="secondary"
                      style={styles.grow}
                      onPress={() =>
                        setEditing({
                          kind: "subtheme",
                          id: null,
                          themeId: theme.id,
                          name: "",
                          description: "",
                        })
                      }
                    />
                    <Button
                      label="Modifier"
                      icon="create-outline"
                      variant="secondary"
                      style={styles.grow}
                      onPress={() =>
                        setEditing({
                          kind: "theme",
                          id: theme.id,
                          name: theme.name,
                          description: theme.description ?? "",
                          icon: theme.icon ?? "folder-outline",
                        })
                      }
                    />
                    <Button
                      label="Supprimer"
                      icon="trash-outline"
                      variant="danger"
                      onPress={() =>
                        void confirmDelete("theme", theme.id, theme.name)
                      }
                    />
                  </Row>
                </View>
              )}
            </Card>
          );
        })}

        <Button
          label="Nouveau thème"
          icon="add-circle-outline"
          onPress={() =>
            setEditing({
              kind: "theme",
              id: null,
              name: "",
              description: "",
              icon: "folder-outline",
            })
          }
        />

        <Card>
          <Text style={[styles.intro, { color: t.textMuted }]}>
            Les liens déjà enregistrés gardent le rangement décidé avec les
            anciennes consignes. Après une modification, tu peux les repasser
            au modèle.
          </Text>
          <Button
            label="Reclasser les liens"
            icon="refresh"
            variant="secondary"
            loading={requeuing}
            onPress={requeue}
          />
        </Card>
      </ScrollView>

      <EditorModal
        editing={editing}
        saving={saving}
        onChange={setEditing}
        onCancel={() => setEditing(null)}
        onSave={() => void save()}
      />
    </>
  );
}

function IconButton({
  name,
  label,
  onPress,
  tone,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: "danger";
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
    >
      <Ionicons
        name={name}
        size={19}
        color={tone === "danger" ? t.danger : t.textMuted}
      />
    </Pressable>
  );
}

function EditorModal({
  editing,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editing: Editing | null;
  saving: boolean;
  onChange: (next: Editing) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  if (!editing) return null;

  const isTheme = editing.kind === "theme";
  const title = editing.id
    ? isTheme
      ? "Modifier le thème"
      : "Modifier le sous-thème"
    : isTheme
      ? "Nouveau thème"
      : "Nouveau sous-thème";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ScrollView
          style={[styles.sheet, { backgroundColor: t.surface }]}
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.sheetTitle, { color: t.text }]}>{title}</Text>

          <Text style={[styles.label, { color: t.textMuted }]}>Nom</Text>
          <TextInput
            value={editing.name}
            onChangeText={(name) => onChange({ ...editing, name })}
            placeholder={isTheme ? "Vanlife" : "Idées d'aménagement"}
            placeholderTextColor={t.textFaint}
            autoFocus
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.bg },
            ]}
          />

          <Text style={[styles.label, { color: t.textMuted }]}>
            Ce qui va dedans
          </Text>
          <Text style={[styles.help, { color: t.textFaint }]}>
            Lu par le modèle à chaque classement. Une phrase claire suffit.
          </Text>
          <TextInput
            value={editing.description}
            onChangeText={(description) => onChange({ ...editing, description })}
            placeholder="Plans, agencements et astuces pour aménager l'intérieur d'un van."
            placeholderTextColor={t.textFaint}
            multiline
            style={[
              styles.input,
              styles.multiline,
              { color: t.text, borderColor: t.border, backgroundColor: t.bg },
            ]}
          />

          {isTheme && (
            <>
              <Text style={[styles.label, { color: t.textMuted }]}>Icône</Text>
              <View style={styles.icons}>
                {ICONS.map((name) => {
                  const active = editing.icon === name;
                  return (
                    <Pressable
                      key={name}
                      onPress={() => onChange({ ...editing, icon: name })}
                      accessibilityRole="button"
                      accessibilityLabel={name}
                      style={[
                        styles.iconChoice,
                        {
                          borderColor: active ? t.accent : t.border,
                          backgroundColor: active ? t.surfaceAlt : "transparent",
                        },
                      ]}
                    >
                      <Ionicons
                        name={name}
                        size={20}
                        color={active ? t.accent : t.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <Row style={styles.sheetActions}>
            <Button
              label="Annuler"
              variant="ghost"
              onPress={onCancel}
              style={styles.grow}
            />
            <Button
              label="Enregistrer"
              icon="checkmark"
              loading={saving}
              onPress={onSave}
              style={styles.grow}
            />
          </Row>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  intro: { fontSize: 13.5, lineHeight: 20 },
  themeCard: { gap: 0 },
  themeHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1 },
  themeName: { fontSize: 16, fontWeight: "700" },
  description: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  body: { marginTop: spacing.md },
  sub: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subName: { fontSize: 14.5, fontWeight: "600" },
  themeActions: { marginTop: spacing.md },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetContent: { padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: "700", marginTop: spacing.md },
  help: { fontSize: 12, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetActions: { marginTop: spacing.lg },
});
