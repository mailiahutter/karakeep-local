import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { WebView } from "react-native-webview";

import type { Asset } from "../db/assets";
import { spacing, useTheme } from "./theme";

/**
 * Consultation plein écran des pièces conservées.
 *
 * Sans cet écran, l'archivage n'a aucune valeur d'usage : les fichiers
 * existent sur l'appareil mais rien ne permet de les ouvrir. Les trois natures
 * de pièce demandent chacune un rendu propre — image, vidéo, page archivée.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function VideoPane({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <View style={styles.pane}>
      <VideoView
        player={player}
        style={styles.media}
        contentFit="contain"
        nativeControls
      />
    </View>
  );
}

function ImagePane({ uri }: { uri: string }) {
  const [loading, setLoading] = useState(true);
  const t = useTheme();
  return (
    <View style={styles.pane}>
      {loading && (
        <ActivityIndicator style={styles.spinner} color={t.accent} size="large" />
      )}
      <Image
        source={{ uri }}
        style={styles.media}
        resizeMode="contain"
        onLoadEnd={() => setLoading(false)}
      />
    </View>
  );
}

function ArchivePane({ uri }: { uri: string }) {
  const t = useTheme();
  return (
    <View style={[styles.pane, styles.archive, { backgroundColor: t.surface }]}>
      <WebView
        // La page a été enregistrée avec ses styles et ses images intégrés :
        // elle s'affiche sans réseau, même si le site a disparu.
        source={{ uri }}
        originWhitelist={["*"]}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        // Rien ne doit être rechargé depuis Internet : l'archive doit se
        // suffire à elle-même, et c'est le seul moyen de le constater.
        javaScriptEnabled={false}
        style={styles.web}
      />
    </View>
  );
}

export function AssetViewer({
  assets,
  startIndex,
  onClose,
}: {
  assets: Asset[];
  startIndex: number;
  onClose: () => void;
}) {
  const t = useTheme();
  const [index, setIndex] = useState(startIndex);
  const listRef = useRef<FlatList<Asset>>(null);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
  }, []);

  const current = assets[index];
  const label = useMemo(() => {
    if (!current) return "";
    const names: Record<string, string> = {
      screenshot: "Capture d'écran",
      image: "Image",
      video: "Vidéo",
      archive: "Page archivée",
      pdf: "PDF",
    };
    return `${names[current.kind] ?? current.kind} · ${index + 1} sur ${assets.length}`;
  }, [current, index, assets.length]);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={assets}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({
            length: SCREEN_W,
            offset: SCREEN_W * i,
            index: i,
          })}
          onMomentumScrollEnd={onScroll}
          keyExtractor={(a) => a.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            if (item.kind === "video") return <VideoPane uri={item.path} />;
            if (item.kind === "archive" || item.kind === "pdf") {
              return <ArchivePane uri={item.path} />;
            }
            return <ImagePane uri={item.path} />;
          }}
        />

        <View style={styles.bar} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            style={styles.close}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000000" },
  pane: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: "center",
    justifyContent: "center",
  },
  media: { width: SCREEN_W, height: SCREEN_H * 0.8 },
  spinner: { position: "absolute" },
  archive: { paddingTop: 76 },
  web: { width: SCREEN_W, flex: 1 },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: 44,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  close: { padding: 4 },
  label: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flex: 1 },
});
