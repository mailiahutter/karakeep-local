import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import CookieManager from "@react-native-cookies/cookies";

import { Button, Card, Row } from "../../src/ui/components";
import { spacing, useTheme } from "../../src/ui/theme";

/**
 * Connexion à Instagram dans l'application.
 *
 * Instagram sert un mur de connexion aux visiteurs anonymes : sans session, la
 * page d'une publication ne contient ni légende ni carrousel. Le cookie déposé
 * ici est partagé avec la WebView d'archivage, qui pourra alors voir les
 * publications comme toi.
 *
 * L'identifiant et le mot de passe sont saisis sur le site d'Instagram
 * lui-même, dans la WebView : l'application ne les voit jamais et n'en
 * conserve rien.
 */
const LOGIN_URL = "https://www.instagram.com/accounts/login/";

export default function InstagramLoginScreen() {
  const t = useTheme();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const checked = useRef(false);

  const checkSession = async (url: string) => {
    // Instagram redirige vers l'accueil une fois la session ouverte.
    if (checked.current) return;
    if (/instagram\.com\/(\?|$)|accounts\/onetap/.test(url)) {
      checked.current = true;
      try {
        const cookies = await CookieManager.get("https://www.instagram.com");
        if (cookies.sessionid?.value) {
          setLoggedIn(true);
        }
      } catch {
        // En cas de doute on laisse l'utilisateur juger au rendu.
      }
      checked.current = false;
    }
  };

  const signOut = async () => {
    await CookieManager.clearAll();
    setLoggedIn(false);
    Alert.alert(
      "Session fermée",
      "Les publications non publiques ne seront plus accessibles.",
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Card style={styles.intro}>
        <Row>
          <Ionicons
            name={loggedIn ? "checkmark-circle" : "information-circle-outline"}
            size={20}
            color={loggedIn ? t.success : t.textMuted}
          />
          <Text style={[styles.title, { color: t.text }]}>
            {loggedIn ? "Session ouverte" : "Connexion à Instagram"}
          </Text>
        </Row>
        <Text style={[styles.body, { color: t.textMuted }]}>
          {loggedIn
            ? "Les publications seront désormais capturées avec leur légende et leur carrousel complet."
            : "Sans session, Instagram remplace le contenu par un mur de connexion : ni légende, ni carrousel. Tes identifiants sont saisis sur le site d'Instagram, l'application ne les voit pas."}
        </Text>
        {loggedIn && (
          <Button
            label="Fermer la session"
            icon="log-out-outline"
            variant="danger"
            onPress={() => void signOut()}
          />
        )}
        {loggedIn && (
          <Button label="Terminé" icon="checkmark" onPress={() => router.back()} />
        )}
      </Card>

      {!loggedIn && (
        <WebView
          source={{ uri: LOGIN_URL }}
          onNavigationStateChange={(nav) => void checkSession(nav.url)}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          style={styles.web}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: { margin: spacing.lg, marginBottom: 0 },
  title: { fontSize: 16, fontWeight: "700", flex: 1 },
  body: { fontSize: 13.5, lineHeight: 19 },
  web: { flex: 1, marginTop: spacing.lg },
});
