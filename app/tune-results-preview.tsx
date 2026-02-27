// app/tune-results-preview.tsx
// Preview-only results screen (no Supabase, always locked/blurred)
// Shows notes/test plan + big CTA to sign in / unlock exact numbers.

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
import { ZeroTuneResult } from "../lib/ai";
import { useTheme } from "../lib/theme";

type Mode = "balanced" | "comfort" | "precision";

export default function TuneResultsPreviewScreen() {
  const { r, meta } = useLocalSearchParams<{ r?: string; meta?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const locked = true;

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

  // Title / chips
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

  const headerChips = [
    terrainVal ? `Surface: ${cap(terrainVal)}` : null,
    trackName ? `Track: ${trackName}` : null,
    typeof result.shock.sag_mm === "number" ? `Sag: ${num(result.shock.sag_mm)} mm` : null,
  ].filter(Boolean) as string[];

  const onUnlock = () => {
    // Choose what you want:
    // - if you want sign-in first:
    router.push("/login");

    // - OR if you want a premium screen first:
    // router.push("/premium");
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Safe-area spacer */}
      <View style={[S.topSafeSpacer, { height: insets.top }]} />

      {/* Header */}
      <View style={S.headerSolid}>
        <Text style={S.title}>Preview Setup</Text>
        <Text style={S.subtitle}>{bikeTitle}</Text>

        <View style={S.chipsRow}>
          {headerChips.map((c) => (
            <View key={c} style={S.chip}>
              <Text numberOfLines={1} style={S.chipText}>
                {c}
              </Text>
            </View>
          ))}
        </View>

        <Text style={S.zeroText}>
          Zero-based: turn each clicker gently all the way IN (clockwise, toward the "+"
          on the cap) until it lightly stops, then count clicks OUT from there.
        </Text>

        {/* Mode chips */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {(["balanced", "comfort", "precision"] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[S.modePill, mode === m && S.modePillOn]}
            >
              <Text style={[S.modePillText, mode === m && S.modePillTextOn]}>
                {cap(m)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 160 }}>
        {/* Notes / Test plan (UNLOCKED) */}
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
              Ride 5–10 minutes, then refine with feedback. Unlock to see the exact click numbers.
            </Text>
          </View>
        )}

        {/* Fork (LOCKED) */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Fork</Text>
          <Metric S={S} label="Compression" value={locked ? "•••" : `${num(result.fork.comp_clicks)} clicks`} hint="Clicks out from zero" />
          <Bar C={C} value={locked ? 0 : num(result.fork.comp_clicks)} max={30} />
          <Metric S={S} label="Rebound" value={locked ? "•••" : `${num(result.fork.reb_clicks)} clicks`} hint="Clicks out from zero" />
          <Bar C={C} value={locked ? 0 : num(result.fork.reb_clicks)} max={30} />

          {locked && <LockOverlay S={S} onUnlock={onUnlock} />}
        </View>

        {/* Shock (LOCKED) */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Shock</Text>
          <Metric S={S} label="Low-Speed Comp" value={locked ? "•••" : `${num(result.shock.lsc_clicks)} clicks`} />
          <Bar C={C} value={locked ? 0 : num(result.shock.lsc_clicks)} max={30} />
          <Metric S={S} label="High-Speed Comp" value={locked ? "•••" : `${num(result.shock.hsc_turns, 0).toFixed(1)} turns`} />
          <Bar C={C} value={locked ? 0 : num(result.shock.hsc_turns, 0)} max={3} />
          <Metric S={S} label="Rebound" value={locked ? "•••" : `${num(result.shock.reb_clicks)} clicks`} />
          <Bar C={C} value={locked ? 0 : num(result.shock.reb_clicks)} max={30} />
          <Metric S={S} label="Sag" value={locked ? "•••" : `${num(result.shock.sag_mm)} mm`} />
          <Bar C={C} value={locked ? 0 : num(result.shock.sag_mm)} max={120} goodMin={100} goodMax={108} />

          {locked && <LockOverlay S={S} onUnlock={onUnlock} />}
        </View>
      </ScrollView>

      {/* Big CTA footer (NO TABS needed) */}
      <View style={[S.bigCtaWrap, { paddingBottom: 14 + insets.bottom }]}>
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

/* ---------- Lock overlay component ---------- */
function LockOverlay({
  S,
  onUnlock,
}: {
  S: any;
  onUnlock: () => void;
}) {
  return (
    <View style={S.lockOverlay} pointerEvents="box-none">
      {Platform.OS === "ios" ? (
        <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} />
      )}

      <View style={S.lockCard}>
        <Ionicons name="lock-closed" size={18} color="#fff" />
        <Text style={S.lockTitle}>Exact numbers locked</Text>
        <Text style={S.lockSub}>Create an account to reveal the click settings.</Text>

        <Pressable onPress={onUnlock} style={[S.btnPrimary, { marginTop: 10 }]}>
          <Text style={S.btnPrimaryText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------- UI pieces ---------- */
function Metric({
  label,
  value,
  hint,
  S,
}: {
  label: string;
  value: string;
  hint?: string;
  S: any;
}) {
  return (
    <View style={S.rowBetween}>
      <View style={{ flexShrink: 1 }}>
        <Text style={S.metricLabel}>{label}</Text>
        {hint ? <Text style={S.metricHint}>{hint}</Text> : null}
      </View>
      <Text style={S.metricValue}>{value}</Text>
    </View>
  );
}

function Bar({
  value,
  max,
  goodMin,
  goodMax,
  C,
}: {
  value: number;
  max: number;
  goodMin?: number;
  goodMax?: number;
  C: any;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const inGood =
    goodMin != null && goodMax != null && value >= goodMin && value <= goodMax;

  return (
    <View
      style={{
        height: 8,
        backgroundColor: C.INK,
        borderRadius: 999,
        overflow: "hidden",
        marginTop: 6,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: C.BORDER,
        position: "relative",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${pct * 100}%`,
          backgroundColor: inGood ? (C.SUCCESS ?? "#22c55e") : C.ACCENT,
        }}
      />
      {goodMin != null && goodMax != null ? (
        <View
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: `${(goodMin / max) * 100}%`,
            right: `${(1 - goodMax / max) * 100}%`,
            borderRadius: 999,
            backgroundColor: (C.SUCCESS ?? "#22c55e") + "2E",
            borderWidth: 1,
            borderColor: (C.SUCCESS ?? "#22c55e") + "59",
          }}
        />
      ) : null}
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
  INPUT_BG?: string;
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

    topSafeSpacer: { backgroundColor: C.BG },

    headerSolid: {
      backgroundColor: C.ACCENT,
      paddingTop: 18,
      paddingBottom: 18,
      paddingHorizontal: 16,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 18,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 6 },
      }),
    },
    title: {
      color: "#fff",
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    subtitle: {
      color: "rgba(255,255,255,0.9)",
      marginTop: 4,
      fontSize: 14,
      lineHeight: 18,
    },

    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    chip: {
      backgroundColor: "rgba(0,0,0,0.18)",
      borderColor: "rgba(255,255,255,0.2)",
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: 220,
    },
    chipText: { color: "#fff", fontWeight: "700", fontSize: 12 },

    zeroText: {
      color: "rgba(255,255,255,0.92)",
      marginTop: 10,
      fontSize: 13,
      lineHeight: 17,
    },

    modePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(0,0,0,0.15)",
    },
    modePillOn: {
      borderColor: "#fff",
      backgroundColor: "rgba(0,0,0,0.28)",
    },
    modePillText: {
      color: "rgba(255,255,255,0.9)",
      fontWeight: "800",
      fontSize: 12,
    },
    modePillTextOn: { color: "#fff" },

    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
      overflow: "hidden",
    },
    lift: {
      shadowColor: C.ACCENT,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    h1: { fontSize: 15, fontWeight: "900", color: C.TEXT, marginBottom: 8 },

    stepRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 6,
    },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: C.ACCENT + "2E",
      borderWidth: 1,
      borderColor: C.ACCENT + "73",
      marginRight: 8,
      marginTop: 1,
    },
    stepBadgeText: {
      color: "#EAF2FF",
      fontWeight: "900",
      fontSize: 12,
      lineHeight: 12,
    },
    stepText: { color: C.TEXT, flex: 1, lineHeight: 20 },

    metricLabel: { color: "#DDE2F2", fontWeight: "800" },
    metricHint: { color: C.MUTED, fontSize: 12, marginTop: 2 },
    metricValue: {
      color: "#fff",
      fontWeight: "900",
      marginLeft: 8,
      minWidth: 80,
      textAlign: "right",
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },

    bodySmall: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },

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
      borderColor: "rgba(255,255,255,0.25)",
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      width: "100%",
    },
    btnGhostText: { color: "#E6E9F2", fontWeight: "800" },

    // LOCK overlay
    lockOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
    lockCard: {
      width: "86%",
      borderRadius: 14,
      padding: 14,
      backgroundColor: "rgba(0,0,0,0.55)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
    },
    lockTitle: { color: "#fff", fontWeight: "900", marginTop: 6, fontSize: 14 },
    lockSub: {
      color: "rgba(255,255,255,0.9)",
      textAlign: "center",
      marginTop: 4,
      fontSize: 12,
    },

    // Big CTA footer
    bigCtaWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: "rgba(255,255,255,0.12)",
    },
    bigCtaInner: {
      paddingTop: 12,
      paddingHorizontal: 16,
    },
    bigCtaTitle: { color: C.TEXT, fontWeight: "900", fontSize: 16 },
    bigCtaSub: { color: C.MUTED, marginTop: 4, marginBottom: 10 },
  });
