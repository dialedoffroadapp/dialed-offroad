// app/setting-detail.tsx
import { Ionicons } from "@expo/vector-icons";
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
import { useTheme } from "../lib/theme";

type SettingId =
  | "fork_comp"
  | "fork_reb"
  | "fork_air"
  | "shock_lsc"
  | "shock_hsc"
  | "shock_reb"
  | "shock_sag";

type SettingDef = {
  name: string;
  icon: string;
  unit: string;
  section: "Fork" | "Shock";
  affects: string[];
  range: { min: number; max: number; softerLabel: string; firmerLabel: string };
  howToAdjust: string;
  educationalWhy: string;
};

const SETTING_DEFS: Record<SettingId, SettingDef> = {
  fork_comp: {
    name: "Compression",
    icon: "settings-outline",
    unit: "clicks",
    section: "Fork",
    affects: [
      "How much the fork resists being pushed in",
      "Feel over braking bumps and small chop",
      "Front-end stability in corners",
    ],
    range: { min: 0, max: 30, softerLabel: "Softer / open", firmerLabel: "Firmer / closed" },
    howToAdjust:
      "Turn the adjuster clockwise (CW) all the way in gently — that's zero. Count clicks OUT (counter-clockwise) to your target. Most WP/KYB forks use the top cap adjuster.",
    educationalWhy:
      "Compression controls how fast the fork collapses under impact. More clicks open = softer initial stroke = better for braking bumps and chop. Fewer clicks = stiffer = better for whoops and high-speed stability.",
  },
  fork_reb: {
    name: "Rebound",
    icon: "refresh-outline",
    unit: "clicks",
    section: "Fork",
    affects: [
      "How fast the fork extends back out after compression",
      "Front-end feel exiting corners",
      "Pack-down in repeated hits",
    ],
    range: { min: 0, max: 30, softerLabel: "Faster rebound", firmerLabel: "Slower rebound" },
    howToAdjust:
      "The rebound adjuster is typically at the bottom of the right fork leg. Turn CW all the way in gently — that's zero. Count clicks OUT for your target.",
    educationalWhy:
      "Rebound controls recovery speed. Too fast = kicks or deflects on successive hits. Too slow = forks pack down and feel stiff. Your target is full recovery between hits.",
  },
  fork_air: {
    name: "Air (AER)",
    icon: "water-outline",
    unit: "bar",
    section: "Fork",
    affects: [
      "Overall spring rate of the fork",
      "Sag and ride height",
      "Bottom-out resistance",
    ],
    range: { min: 7, max: 14, softerLabel: "Lower pressure / softer", firmerLabel: "Higher pressure / firmer" },
    howToAdjust:
      "Use a WP AER air fork pump. Remove the cap from the left fork leg air valve. Pump up or bleed air to reach the target pressure. Check cold — temperature affects pressure.",
    educationalWhy:
      "Air pressure is the spring in your WP AER fork. Higher pressure = stiffer spring = less sag and more bottom-out resistance. Your target is set to your weight and riding style.",
  },
  shock_lsc: {
    name: "Low-Speed Comp",
    icon: "settings-outline",
    unit: "clicks",
    section: "Shock",
    affects: [
      "Resistance to slow, weight-transfer compressions",
      "Body motion control in corners and jumps",
      "Feel through slow, square-edge hits",
    ],
    range: { min: 0, max: 30, softerLabel: "Softer / open", firmerLabel: "Firmer / closed" },
    howToAdjust:
      "The LSC adjuster is the smaller screw on the shock body (usually with a flat screwdriver slot). Turn CW all the way in gently — that's zero. Count clicks OUT.",
    educationalWhy:
      "Low-speed comp controls body-motion damping. Too firm = harsh, abrupt feel. Too soft = excessive body roll and diving. This is the primary tuning knob for overall shock feel.",
  },
  shock_hsc: {
    name: "High-Speed Comp",
    icon: "flash-outline",
    unit: "turns",
    section: "Shock",
    affects: [
      "Resistance to fast, impact compressions",
      "Big-hit and landing harshness",
      "High-speed chatter resistance",
    ],
    range: { min: 0, max: 3, softerLabel: "Fewer turns / softer", firmerLabel: "More turns / firmer" },
    howToAdjust:
      "The HSC adjuster is the large hex nut on the shock (requires a wrench or large flat). Turn CW to increase resistance. Adjust in 0.25-turn increments — it's sensitive.",
    educationalWhy:
      "High-speed comp controls damping for fast impacts. Too firm = kicks and harshness on big hits. Too soft = bottoming out. Most riders run this fairly conservative and tune LSC first.",
  },
  shock_reb: {
    name: "Rebound",
    icon: "refresh-outline",
    unit: "clicks",
    section: "Shock",
    affects: [
      "How fast the shock extends after compression",
      "Rear-wheel tracking and traction",
      "Pack-down in whoops or successive hits",
    ],
    range: { min: 0, max: 30, softerLabel: "Faster rebound", firmerLabel: "Slower rebound" },
    howToAdjust:
      "The rebound adjuster is at the bottom of the shock shaft (small screwdriver slot). Turn CW all the way in gently — zero. Count clicks OUT to your target.",
    educationalWhy:
      "Shock rebound controls how fast the rear wheel returns to the ground. Too fast = kicks and instability. Too slow = packs down in whoops. Match rebound to your terrain and spring rate.",
  },
  shock_sag: {
    name: "Sag",
    icon: "resize-outline",
    unit: "mm",
    section: "Shock",
    affects: [
      "Ride height and bike geometry",
      "Cornering balance front-to-rear",
      "Available suspension travel",
    ],
    range: { min: 85, max: 120, softerLabel: "Less sag / stiffer spring feel", firmerLabel: "More sag / softer spring feel" },
    howToAdjust:
      "Sag is set by the spring preload collar on the shock body. Loosen the lock ring, turn the preload collar CW to reduce sag (firmer), CCW to increase sag (softer). Measure with rider seated in full gear.",
    educationalWhy:
      "Sag defines how much the bike settles under rider weight. Correct sag = correct geometry. Too little sag = bike sits high, poor traction. Too much sag = bottoms out, poor cornering.",
  },
};

