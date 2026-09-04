// components/v3/theme.ts
// The 3.0 Home + Garage design system, lifted value-for-value from
// design/mockups/dialed.css (the visual source of truth). Fixed dark palette:
// these screens ignore the app theme like the intro overlay does.
import {
  BarlowCondensed_900Black_Italic,
} from "@expo-google-fonts/barlow-condensed";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import * as Font from "expo-font";
import { useFonts } from "expo-font";
import { useEffect, useState } from "react";
import type { TextStyle } from "react-native";

/* :root tokens */
export const V3 = {
  carbon: "#0B0C10",
  panel: "#111318",
  panel2: "#1B1E24",
  hair: "#1B1E24",
  line: "#2A2E36",
  blue: "#1D9BF0",
  blueDim: "#0B3A5C",
  white: "#F5F7FC",
  steel: "#8A93A6",
  muted: "#3A4150",
  brand: {
    KTM: "#FF6600",
    Yamaha: "#3D7BFF",
    Honda: "#FF4D4F",
    Kawasaki: "#46C25B",
    Husqvarna: "#F5F7FC",
    GasGas: "#E53131",
    Suzuki: "#F2D13D",
    Beta: "#E62B2B",
    Sherco: "#2B61FF",
    "TM Racing": "#2B9CFF",
    Stark: "#E6342A",
  } as Record<string, string>,
  /* .phone padding: 56px 20px 24px */
  screenPadX: 20,
  cardRadius: 16,
  cardPad: 16,
  cardGap: 12,
} as const;

export function brandColor(make: string | null | undefined): string {
  return (make && V3.brand[make]) || V3.steel;
}

export const V3_FONT = {
  heading: "BarlowCondensed_900Black_Italic",
  inter: "Inter_400Regular",
  interMedium: "Inter_500Medium",
  interSemi: "Inter_600SemiBold",
  interBold: "Inter_700Bold",
} as const;

export const V3_FONT_MAP = {
  [V3_FONT.heading]: BarlowCondensed_900Black_Italic,
  [V3_FONT.inter]: Inter_400Regular,
  [V3_FONT.interMedium]: Inter_500Medium,
  [V3_FONT.interSemi]: Inter_600SemiBold,
  [V3_FONT.interBold]: Inter_700Bold,
};

const FONT_WAIT_MS = 1500;

/** Load the pack once (expo-font caches); resolves true on load, error, or
 *  after a short wait so a slow first load never blanks a screen. */
export function useV3Fonts(): boolean {
  const [loaded, error] = useFonts(V3_FONT_MAP);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), FONT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  return loaded || !!error || timedOut;
}

function has(family: string): boolean {
  try {
    return Font.isLoaded(family);
  } catch {
    return false;
  }
}

/** Barlow Condensed Black Italic — headings ONLY (README rule). */
export function headingFont(): TextStyle {
  return has(V3_FONT.heading)
    ? { fontFamily: V3_FONT.heading }
    : { fontWeight: "900", fontStyle: "italic" };
}

/** Inter at a given weight. Numbers are ALWAYS Inter 700, regular width. */
export function interFont(weight: 400 | 500 | 600 | 700 = 400): TextStyle {
  const family =
    weight === 700
      ? V3_FONT.interBold
      : weight === 600
        ? V3_FONT.interSemi
        : weight === 500
          ? V3_FONT.interMedium
          : V3_FONT.inter;
  return has(family)
    ? { fontFamily: family }
    : { fontWeight: String(weight) as TextStyle["fontWeight"] };
}

/* Type scale (dialed.css) */
export const T = {
  eyebrow: { fontSize: 11, letterSpacing: 2, textTransform: "uppercase" as const },
  h1: { fontSize: 32, lineHeight: 32 },
  label: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" as const },
  bigXl: 76,
  bigLg: 34,
  bigMd: 26,
  numLg: 30,
  numMd: 26,
  unit: 12,
  text: 14,
  sub: 13,
  small: 12,
  btn: 17,
} as const;
