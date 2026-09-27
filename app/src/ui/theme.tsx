import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, useColorScheme } from "react-native";
import { secureStorage } from "@/lib/store/secureStorage";

export type Palette = {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  raised: string;
  overlay: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  muted: string;
  faint: string;
  /** Brand accent for fills (badges, active chips); `accentText` is its readable foreground variant. */
  accent: string;
  accentText: string;
  accentInk: string;
  primary: string;
  primaryInk: string;
  success: string;
  warn: string;
  danger: string;
  dangerBg: string;
  userBubble: string;
  scrim: string;
  shadow: string;
  botHues: readonly string[];
};

export const lightColors: Palette = {
  scheme: "light",
  bg: "#FFFFFF",
  surface: "#F6F6F7",
  raised: "#EDEDF0",
  overlay: "#FFFFFF",
  border: "#E6E6EA",
  borderStrong: "#D4D4DA",
  text: "#0B0B0D",
  textSoft: "#3A3A42",
  muted: "#6B6B75",
  faint: "#9D9DA6",
  accent: "#D99A2B",
  accentText: "#9A6200",
  accentInk: "#FFFFFF",
  primary: "#0B0B0D",
  primaryInk: "#FFFFFF",
  success: "#15803D",
  warn: "#B45309",
  danger: "#DC2626",
  dangerBg: "#FEF1F1",
  userBubble: "#F0F0F3",
  scrim: "rgba(10,10,15,0.32)",
  shadow: "rgba(15,15,25,0.14)",
  botHues: ["#B7791F", "#2F6FDB", "#15803D", "#C2366B", "#7148D6", "#0E8AA8", "#C8551B", "#9A7A12", "#4E8A1C", "#D1344F"],
};

export const darkColors: Palette = {
  scheme: "dark",
  bg: "#000000",
  surface: "#0D0D0F",
  raised: "#161618",
  overlay: "#1E1E21",
  border: "#232327",
  borderStrong: "#34343A",
  text: "#F4F4F5",
  textSoft: "#C9C9CE",
  muted: "#8A8A93",
  faint: "#5B5B63",
  accent: "#E7B86A",
  accentText: "#E7B86A",
  accentInk: "#1A1306",
  primary: "#F4F4F5",
  primaryInk: "#000000",
  success: "#6BD49A",
  warn: "#F2C14E",
  danger: "#F26D6D",
  dangerBg: "#2A1213",
  userBubble: "#1E1E21",
  scrim: "rgba(0,0,0,0.6)",
  shadow: "rgba(0,0,0,0.5)",
  botHues: ["#E7B86A", "#7AA2F7", "#6BD49A", "#F28FAD", "#B69CFF", "#5CCFE6", "#FF9E64", "#E0AF68", "#9ECE6A", "#F7768E"],
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

function makeType(c: Palette) {
  return {
    display: { fontSize: 30, fontWeight: "700" as const, letterSpacing: -0.6, color: c.text },
    title: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.3, color: c.text },
    heading: { fontSize: 16, fontWeight: "600" as const, color: c.text },
    body: { fontSize: 16, lineHeight: 24, color: c.text },
    small: { fontSize: 13, lineHeight: 18, color: c.muted },
    caption: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.8, color: c.faint },
    mono: { fontFamily: mono, fontSize: 13 },
  };
}
export type Typography = ReturnType<typeof makeType>;

const lightType = makeType(lightColors);
const darkType = makeType(darkColors);

/** Stable identity colour per bot so each agent is recognisable at a glance, tuned per scheme. */
export function botColor(name: string, colors: Palette) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors.botHues[hash % colors.botHues.length];
}

export type ThemePreference = "light" | "dark" | "system";

type ThemeValue = {
  colors: Palette;
  type: Typography;
  scheme: "light" | "dark";
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const PREF_KEY = "hermes.theme";

const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  type: lightType,
  scheme: "light",
  preference: "light",
  setPreference: () => undefined,
});

/** Light by default; Dark or "match system" are opt-in from Settings → Appearance. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("light");

  useEffect(() => {
    secureStorage
      .get(PREF_KEY)
      .then((saved) => {
        if (saved === "light" || saved === "dark" || saved === "system") setPreferenceState(saved);
      })
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    secureStorage.set(PREF_KEY, next).catch(() => undefined);
  }, []);

  const scheme: "light" | "dark" = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  const value = useMemo<ThemeValue>(
    () => ({
      colors: scheme === "dark" ? darkColors : lightColors,
      type: scheme === "dark" ? darkType : lightType,
      scheme,
      preference,
      setPreference,
    }),
    [scheme, preference, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Theme-aware StyleSheet: `const useStyles = makeStyles((colors, type) => ({ ... }))` at module
 * scope, then `const styles = useStyles()` inside the component. One sheet is built per scheme.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (colors: Palette, type: Typography) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { colors, type } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors, type));
      cache.set(colors, styles);
    }
    return styles;
  };
}
