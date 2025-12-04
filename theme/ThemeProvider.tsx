// theme/ThemeProvider.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';


import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, ColorSchemeName } from "react-native";

type Palette = {
  bg: string;
  surface: string;
  text: string;
  textDim: string;
  border: string;
  primary: string;        // purple accent
  cardShadow: string;
};

const light: Palette = {
  bg: "#F3F4F7",
  surface: "#FFFFFF",
  text: "#0E1116",
  textDim: "#6D7280",
  border: "#E5E7EB",
  primary: "#6C63FF",
  cardShadow: "rgba(17, 24, 39, 0.06)",
};

const dark: Palette = {
  bg: "#0B0C0F",
  surface: "#121418",
  text: "#F2F5F5",
  textDim: "#9AA2B1",
  border: "#1F2937",
  primary: "#B28DFF",
  cardShadow: "rgba(0,0,0,0.6)",
};

type ThemeContextType = {
  scheme: "light" | "dark";
  colors: Palette;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);
const KEY = "dialed.theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = Appearance.getColorScheme() as ColorSchemeName;
  const [scheme, setScheme] = useState<"light" | "dark">((system ?? "light") as any);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setScheme(saved);
      else if (system) setScheme(system as "light" | "dark");
    })();
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      // only apply system if user hasn’t chosen yet
      AsyncStorage.getItem(KEY).then(val => {
        if (!val && colorScheme) setScheme(colorScheme as "light" | "dark");
      });
    });
    return () => sub.remove();
  }, []);

  const toggle = async () => {
    const next = scheme === "light" ? "dark" : "light";
    setScheme(next);
    await AsyncStorage.setItem(KEY, next);
  };

  const value = useMemo(
    () => ({ scheme, colors: scheme === "light" ? light : dark, toggle }),
    [scheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
