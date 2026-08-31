import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listAssets, type Asset } from "../src/db/assets";
import { getBookmark } from "../src/db/bookmarks";
import {
  NO_VERDICT,
  pendingReviewIds,
  saveReview,
  type Verdicts,
} from "../src/db/reviews";
import type { Bookmark } from "../src/db/types";
import { hostLabel } from "../src/db/urls";
import { buildSnapshot } from "../src/feedback/collect";
import type { ReviewSnapshot, Verdict } from "../src/feedback/format";
import { AssetViewer } from "../src/ui/AssetViewer";
import { Button, Card, Chip, Row } from "../src/ui/components";
import { notifyBookmarksChanged } from "../src/ui/events";
import { radius, spacing, useTheme } from "../src/ui/theme";

/**
 * Relecture des propositions du modèle.
 *
 * Un reproche formulé sur le moment vaut mieux qu'un souvenir : c'est ici que
 * se dit ce que le classement, les tags ou les images ont raté, lien par lien.
 * Ce qui est jugé est la proposition figée au moment de l'avis, pas l'état
 * courant de la fiche.
 */

const ASPECTS = [
  { key: "theme", label: "Rangement par thème" },
  { key: "tags", label: "Tags" },
  { key: "media", label: "Images et vidéos" },
  { key: "summary", label: "Résumé et texte" },
] as const;

