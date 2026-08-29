import { Ionicons } from "@expo/vector-icons";
import { Text } from "react-native";

import { isIoniconName } from "./icons";

/** Affiche l'icône d'un thème, emoji ou nom d'Ionicons hérité. */
export function ThemeIcon({
  icon,
  size,
  color,
}: {
  icon: string | null;
  size: number;
  color: string;
}) {
  if (icon && isIoniconName(icon)) {
    const name = icon as keyof typeof Ionicons.glyphMap;
    // Un nom inconnu d'Ionicons ne rend rien du tout : mieux vaut le dossier.
    return (
      <Ionicons
        name={name in Ionicons.glyphMap ? name : "folder-outline"}
        size={size}
        color={color}
      />
    );
  }
  if (!icon) {
    return <Ionicons name="folder-outline" size={size} color={color} />;
  }
  // L'emoji porte ses propres couleurs ; `color` ne s'y applique pas.
  return <Text style={{ fontSize: size * 0.95 }}>{icon}</Text>;
}
