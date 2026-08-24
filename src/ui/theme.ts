import { useColorScheme } from "react-native";

export interface Theme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
  warning: string;
}

const light: Theme = {
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F5F9",
  border: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#475569",
  textFaint: "#94A3B8",
  accent: "#4F46E5",
  accentText: "#FFFFFF",
  danger: "#DC2626",
  success: "#059669",
  warning: "#D97706",
};

const dark: Theme = {
  bg: "#0B1120",
  surface: "#111827",
  surfaceAlt: "#1E293B",
  border: "#1F2937",
  text: "#F1F5F9",
  textMuted: "#94A3B8",
  textFaint: "#64748B",
  accent: "#818CF8",
  accentText: "#0B1120",
  danger: "#F87171",
  success: "#34D399",
  warning: "#FBBF24",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;