export default function ReviewScreen() {
  const t = useTheme();
  const router = useRouter();

  const [queue, setQueue] = useState<string[]>([]);
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [verdicts, setVerdicts] = useState<Verdicts>(NO_VERDICT);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    void (async () => {
      setQueue(await pendingReviewIds(30));
      setLoading(false);
    })();
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (!current) {
      setBookmark(null);
      setSnapshot(null);
      setAssets([]);
      return;
    }
    void (async () => {
      setBookmark(await getBookmark(current));
      setSnapshot(await buildSnapshot(current));
      setAssets(await listAssets(current));
      setVerdicts(NO_VERDICT);
      setComment("");
    })();
  }, [current]);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    setDone((n) => n + 1);
  }, []);

  const submit = useCallback(
    async (keepOpinion: boolean) => {
      if (!current || !snapshot) return;
      setBusy(true);
      try {
        await saveReview(
          current,
          keepOpinion ? verdicts : NO_VERDICT,
          keepOpinion ? comment : null,
          snapshot,
        );
        advance();
      } catch (err) {
        Alert.alert("Avis non enregistré", (err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [advance, comment, current, snapshot, verdicts],
  );

  // Archive et capture d'écran ne sont pas des illustrations : ce qui se juge
  // ici, ce sont les images et vidéos retenues du contenu lui-même.
  const visual = assets.filter((a) => a.kind === "image" || a.kind === "video");

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  if (!current || !bookmark) {
    return (
      <View style={[styles.empty, { backgroundColor: t.bg }]}>
        <Ionicons name="checkmark-circle-outline" size={44} color={t.success} />
        <Text style={[styles.emptyTitle, { color: t.text }]}>
          {done > 0 ? "Tout est relu" : "Rien à relire"}
        </Text>
        <Text style={[styles.emptyText, { color: t.textMuted }]}>
          {done > 0
            ? `${done} lien${done > 1 ? "s" : ""} passé${done > 1 ? "s" : ""} en revue. Pense à transmettre tes retours depuis Réglages → Retours sur l'IA.`
            : "Les liens analysés apparaîtront ici, pour que tu dises si le rangement et les tags tombent juste."}
        </Text>
        <Button
          label="Fermer"
          variant="secondary"
          onPress={() => {
            notifyBookmarksChanged();
            router.back();
          }}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <ScrollView
      ref={scroller}
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.progress, { color: t.textFaint }]}>
        {done + 1} sur {done + queue.length}
      </Text>

      <Card>
        <Row>
          {(bookmark.thumbnailPath ?? bookmark.imageUrl) && (
            <Image
              source={{ uri: bookmark.thumbnailPath ?? bookmark.imageUrl! }}
              style={[styles.thumb, { backgroundColor: t.surfaceAlt }]}
            />
          )}
          <View style={styles.grow}>
            <Text style={[styles.title, { color: t.text }]} numberOfLines={3}>
              {bookmark.title ?? bookmark.url}
            </Text>
            <Text style={[styles.host, { color: t.textFaint }]}>
              {hostLabel(bookmark.url) ?? bookmark.url}
            </Text>
          </View>
        </Row>
        {/* « Instagram » comme titre ne dit rien du contenu : c'est l'extrait
            qui permet de juger le rangement. */}
        {(bookmark.description ?? bookmark.content) && (
          <Text style={[styles.excerpt, { color: t.textMuted }]} numberOfLines={6}>
            {bookmark.description ?? bookmark.content}
          </Text>
        )}
      </Card>

      <Aspect
        label="Rangement par thème"
        value={verdicts.theme}
        onChange={(v) => setVerdicts((s) => ({ ...s, theme: v }))}
      >
        <Text style={[styles.proposal, { color: snapshot?.theme ? t.text : t.textFaint }]}>
          {snapshot?.theme ?? "Aucun thème proposé"}
        </Text>
        <Text style={[styles.hint, { color: t.textFaint }]}>
          {snapshot?.subject
            ? `Le modèle a compris : « ${snapshot.subject} »`
            : "Le modèle n'a rien compris du document."}
        </Text>
      </Aspect>

      <Aspect
        label="Tags"
        value={verdicts.tags}
        onChange={(v) => setVerdicts((s) => ({ ...s, tags: v }))}
      >
        {snapshot && snapshot.tags.length > 0 ? (
          <View style={styles.chips}>
            {snapshot.tags.map((tag) => (
              <Chip key={tag} label={tag} tone="ai" />
            ))}
          </View>
        ) : (
          <Text style={[styles.proposal, { color: t.textFaint }]}>
            Aucun tag proposé
          </Text>
        )}
      </Aspect>

      <Aspect
        label="Images et vidéos"
        value={verdicts.media}
        onChange={(v) => setVerdicts((s) => ({ ...s, media: v }))}
      >
        {visual.length > 0 ? (
          <>
            {/* Une liste de tailles de fichiers ne permet pas de juger une
                image. Il faut la voir, et pouvoir l'ouvrir en grand. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Row>
                {visual.map((asset) => (
                  <Pressable
                    key={asset.id}
                    onPress={() =>
                      setViewing(assets.findIndex((a) => a.id === asset.id))
                    }
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Ouvrir ${asset.kind}`}
                  >
                    <Image
                      source={{ uri: asset.path }}
                      style={[styles.media, { backgroundColor: t.surfaceAlt }]}
                    />
                    {asset.kind === "video" && (
                      <View style={styles.playBadge}>
                        <Ionicons name="play" size={16} color="#fff" />
                      </View>
                    )}
                  </Pressable>
                ))}
              </Row>
            </ScrollView>
            <Text style={[styles.hint, { color: t.textFaint }]}>
              Touche une vignette pour l'ouvrir en grand.
            </Text>
          </>
        ) : (
          <Text style={[styles.proposal, { color: t.textFaint }]}>
            Aucune image ni vidéo conservée
          </Text>
        )}
      </Aspect>

      <Aspect
        label="Résumé et texte"
        value={verdicts.summary}
        onChange={(v) => setVerdicts((s) => ({ ...s, summary: v }))}
      >
        <Text
          style={[styles.proposal, { color: snapshot?.summary ? t.text : t.textFaint }]}
        >
          {snapshot?.summary ?? "Aucun résumé produit"}
        </Text>
      </Aspect>

      <Card>
        <Text style={[styles.aspectLabel, { color: t.textMuted }]}>
          Commentaire
        </Text>
        <Text style={[styles.hint, { color: t.textFaint }]}>
          Ce qui aurait dû se passer. C'est la partie la plus utile.
        </Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          // Le champ était masqué par le clavier, ce qui rendait la saisie
          // impossible à relire — donc le retour lui-même impossible à écrire.
          onFocus={() =>
            setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 150)
          }
          placeholder="Ça parle de chiens, pas de bricolage. Le thème Maison ne convient pas."
          placeholderTextColor={t.textFaint}
          multiline
          style={[
            styles.input,
            { color: t.text, borderColor: t.border, backgroundColor: t.surface },
          ]}
        />
      </Card>

      <Row>
        <Button
          label="Passer"
          variant="ghost"
          disabled={busy}
          style={styles.grow}
          onPress={() => void submit(false)}
        />
        <Button
          label="Enregistrer"
          icon="checkmark"
          loading={busy}
          style={styles.grow}
          onPress={() => void submit(true)}
        />
      </Row>

      <Button
        label="Voir la fiche"
        icon="open-outline"
        variant="secondary"
        onPress={() => router.push(`/bookmark/${bookmark.id}`)}
      />
      </ScrollView>

      {viewing !== null && (
        <AssetViewer
          assets={assets}
          startIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/** Un aspect jugé : la proposition, puis le verdict. */
function Aspect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: Verdict;
  onChange: (value: Verdict) => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Card>
      <Text style={[styles.aspectLabel, { color: t.textMuted }]}>{label}</Text>
      {children}
      <Row style={styles.verdicts}>
        <VerdictButton
          icon="thumbs-up"
          label="Correct"
          active={value === "good"}
          tint={t.success}
          // Un second appui retire l'avis : se tromper de bouton ne doit pas
          // figer un jugement faux.
          onPress={() => onChange(value === "good" ? null : "good")}
        />
        <VerdictButton
          icon="thumbs-down"
          label="À revoir"
          active={value === "bad"}
          tint={t.danger}
          onPress={() => onChange(value === "bad" ? null : "bad")}
        />
      </Row>
    </Card>
  );
}

function VerdictButton({
  icon,
  label,
  active,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  tint: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.verdict,
        {
          borderColor: active ? tint : t.border,
          backgroundColor: active ? t.surfaceAlt : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={active ? icon : (`${icon}-outline` as keyof typeof Ionicons.glyphMap)}
        size={18}
        color={active ? tint : t.textMuted}
      />
      <Text style={[styles.verdictLabel, { color: active ? tint : t.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  progress: { fontSize: 12.5, fontWeight: "700", textAlign: "center" },
  grow: { flex: 1 },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  title: { fontSize: 15.5, fontWeight: "700" },
  host: { fontSize: 12.5, marginTop: 2 },
  aspectLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  proposal: { fontSize: 14.5, lineHeight: 20 },
  hint: { fontSize: 12, lineHeight: 16 },
  excerpt: { fontSize: 13.5, lineHeight: 19, marginTop: spacing.sm },
  media: { width: 96, height: 96, borderRadius: radius.md },
  playBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000A",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  verdicts: { marginTop: spacing.sm },
  verdict: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  verdictLabel: { fontSize: 13.5, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 88,
    textAlignVertical: "top",
    fontSize: 15,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
