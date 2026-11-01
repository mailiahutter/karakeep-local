import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, StyleSheet, Switch, Text, View } from "react-native";

import {
  modeStatus,
  requestAddTile,
  requestBatteryExemption,
  requestCallBlocking,
  requestModePermission,
  requestQuietAccess,
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
        À la place du mode avion : Karakeep seul garde internet et lit les
        pages la nuit. Pour tout le reste, comme en mode avion : internet coupé
        aux autres applications, appels entrants refusés (messagerie), SMS et
        notifications en silence jusqu'au matin. Le réveil sonne toujours, et
        on peut toujours appeler, y compris les urgences. Le mode reste actif
        jusqu'à ce que tu le désactives.
      </Text>
      <Requirement
        done={!!status.batteryExempt}
        label="Garder le réseau en veille (hors optimisation de batterie)"
        action="Autoriser"
        onPress={() => void requestBatteryExemption()}
      />
      <Requirement
        done={status.permitted}
        label="Couper internet aux autres applications"
        action="Autoriser"
        onPress={() => void requestModePermission()}
      />
      <Requirement
        done={!!status.blocksCalls}
        label="Refuser les appels entrants"
        action="Autoriser"
        onPress={() => void requestCallBlocking()}
      />
      <Requirement
        done={!!status.quietAccess}
        label="Silence : SMS et notifications (réveil excepté)"
        action="Autoriser"
        onPress={() => {
          requestQuietAccess();
          Alert.alert(
            "Dernière autorisation",
            "Dans la liste qui s'ouvre, active « Karakeep Local », puis reviens ici.",
          );
        }}
      />
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
            Activé à {nightStart || "l'heure de la séance"}, et le reste jusqu'à
            ce que tu le coupes avec le bouton des réglages rapides.
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

/** Une autorisation d'Android, accordée ou à accorder. */
function Requirement({
  done,
  label,
  action,
  onPress,
}: {
  done: boolean;
  label: string;
  action: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Row>
      <Ionicons
        name={done ? "checkmark-circle" : "ellipse-outline"}
        size={18}
        color={done ? t.success : t.warning}
      />
      <Text style={{ flex: 1, color: t.text, fontSize: 13.5 }}>{label}</Text>
      {!done && (
        <Text onPress={onPress} style={{ color: t.accent, fontWeight: "700" }}>
          {action}
        </Text>
      )}
    </Row>
  );
}

const styles = StyleSheet.create({
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  label: { fontSize: 15, fontWeight: "600" },
  hint: { fontSize: 12.5, lineHeight: 17, marginTop: spacing.xs },
});
