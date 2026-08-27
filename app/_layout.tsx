import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ShareIntentProvider } from "expo-share-intent";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";

import { WebArchiver } from "../src/archive/WebArchiver";
import { ShareIntentHandler } from "../src/ui/ShareIntentHandler";
import { useTheme } from "../src/ui/theme";

export default function RootLayout() {
  const scheme = useColorScheme();
  const t = useTheme();

  return (
    <ShareIntentProvider
      options={{
        debug: false,
        // Le partage arrive dans l'app déjà ouverte : on la ramène au premier
        // plan plutôt que d'empiler une seconde instance.
        resetOnBackground: true,
      }}
    >
      <SafeAreaProvider>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <ShareIntentHandler />
        {/* Moteur de rendu hors écran : doit rester monté pour que la file
            d'archivage soit consommée, quel que soit l'écran affiché. */}
        <WebArchiver />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.surface },
            headerTitleStyle: { color: t.text },
            headerTintColor: t.accent,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="bookmark/[id]"
            options={{ title: "", headerBackTitle: "Retour" }}
          />
          <Stack.Screen
            name="add"
            options={{ title: "Ajouter un lien", presentation: "modal" }}
          />
          <Stack.Screen name="settings/model" options={{ title: "Modèle IA" }} />
          <Stack.Screen name="theme/[id]" options={{ title: "Thème" }} />
          <Stack.Screen
            name="settings/instagram"
            options={{ title: "Compte Instagram" }}
          />
          <Stack.Screen
            name="settings/update"
            options={{ title: "Mise à jour" }}
          />
        </Stack>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
