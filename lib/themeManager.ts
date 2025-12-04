import { COLORS } from "../constants/theme";

// Keys saved to profiles.theme_key
export type ThemeKey = "default" | "forest" | "race" | "solar" | "midnight";

type PartialPalette = Partial<typeof COLORS>;

const BASE = { ...COLORS };

const THEMES: Record<ThemeKey, PartialPalette> = {
  default: {},

  forest: {
    ACCENT: "#22C55E",      // green
    ACCENT2: "#86EFAC",
    SUCCESS: "#22C55E",
  },

  race: {
    ACCENT: "#F05252",      // red/orange
    ACCENT2: "#FCA5A5",
    ERROR: "#F05252",
  },

  solar: {
    ACCENT: "#F59E0B",      // amber
    ACCENT2: "#FCD34D",
  },

  midnight: {
    ACCENT: "#60A5FA",      // soft blue
    ACCENT2: "#93C5FD",
  },
};

export function applyTheme(key: ThemeKey) {
  const patch = THEMES[key] || {};
  // Reset to base then patch so we don't accumulate drift
  Object.assign(COLORS, BASE, patch);
}

export function listThemes() {
  return [
    { key: "forest", label: "Forest" },
    { key: "race", label: "Race" },
    { key: "solar", label: "Solar" },
    { key: "midnight", label: "Midnight" },
  ] as { key: ThemeKey; label: string }[];
}
