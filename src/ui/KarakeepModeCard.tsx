import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, StyleSheet, Switch, Text, View } from "react-native";

import {
  modeStatus,
  requestAddTile,
  requestModePermission,
  setModeActive,
  setModeAuto,
  type ModeStatus,
} from "../../modules/karakeep-worker/src";
import { Button, Card, Row } from "./components";
import { spacing, useTheme } from "./theme";

/**
 * « Mode Karakeep » : à la place du mode avion, internet coupé pour toutes
 * les applications sauf Karakeep (voir `KarakeepModeService.kt`).
 */
export function KarakeepModeCard({ nightStart }: { nightStart: string }) {
  const t = useTheme();
  const [status, setStatus] = useState<ModeStatus | null>(modeStatus());
  const refresh = useCallback(() => setStatus(modeStatus()), []);

  useFocusEffect(refresh);
  // Au retour de la fenêtre d'autorisation d'Android.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => sub.remove();
  }, [refresh]);

  if (!status) return null;

  const ensurePermission = (): boolean => {
    if (status.permitted) return true;
    requestModePermission();
    Alert.alert(
      "Une autorisation d'Android",
      "Android va demander si Karakeep peut « créer une connexion VPN ». C'est ce qui permet de couper internet aux autres applications : rien ne sort du téléphone, rien n'est lu. Accepte, puis touche de nouveau le bouton.",
    );
    return false;
  };

  return (
    <Card>
      <Row>
        <Ionicons name="moon-outline" size={19} color={t.accent} />
        <Text style={[styles.title, { color: t.text }]}>Mode Karakeep</Text>
        <Text style={{ color: status.active ? t.success : t.textFaint, fontWeight: "700" }}>
          {status.active ? "Actif" : "Inactif"}
        </Text>
      </Row>
      <Text style={[styles.hint, { color: t.textMuted }]}>
        À la place du mode avion : internet est coupé pour toutes les autres
        applications — plus de notifications ni de mises à jour —, Karakeep
        seul garde le Wi-Fi et lit les pages la nuit. Les appels et SMS ne
        passent pas par internet et ne sont pas coupés : pour eux, le mode
        « Ne pas déranger » d'Android.
      </Text>
      <Button
        label={status.active ? "Désactiver maintenant" : "Activer maintenant"}
        icon={status.active ? "wifi" : "moon"}
        variant={status.active ? "secondary" : "primary"}
        onPress={() => {
          if (!status.active && !ensurePermission()) return;
          setModeActive(!status.active);
          setTimeout(refresh, 500);
        }}
      />
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.label, { color: t.text }]}>Automatique chaque nuit</Text>
          <Text style={[styles.hint, { color: t.textMuted }]}>
            Activé à {nightStart || "l'heure de la séance"}, coupé à 7 h.
          </Text>
        </View>
        <Switch
          value={status.auto}
          onValueChange={(v) => {
            if (v && !ensurePermission()) return;
            setModeAuto(v);
            refresh();
          }}
          trackColor={{ true: t.accent, false: t.border }}
        />
      </Row>
      <Button
        label="Ajouter le bouton aux réglages rapides"
        icon="add-circle-outline"
        variant="ghost"
        onPress={() => {
          if (!requestAddTile()) {
            Alert.alert(
              "Bouton des réglages rapides",
              "Déroule le haut de l'écran deux fois, touche le crayon (Modifier), puis fais glisser « Mode Karakeep » à côté du mode avion.",
            );
          }
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  label: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12.5, lineHeight: 17, marginTop: spacing.xs },
});
