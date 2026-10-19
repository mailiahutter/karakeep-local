import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { useTheme } from "../../src/ui/theme";

export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTitleStyle: { color: t.text },
        headerTintColor: t.accent,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border,
        },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textFaint,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mes tiroirs",
          tabBarLabel: "Tiroirs",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="file-tray-stacked-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="themes"
        options={{
          title: "Thèmes",
          // Remplacé par les tiroirs de l'accueil ; la gestion des thèmes
          // reste dans Réglages → Mes tiroirs.
          href: null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Rechercher",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="tags"
        options={{
          title: "Tags",
          // Les tags ne servent qu'à l'IA : plus d'onglet pour eux.
          href: null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Réglages",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
