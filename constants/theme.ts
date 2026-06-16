// constants/theme.ts
export type ThemeMode = "light" | "dark";

export type ThemeTokens = {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  OVERLAY: string;
  INK: string;        // neutral/dim surface
  ACCENT: string;
  SUCCESS: string;
  ERROR: string;
  ACCENT2?: string;
  ACCENT3?: string;
  CHIP_BG?: string;
  TRACK?: string;
  BORDER_SUBTLE?: string;
  SURFACE_ALT?: string;
  // Optional inputs used in a few places
  INPUT_BG?: string;
  INPUT_TEXT?: string;
};

export const lightTheme: Omit<ThemeTokens, "ACCENT"> = {
  BG: "#F7F8FC",
  CARD: "#FFFFFF",
  TEXT: "#0B0C10",
  MUTED: "#5D6475",
  BORDER: "rgba(10,12,16,0.12)",
  OVERLAY: "rgba(0,0,0,0.45)",
  INK: "#E9ECF5",

  SUCCESS: "#16A34A",
  ERROR: "#EF4444",

  ACCENT2: "#2563EB",
  ACCENT3: "#10B981",
  CHIP_BG: "rgba(0,0,0,0.06)",
  TRACK: "rgba(0,0,0,0.08)",
  BORDER_SUBTLE: "rgba(0,0,0,0.06)",
  SURFACE_ALT: "#F2F4FA",

  // new: inputs so text fields aren't too dark in Light
  INPUT_BG: "#F2F4FA",
  INPUT_TEXT: "#0B0C10",
};

export const darkTheme: Omit<ThemeTokens, "ACCENT"> = {
  BG: "#0B0C10",
  CARD: "#111318",
  TEXT: "#F5F7FC",
  MUTED: "#6B7280",
  BORDER: "rgba(255,255,255,0.06)",
  OVERLAY: "rgba(0,0,0,0.55)",
  INK: "#0C0D12",

  SUCCESS: "#22C55E",
  ERROR: "#F05252",

  ACCENT2: "#7CC6FF",
  ACCENT3: "#22C55E",
  CHIP_BG: "rgba(255,255,255,0.05)",
  TRACK: "rgba(255,255,255,0.06)",
  BORDER_SUBTLE: "rgba(255,255,255,0.05)",
  SURFACE_ALT: "#0C0D12",

  INPUT_BG: "#0C0D12",
  INPUT_TEXT: "#F5F7FC",
};

// Build a full palette given mode + accent
export const buildTheme = (mode: ThemeMode, accent = "#1D9BF0"): ThemeTokens => {
  const base = mode === "light" ? lightTheme : darkTheme;
  return { ...base, ACCENT: accent };
};

// Radius/Shadow/Spacing
export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

export const SHADOW = {
  card: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  floating: { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
} as const;

export const SPACING = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 } as const;

export type ThemeRadius = typeof RADIUS;
export type ThemeShadow = typeof SHADOW;
export type ThemeSpacing = typeof SPACING;

/**
 * Legacy fallback:
 * Lots of older files import `COLORS` directly.
 * To avoid “weird light mode” where legacy views stay dark,
 * make the default legacy palette LIGHT + blue accent.
 * (New screens should use `useTheme()` which switches live.)
 */
export const COLORS: ThemeTokens = buildTheme("light", "#1D9BF0");
