// app/tune-results-preview.tsx
// Preview-only results screen (no Supabase, always locked/blurred)
// Shows hero + test plan + blurred setup cards + big CTA to sign in / unlock.

import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../components/Chip";
import { SettingRow } from "../components/SettingRow";
import { TuneSegmentedControl } from "../components/TuneSegmentedControl";
import { ZeroTuneResult } from "../lib/ai";
import { useTheme } from "../lib/theme";

type Mode = "balanced" | "comfort" | "precision";

export default function TuneResultsPreviewScreen() {
  const { r, meta } = useLocalSearchParams<{ r?: string; meta?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const base: ZeroTuneResult | null = useMemo(() => {
    try {
      return r ? (JSON.parse(decodeURIComponent(r)) as ZeroTuneResult) : null;
    } catch {
      return null;
    }
  }, [r]);

  const metaObj: any = useMemo(() => {
    try {
      return meta ? JSON.parse(decodeURIComponent(meta)) : null;
    } catch {
      return null;
    }
  }, [meta]);

  const [mode, setMode] = React.useState<Mode>("balanced");

  const result = useMemo(() => {
    if (!base) return null;

    const f = { ...base.fork };
    const s = { ...base.shock };

    if (mode === "comfort") {
      f.comp_clicks = Math.min(30, (f.comp_clicks ?? 0) + 2);
      s.lsc_clicks = Math.min(30, (s.lsc_clicks ?? 0) + 2);
      s.reb_clicks = Math.min(30, (s.reb_clicks ?? 0) + 2);
    } else if (mode === "precision") {
      f.comp_clicks = Math.max(0, (f.comp_clicks ?? 0) - 3);
      f.reb_clicks = Math.max(0, (f.reb_clicks ?? 0) - 2);
      s.lsc_clicks = Math.max(0, (s.lsc_clicks ?? 0) - 2);
      s.hsc_turns = Math.max(0, (s.hsc_turns ?? 0) + 0.25);
      s.sag_mm = clamp((s.sag_mm ?? 105) - 2, 95, 112);
    }

    return { ...base, fork: f, shock: s } as ZeroTuneResult;
  }, [base, mode]);

  if (!result) {
    return (
      <View style={S.emptyWrap}>
        <Text style={S.emptyText}>No result to preview.</Text>
        <View style={{ height: 12 }} />
        <Pressable onPress={() => router.replace("/")} style={S.btnGhost}>
          <Text style={S.btnGhostText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  // Bike title
  const bikeTitle =
    metaObj?.bike &&
    (metaObj.bike.make || metaObj.bike.model || metaObj.bike.year)
      ? [metaObj.bike.year, metaObj.bike.make, metaObj.bike.model]
          .filter(Boolean)
          .join(" ")
      : metaObj?.bike_hint &&
        (metaObj.bike_hint.make || metaObj.bike_hint.model || metaObj.bike_hint.year)
      ? [metaObj.bike_hint.year, metaObj.bike_hint.make, metaObj.bike_hint.model]
          .filter(Boolean)
          .join(" ")
      : "Custom Bike";

  const terrainVal = Array.isArray(metaObj?.context?.terrain)
    ? metaObj?.context?.terrain[0]
    : metaObj?.context?.terrain;

  const trackName = metaObj?.context?.track ?? metaObj?.track_name ?? null;

  const onUnlock = () => {
    router.push("/login");
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Safe-area spacer */}
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Compact header */}
      <View style={S.compactHeader}>
        <Pressable onPress={() => router.replace("/")} hitSlop={8} style={S.headerIconBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <Text style={S.compactHeaderTitle}>Preview Setup</Text>
        <View style={S.headerIconBtn} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 180 }}>
        {/* Hero section */}
        <View style={S.heroSection}>
          <View style={S.heroBadge}>
            <Ionicons name="lock-closed-outline" size={36} color={C.ACCENT} />
          </View>
          <Text style={S.heroTitle}>Your setup is ready</Text>
          <Text style={S.heroSubtitle}>{bikeTitle}</Text>
          <Text style={S.heroHint}>
            Create an account to reveal the exact click numbers and personalized notes.
          </Text>
        </View>

        {/* Summary chips */}
        {(terrainVal || trackName || typeof result.shock.sag_mm === "number") ? (
          <View style={S.chipsRow}>
            {terrainVal ? <Chip label={cap(terrainVal)} /> : null}
            {trackName ? <Chip label={`Track: ${trackName}`} /> : null}
            {typeof result.shock.sag_mm === "number" ? <Chip label={`Sag: ${num(result.shock.sag_mm)} mm`} /> : null}
          </View>
        ) : null}

        {/* Mode selector */}
        <TuneSegmentedControl value={mode} onChange={setMode} />

        {/* Mode helper */}
        <View style={S.modeHelperRow}>
          <Ionicons name="information-circle-outline" size={14} color={C.MUTED} />
          <Text style={S.modeHelperText}>
            {mode === "balanced"
              ? "Factory-balanced for most conditions."
              : mode === "comfort"
              ? "Softer — better for rough, physical terrain."
              : "Stiffer — better for speed and precision."}
          </Text>
        </View>

        {/* Fork card (locked) */}
        <View style={[S.card, S.lift, { overflow: "hidden" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={S.h1}>Fork</Text>
            <View style={S.lockPill}>
              <Ionicons name="lock-closed" size={12} color="#fff" />
              <Text style={S.lockPillText}>Locked</Text>
            </View>
          </View>
          <SettingRow icon="settings-outline" label="Compression" hint="Clicks out from zero" value="•••" unit="clicks" />
          <SettingRow icon="refresh-outline" label="Rebound" hint="Clicks out from zero" value="•••" unit="clicks" />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={30} tint={C.BG === "#FFFFFF" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} />
            )}
          </View>
        </View>

        {/* Shock card (locked) */}
        <View style={[S.card, S.lift, { overflow: "hidden" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={S.h1}>Shock</Text>
            <View style={S.lockPill}>
              <Ionicons name="lock-closed" size={12} color="#fff" />
              <Text style={S.lockPillText}>Locked</Text>
            </View>
          </View>
          <SettingRow icon="settings-outline" label="Low-Speed Comp" hint="Clicks out from zero" value="•••" unit="clicks" />
          <SettingRow icon="flash-outline" label="High-Speed Comp" hint="Turns out from zero" value="•••" unit="turns" />
          <SettingRow icon="refresh-outline" label="Rebound" hint="Clicks out from zero" value="•••" unit="clicks" />
          <SettingRow icon="resize-outline" label="Sag" hint="Static sag target" value="•••" unit="mm" />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={30} tint={C.BG === "#FFFFFF" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} />
            )}
          </View>
        </View>

        {/* Test plan (unlocked) */}
        {base?.notes?.length ? (
          <View style={S.card}>
            <Text style={S.h1}>Test plan</Text>
            <View style={{ marginTop: 6 }}>
              {base.notes.map((n, i) => (
                <View key={`${i}-${n}`} style={S.stepRow}>
                  <View style={S.stepBadge}>
                    <Text style={S.stepBadgeText}>{i + 1}</Text>
                  </View>
                  <Text style={S.stepText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={S.card}>
            <Text style={S.h1}>Test plan</Text>
            <Text style={S.bodySmall}>
              Ride 5-10 minutes, then refine with feedback. Unlock to see the exact click numbers.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Big CTA footer */}
      <View pointerEvents="box-none" style={[S.bigCtaWrap, { paddingBottom: 14 + insets.bottom }]}>
        {Platform.OS === "ios" ? (
          <BlurView intensity={25} tint={C.BG === "#FFFFFF" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.CARD }]} />
        )}

        <View style={S.bigCtaInner}>
          <Text style={S.bigCtaTitle}>Unlock exact settings</Text>
          <Text style={S.bigCtaSub}>
            You can preview the plan, but click numbers require an account.
          </Text>

          <Pressable onPress={onUnlock} style={S.btnPrimary}>
            <Text style={S.btnPrimaryText}>Create account / Sign in</Text>
          </Pressable>

          <Pressable onPress={() => router.replace("/")} style={S.btnGhost}>
            <Text style={S.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ---------- utils ---------- */
function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function cap(s: unknown) {
  return String(s ?? "").replace(/\b\w/g, (m) => m.toUpperCase());
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ---------- styles ---------- */
const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  INK: string;
  SUCCESS?: string;
}) =>
  StyleSheet.create({
    emptyWrap: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    emptyText: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 16,
      textAlign: "center",
    },

    // ── Compact header ──────────────────────────────────────────────
    compactHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
      backgroundColor: C.BG,
      borderBottomWidth: 1,
      borderBottomColor: C.BORDER,
    },
    headerIconBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    compactHeaderTitle: {
      flex: 1,
      textAlign: "center",
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "700",
    },

    // ── Hero section ────────────────────────────────────────────────
    heroSection: {
      alignItems: "center",
      paddingTop: 28,
      paddingBottom: 12,
      paddingHorizontal: 16,
    },
    heroBadge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: C.ACCENT + "2A",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    heroTitle: {
      color: C.TEXT,
      fontSize: 24,
      fontWeight: "900",
      textAlign: "center",
      letterSpacing: -0.4,
    },
    heroSubtitle: {
      color: C.MUTED,
      fontSize: 14,
      marginTop: 4,
      textAlign: "center",
    },
    heroHint: {
      color: C.MUTED,
      fontSize: 13,
      marginTop: 10,
      textAlign: "center",
      lineHeight: 18,
      paddingHorizontal: 20,
    },

    // ── Summary chips ───────────────────────────────────────────────
    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 10,
      marginBottom: 4,
    },

    // ── Mode helper ─────────────────────────────────────────────────
    modeHelperRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 16,
      marginTop: 8,
      marginBottom: 2,
    },
    modeHelperText: { color: C.MUTED, fontSize: 12, flex: 1 },

    // ── Card shell ──────────────────────────────────────────────────
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
    },
    lift: {
      ...Platform.select({
        ios: {
          shadowColor: C.ACCENT,
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 5 },
      }),
    },
    h1: { fontSize: 15, fontWeight: "900", color: C.TEXT, marginBottom: 8 },
    bodySmall: { color: C.MUTED, fontSize: 12, lineHeight: 17, marginTop: 2 },

    // ── Lock pill ───────────────────────────────────────────────────
    lockPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.18)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.22)",
    },
    lockPillText: { color: "#fff", fontWeight: "900", fontSize: 12 },

    // ── Test plan steps ─────────────────────────────────────────────
    stepRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 6 },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(29,155,240,0.12)",
      borderWidth: 1,
      borderColor: "rgba(29,155,240,0.25)",
      marginRight: 8,
      marginTop: 1,
    },
    stepBadgeText: { color: "#EAF2FF", fontWeight: "900", fontSize: 12, lineHeight: 12 },
    stepText: { color: C.TEXT, flex: 1, lineHeight: 20 },

    // ── Big CTA footer ──────────────────────────────────────────────
    bigCtaWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: C.BORDER,
    },
    bigCtaInner: {
      paddingTop: 12,
      paddingHorizontal: 16,
    },
    bigCtaTitle: { color: C.TEXT, fontWeight: "900", fontSize: 16 },
    bigCtaSub: { color: C.MUTED, marginTop: 4, marginBottom: 10 },

    btnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
      width: "100%",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },
    btnGhost: {
      marginTop: 10,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      width: "100%",
    },
    btnGhostText: { color: C.TEXT, fontWeight: "800" },
  });
