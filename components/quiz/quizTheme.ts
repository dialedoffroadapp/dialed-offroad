// components/quiz/quizTheme.ts
// Fixed dark palette for the quiz flow (design brief values). Like the intro
// overlay, the quiz ignores the app theme: it is the first thing a rider sees
// and must look identical on every device.
import {
  BarlowCondensed_700Bold,
  BarlowCondensed_900Black,
  BarlowCondensed_900Black_Italic,
} from "@expo-google-fonts/barlow-condensed";
import * as Font from "expo-font";
import type { TextStyle } from "react-native";

export const Q = {
  BG: "#0B0C10", // Carbon
  PANEL: "#111318", // Panel Dark
  INK: "#0C0D12", // recessed panels; also the dark text on a Dialed Blue fill
  TEXT: "#F5F7FC",
  STEEL: "#6B7280",
  BLUE: "#1D9BF0", // Dialed Blue: selection + the one primary action
  BORDER: "rgba(255,255,255,0.08)",
  BORDER_STRONG: "rgba(255,255,255,0.14)",
  /** Sibling dim level once an answer is tapped (spec: 45%). */
  DIM_OPACITY: 0.45,
} as const;

export const QUIZ_FONT = {
  black: "BarlowCondensed_900Black",
  blackItalic: "BarlowCondensed_900Black_Italic",
  bold: "BarlowCondensed_700Bold",
} as const;

/** useFonts map for app/quiz/_layout.tsx. */
export const QUIZ_FONT_MAP = {
  [QUIZ_FONT.black]: BarlowCondensed_900Black,
  [QUIZ_FONT.blackItalic]: BarlowCondensed_900Black_Italic,
  [QUIZ_FONT.bold]: BarlowCondensed_700Bold,
};

/** Barlow Condensed when loaded, else the closest system weight — the layout
 *  waits ~1.5 s for the fonts, so the fallback only shows on a slow first
 *  load, never a broken one. */
export function displayFont(
  variant: keyof typeof QUIZ_FONT = "black"
): TextStyle {
  const family = QUIZ_FONT[variant];
  let loaded = false;
  try {
    loaded = Font.isLoaded(family);
  } catch {
    loaded = false;
  }
  if (loaded) return { fontFamily: family };
  return {
    fontWeight: variant === "bold" ? "700" : "900",
    fontStyle: variant === "blackItalic" ? "italic" : "normal",
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16) || 0;
  const g = parseInt(n.substring(2, 4), 16) || 0;
  const b = parseInt(n.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Spec rhythm timings (ms). */
export const RHYTHM = {
  fill: 120,
  dimSiblings: 100,
  hold: 250,
} as const;
