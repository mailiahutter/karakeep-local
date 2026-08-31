import { Ionicons } from "@expo/vector-icons";
import { Image } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Bookmark } from "../db/types";
import { hostLabel } from "../db/urls";
import { Chip } from "./components";
import { radius, spacing, useTheme } from "./theme";

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return new Date(ts).toLocaleDateString("fr-FR");
}

/** Indique où en est le traitement, pour que l'attente soit compréhensible. */
function StatusHint({ bookmark }: { bookmark: Bookmark }) {
  const t = useTheme();

  if (bookmark.fetchStatus === "error") {
    return (
      <View style={styles.status}>
        <Ionicons name="alert-circle-outline" size={13} color={t.warning} />
        <Text style={[styles.statusText, { color: t.warning }]} numberOfLines={1}>
          {bookmark.fetchError ?? "Extraction impossible"}
        </Text>
      </View>
    );
  }
  if (bookmark.fetchStatus === "pending" || bookmark.fetchStatus === "running") {
    return (
      <View style={styles.status}>
        <Ionicons name="cloud-download-outline" size={13} color={t.textFaint} />
        <Text style={[styles.statusText, { color: t.textFaint }]}>
          Lecture de la page…
        </Text>
      </View>
    );
  }
  if (bookmark.aiStatus === "error") {
    // Sans cette branche, un lien dont l'analyse a échoué était indiscernable
    // d'un lien correctement traité : la carte restait simplement vide.
    return (
      <View style={styles.status}>
        <Ionicons name="alert-circle-outline" size={13} color={t.warning} />
        <Text style={[styles.statusText, { color: t.warning }]} numberOfLines={1}>
          Analyse interrompue — touche pour relancer
        </Text>
      </View>
    );
  }
  if (bookmark.aiStatus === "running" || bookmark.aiStatus === "pending") {
    return (
      <View style={styles.status}>
        <Ionicons name="sparkles-outline" size={13} color={t.textFaint} />
        <Text style={[styles.statusText, { color: t.textFaint }]}>
          {/* « en attente » n'est pas « en cours » : la liste ne peut pas
              savoir laquelle des deux, la fiche le dit précisément. */}
          En attente d'analyse
        </Text>
      </View>
    );
  }
  return null;
}

export function BookmarkCard({
  bookmark,
  onPress,
  onToggleFavourite,
}: {
  bookmark: Bookmark;
  onPress: () => void;
  onToggleFavourite: () => void;
}) {
  const t = useTheme();
  const host = hostLabel(bookmark.url);
  const thumb = bookmark.thumbnailPath ?? bookmark.imageUrl;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: t.surface,
          borderColor: t.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: t.text }]} numberOfLines={2}>
            {bookmark.title ?? bookmark.url}
          </Text>
          <Text style={[styles.meta, { color: t.textFaint }]} numberOfLines={1}>
            {host ?? bookmark.url} · {relativeDate(bookmark.createdAt)}
          </Text>
        </View>
        {/* La pièce conservée passe avant l'adresse du site : celles
            d'Instagram expirent en quelques jours, et la liste montrait des
            cases grises pour des images pourtant présentes sur l'appareil. */}
        {thumb && (
          <Image
            source={{ uri: thumb }}
            style={[styles.thumb, { backgroundColor: t.surfaceAlt }]}
            resizeMode="cover"
          />
        )}
      </View>

      {bookmark.description && (
        <Text style={[styles.desc, { color: t.textMuted }]} numberOfLines={2}>
          {bookmark.description}
        </Text>
      )}

      <StatusHint bookmark={bookmark} />

      {bookmark.tags.length > 0 && (
        <View style={styles.tags}>
          {bookmark.tags.slice(0, 4).map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              tone={tag.source === "ai" ? "ai" : "neutral"}
            />
          ))}
          {bookmark.tags.length > 4 && (
            <Text style={[styles.more, { color: t.textFaint }]}>
              +{bookmark.tags.length - 4}
            </Text>
          )}
        </View>
      )}

      <Pressable
        onPress={onToggleFavourite}
        hitSlop={10}
        style={styles.fav}
        accessibilityRole="button"
        accessibilityLabel={
          bookmark.favourited ? "Retirer des favoris" : "Ajouter aux favoris"
        }
      >
        <Ionicons
          name={bookmark.favourited ? "star" : "star-outline"}
          size={19}
          color={bookmark.favourited ? t.warning : t.textFaint}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", gap: spacing.md },
  headerText: { flex: 1, gap: 2, paddingRight: spacing.xl },
  title: { fontSize: 15.5, fontWeight: "700", lineHeight: 21 },
  meta: { fontSize: 12 },
  thumb: { width: 62, height: 62, borderRadius: radius.md },
  desc: { fontSize: 13.5, lineHeight: 19 },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statusText: { fontSize: 12, flex: 1 },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginTop: 2,
  },
  more: { fontSize: 11, fontWeight: "600" },
  fav: { position: "absolute", top: spacing.md, right: spacing.md, padding: 4 },
});
