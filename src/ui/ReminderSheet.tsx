import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  addReminder,
  cancelReminder,
  listReminders,
  type Reminder,
} from "../db/reminders";
import type { Bookmark } from "../db/types";
import { formatWhen, reminderPresets } from "../pipeline/reminderTime";
import { radius, spacing, useTheme } from "./theme";

/**
 * « Me le rappeler » : une notification de l'application à la date choisie,
 * ou, au choix, un créneau ajouté dans l'agenda du téléphone.
 */
export function ReminderSheet({
  visible,
  bookmark,
  onClose,
}: {
  visible: boolean;
  bookmark: Bookmark;
  onClose: () => void;
}) {
  const t = useTheme();
  const [pending, setPending] = useState<Reminder[]>([]);
  const [when, setWhen] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setPending(await listReminders(bookmark.id));
  }, [bookmark.id]);

  useEffect(() => {
    if (visible) {
      setWhen(null);
      void refresh();
    }
  }, [visible, refresh]);

  const title = bookmark.title ?? "Une idée à revoir";
  const body = bookmark.subject ?? bookmark.summary ?? "Jette un œil à cette idée.";

  const pickCustom = () => {
    if (Platform.OS !== "android") return;
    const start = new Date(Date.now() + 3_600_000);
    DateTimePickerAndroid.open({
      value: start,
      mode: "date",
      minimumDate: new Date(),
      onChange: (e, date) => {
        if (e.type !== "set" || !date) return;
        DateTimePickerAndroid.open({
          value: date,
          mode: "time",
          is24Hour: true,
          onChange: (e2, time) => {
            if (e2.type !== "set" || !time) return;
            const d = new Date(date);
            d.setHours(time.getHours(), time.getMinutes(), 0, 0);
            setWhen(d.getTime());
          },
        });
      },
    });
  };

  const notify = async () => {
    if (!when) return;
    try {
      await addReminder(bookmark.id, when, title, body);
      await refresh();
      Alert.alert("Rappel programmé", `Je te le rappelle ${formatWhen(when)}.`);
      onClose();
    } catch (err) {
      Alert.alert("Rappel impossible", (err as Error).message);
    }
  };

  const toCalendar = async () => {
    if (!when) return;
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.INSERT", {
        data: "content://com.android.calendar/events",
        type: "vnd.android.cursor.item/event",
        extra: {
          title,
          description: `${body}\n\n${bookmark.url}`,
          beginTime: when,
          endTime: when + 30 * 60_000,
        },
      });
      onClose();
    } catch {
      Alert.alert("Agenda introuvable", "Aucune application d'agenda n'a accepté le créneau.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: t.surface }]} onPress={() => {}}>
          <View style={[styles.grab, { backgroundColor: t.border }]} />
          <Text style={[styles.title, { color: t.text }]}>Me le rappeler</Text>

          {pending.map((r) => (
            <View key={r.id} style={[styles.row, { backgroundColor: t.surfaceAlt }]}>
              <Ionicons name="alarm" size={16} color={t.accent} />
              <Text style={{ flex: 1, color: t.text }}>Rappel {formatWhen(r.dueAt)}</Text>
              <Pressable onPress={() => void cancelReminder(r.id).then(refresh)} hitSlop={8}>
                <Text style={{ color: t.danger, fontWeight: "600" }}>Annuler</Text>
              </Pressable>
            </View>
          ))}

          <Text style={[styles.label, { color: t.textMuted }]}>Quand ?</Text>
          <View style={styles.presets}>
            {reminderPresets(new Date()).map((p) => {
              const active = when === p.at;
              return (
                <Pressable
                  key={p.label}
                  onPress={() => setWhen(p.at)}
                  style={[
                    styles.preset,
                    { backgroundColor: active ? t.accent : t.surfaceAlt },
                  ]}
                >
                  <Text style={{ color: active ? t.accentText : t.text, fontWeight: "600" }}>{p.label}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={pickCustom} style={[styles.preset, { backgroundColor: t.surfaceAlt }]}>
              <Text style={{ color: t.text, fontWeight: "600" }}>Choisir date et heure…</Text>
            </Pressable>
          </View>
          {when && <Text style={{ color: t.text, marginTop: spacing.sm }}>Le {formatWhen(when)}</Text>}

          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Pressable
              disabled={!when}
              onPress={() => void notify()}
              style={[styles.action, { backgroundColor: t.accent, opacity: when ? 1 : 0.4 }]}
            >
              <Ionicons name="notifications-outline" size={18} color={t.accentText} />
              <Text style={{ color: t.accentText, fontWeight: "700" }}>Notification dans l'application</Text>
            </Pressable>
            <Pressable
              disabled={!when}
              onPress={() => void toCalendar()}
              style={[styles.action, { backgroundColor: t.surfaceAlt, opacity: when ? 1 : 0.4 }]}
            >
              <Ionicons name="calendar-outline" size={18} color={t.text} />
              <Text style={{ color: t.text, fontWeight: "700" }}>Ajouter un créneau à mon agenda</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.lg,
    gap: spacing.sm,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  title: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.sm },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  preset: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 999 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
});
