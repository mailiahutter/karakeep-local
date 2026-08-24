import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { radius, spacing, useTheme } from "./theme";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const inert = disabled || loading;

  const palette = {
    primary: { bg: t.accent, fg: t.accentText, border: t.accent },
    secondary: { bg: t.surfaceAlt, fg: t.text, border: t.border },
    danger: { bg: "transparent", fg: t.danger, border: t.danger },
    ghost: { bg: "transparent", fg: t.textMuted, border: "transparent" },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: inert ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        icon && <Ionicons name={icon} size={17} color={palette.fg} />
      )}
      <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[styles.sectionTitle, { color: t.textMuted }]}>{children}</Text>
  );
}

export function Chip({
  label,
  onPress,
  onRemove,
  tone = "neutral",
}: {
  label: string;
  onPress?: () => void;
  onRemove?: () => void;
  tone?: "neutral" | "ai";
}) {
  const t = useTheme();
  const bg = tone === "ai" ? `${t.accent}22` : t.surfaceAlt;
  const fg = tone === "ai" ? t.accent : t.textMuted;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, { backgroundColor: bg }]}
    >
      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityLabel={`Retirer le tag ${label}`}
        >
          <Ionicons name="close" size={13} color={fg} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** Barre de progression déterminée, ou indéterminée si `ratio` est null. */
export function ProgressBar({ ratio }: { ratio: number | null }) {
  const t = useTheme();
  return (
    <View style={[styles.progressTrack, { backgroundColor: t.surfaceAlt }]}>
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: t.accent,
            width: ratio === null ? "100%" : `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`,
            opacity: ratio === null ? 0.4 : 1,
          },
        ]}
      />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={t.textFaint} />
      <Text style={[styles.emptyTitle, { color: t.text }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: t.textMuted }]}>
        {message}
      </Text>
    </View>
  );
}

export function Row({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 46,
  },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 999,
    maxWidth: 200,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyMessage: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
