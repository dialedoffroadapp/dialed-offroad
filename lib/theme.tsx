// lib/theme.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { Appearance, ColorSchemeName } from "react-native";
import { buildTheme, ThemeTokens } from "../constants/theme";

type Mode = "system" | "light" | "dark";

type ThemeContextValue = {
  mode: Mode;
  accent: string;
  colors: ThemeTokens;
  setMode: (m: Mode) => void;
  setAccent: (hex: string) => void;
  toggleMode: () => void;
  ready: boolean;
};

const THEME_PREF_KEY = "THEME_PREF_V1";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>("system");
  const [accent, setAccentState] = useState<string>("#1D9BF0");
  const [osScheme, setOsScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme()
  );
  const [ready, setReady] = useState(false);

  // hydrate
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_PREF_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { mode?: Mode; accent?: string };
          if (parsed.mode) setModeState(parsed.mode);
          if (parsed.accent) setAccentState(parsed.accent);
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // track OS scheme
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setOsScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const persist = useCallback(async (m: Mode, a: string) => {
    try {
      await AsyncStorage.setItem(
        THEME_PREF_KEY,
        JSON.stringify({ mode: m, accent: a })
      );
    } catch {}
  }, []);

  const setMode = useCallback(
    (m: Mode) => {
      setModeState(m);
      persist(m, accent);
    },
    [accent, persist]
  );

  const setAccent = useCallback(
    (hex: string) => {
      setAccentState(hex);
      persist(mode, hex);
    },
    [mode, persist]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");
  }, [mode, setMode]);

  const effective = mode === "system" ? (osScheme === "dark" ? "dark" : "light") : mode;
  const colors = useMemo(() => buildTheme(effective, accent), [effective, accent]);

  const value: ThemeContextValue = useMemo(
    () => ({ mode, accent, colors, setMode, setAccent, toggleMode, ready }),
    [mode, accent, colors, setMode, setAccent, toggleMode, ready]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