// Modes for "other modes" section
function applyMode(
  id: SettingId,
  balancedVal: number,
  mode: "comfort" | "precision"
): number {
  if (mode === "comfort") {
    if (id === "fork_comp") return Math.min(30, balancedVal + 2);
    if (id === "fork_reb") return balancedVal; // comfort only adjusts comp
    if (id === "shock_lsc") return Math.min(30, balancedVal + 2);
    if (id === "shock_reb") return Math.min(30, balancedVal + 2);
    return balancedVal;
  }
  // precision
  if (id === "fork_comp") return Math.max(0, balancedVal - 3);
  if (id === "fork_reb") return Math.max(0, balancedVal - 2);
  if (id === "shock_lsc") return Math.max(0, balancedVal - 2);
  if (id === "shock_hsc") return Math.max(0, balancedVal + 0.25);
  if (id === "shock_sag") return Math.max(95, Math.min(112, balancedVal - 2));
  return balancedVal;
}

export default function SettingDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const params = useLocalSearchParams<{
    id?: string;
    value?: string;
    unit?: string;
    notes?: string;
    bikeTitle?: string;
  }>();

  const id = (params.id ?? "fork_comp") as SettingId;
  const def = SETTING_DEFS[id] ?? SETTING_DEFS.fork_comp;
  const currentNum = parseFloat(params.value ?? "0") || 0;
  const unit = params.unit ?? def.unit;
  const bikeTitle = params.bikeTitle ?? "";

  const notes: string[] = useMemo(() => {
    try {
      const raw = params.notes ? decodeURIComponent(params.notes) : "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [params.notes]);

  // Relevant notes — lines that mention this setting by keyword
  const settingKeywords: Record<SettingId, string[]> = {
    fork_comp: ["fork", "compression", "comp"],
    fork_reb: ["fork", "rebound"],
    fork_air: ["air", "aer", "pressure"],
    shock_lsc: ["shock", "low-speed", "lsc", "compression"],
    shock_hsc: ["shock", "high-speed", "hsc"],
    shock_reb: ["shock", "rebound", "reb"],
    shock_sag: ["sag"],
  };
  const keywords = settingKeywords[id] ?? [];
  const relevantNotes = notes.filter((n) =>
    keywords.some((kw) => n.toLowerCase().includes(kw))
  );

  // Range visual
  const { min, max } = def.range;
  const pct = Math.max(0, Math.min(1, (currentNum - min) / Math.max(1, max - min)));

  // Other modes
  const comfortVal = applyMode(id, currentNum, "comfort");
  const precisionVal = applyMode(id, currentNum, "precision");
  const comfortChanged = comfortVal !== currentNum;
  const precisionChanged = precisionVal !== currentNum;

  const formatVal = (v: number) =>
    unit === "turns" || unit === "bar" ? v.toFixed(unit === "turns" ? 1 : 2) : String(Math.round(v));

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Header */}
      <View style={S.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={S.headerBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <View style={S.headerCenter}>
          <Text style={S.headerSection}>{def.section}</Text>
          <Text style={S.headerName}>{def.name}</Text>
        </View>
        <View style={S.headerBtn} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* Current value hero */}
        <View style={S.valueHero}>
          <View style={S.valueIconWrap}>
            <Ionicons name={def.icon as any} size={28} color={C.ACCENT} />
          </View>
          <Text style={S.valueNumber}>{formatVal(currentNum)}</Text>
          <Text style={S.valueUnit}>{unit}</Text>
          {bikeTitle ? <Text style={S.valueBike}>{bikeTitle}</Text> : null}
        </View>

        {/* What it affects */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>What it affects</Text>
          {def.affects.map((a, i) => (
            <View key={i} style={S.bulletRow}>
              <View style={S.bulletDot} />
              <Text style={S.bulletText}>{a}</Text>
            </View>
          ))}
        </View>

        {/* Adjustment range visual */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Adjustment range</Text>
          <View style={S.rangeLabels}>
            <Text style={S.rangeLabel}>{def.range.softerLabel}</Text>
            <Text style={S.rangeLabel}>{def.range.firmerLabel}</Text>
          </View>
          <View style={S.rangeTrack}>
            <View style={[S.rangeFill, { width: `${pct * 100}%` as any }]} />
            <View style={[S.rangeCursor, { left: `${pct * 100}%` as any }]}>
              <Text style={S.rangeCursorLabel}>{formatVal(currentNum)}</Text>
            </View>
          </View>
          <View style={S.rangeEndLabels}>
            <Text style={S.rangeEnd}>{formatVal(min)}</Text>
            <Text style={S.rangeEnd}>{formatVal(max)}</Text>
          </View>
        </View>

        {/* How to adjust */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>How to adjust</Text>
          <Text style={S.bodyText}>{def.howToAdjust}</Text>
        </View>

        {/* Why this setting — AI notes first, then educational fallback */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Why this setting</Text>
          {relevantNotes.length > 0 ? (
            relevantNotes.map((n, i) => (
              <View key={i} style={S.noteRow}>
                <Ionicons name="sparkles-outline" size={13} color={C.ACCENT} style={{ marginTop: 2 }} />
                <Text style={S.noteText}>{n}</Text>
              </View>
            ))
          ) : (
            <Text style={S.bodyText}>{def.educationalWhy}</Text>
          )}
        </View>

        {/* Other modes */}
        {(comfortChanged || precisionChanged) ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Other modes</Text>
            <View style={S.modesRow}>
              {/* Balanced */}
              <View style={[S.modeChip, S.modeChipActive]}>
                <Text style={S.modeChipLabel}>Balanced</Text>
                <Text style={S.modeChipValue}>{formatVal(currentNum)} {unit}</Text>
              </View>
              {/* Comfort */}
              <View style={S.modeChip}>
                <Text style={S.modeChipLabel}>Comfort</Text>
                <Text style={[S.modeChipValue, !comfortChanged && { color: C.MUTED }]}>
                  {formatVal(comfortVal)} {unit}
                </Text>
              </View>
              {/* Precision */}
              <View style={S.modeChip}>
                <Text style={S.modeChipLabel}>Precision</Text>
                <Text style={[S.modeChipValue, !precisionChanged && { color: C.MUTED }]}>
                  {formatVal(precisionVal)} {unit}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  SUCCESS?: string;
  [key: string]: string | undefined;
}) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
      backgroundColor: C.BG,
      borderBottomWidth: 1,
      borderBottomColor: C.BORDER,
    },
    headerBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCenter: {
      flex: 1,
      alignItems: "center",
    },
    headerSection: {
      color: C.MUTED,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    headerName: {
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "800",
      marginTop: 1,
    },

    valueHero: {
      alignItems: "center",
      paddingTop: 28,
      paddingBottom: 20,
    },
    valueIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: C.ACCENT + "18",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    valueNumber: {
      color: C.TEXT,
      fontSize: 52,
      fontWeight: "900",
      letterSpacing: -2,
      lineHeight: 56,
    },
    valueUnit: {
      color: C.MUTED,
      fontSize: 16,
      fontWeight: "600",
      marginTop: 2,
    },
    valueBike: {
      color: C.MUTED,
      fontSize: 13,
      marginTop: 6,
    },

    section: {
      marginHorizontal: 16,
      marginTop: 20,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: C.BORDER,
    },
    sectionTitle: {
      color: C.TEXT,
      fontSize: 13,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 10,
    },

    bulletRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 6,
    },
    bulletDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: C.ACCENT,
      marginTop: 6,
      flexShrink: 0,
    },
    bulletText: {
      color: C.TEXT,
      fontSize: 14,
      flex: 1,
      lineHeight: 20,
    },

    rangeLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    rangeLabel: {
      color: C.MUTED,
      fontSize: 11,
      fontWeight: "600",
    },
    rangeTrack: {
      height: 6,
      backgroundColor: C.BORDER,
      borderRadius: 999,
      position: "relative",
      marginBottom: 20,
    },
    rangeFill: {
      position: "absolute",
      top: 0,
      left: 0,
      height: "100%",
      backgroundColor: C.ACCENT,
      borderRadius: 999,
    },
    rangeCursor: {
      position: "absolute",
      top: -6,
      marginLeft: -14,
      alignItems: "center",
    },
    rangeCursorLabel: {
      color: C.ACCENT,
      fontSize: 11,
      fontWeight: "900",
      marginTop: 10,
    },
    rangeEndLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: -16,
    },
    rangeEnd: {
      color: C.MUTED,
      fontSize: 11,
    },

    bodyText: {
      color: C.TEXT,
      fontSize: 14,
      lineHeight: 21,
    },

    noteRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 8,
    },
    noteText: {
      color: C.TEXT,
      fontSize: 14,
      flex: 1,
      lineHeight: 20,
    },

    modesRow: {
      flexDirection: "row",
      gap: 10,
    },
    modeChip: {
      flex: 1,
      backgroundColor: C.BORDER,
      borderRadius: 10,
      padding: 10,
      alignItems: "center",
    },
    modeChipActive: {
      backgroundColor: C.ACCENT + "18",
      borderWidth: 1,
      borderColor: C.ACCENT + "44",
    },
    modeChipLabel: {
      color: C.MUTED,
      fontSize: 11,
      fontWeight: "700",
      marginBottom: 4,
    },
    modeChipValue: {
      color: C.TEXT,
      fontSize: 13,
      fontWeight: "800",
      textAlign: "center",
    },
  });
