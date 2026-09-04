// components/ride/ridePrimitives.tsx
// ride.css → components. `out` = the OUTDOOR treatment (screens 06-09): pure
// black, pure white, 800-weight numerals, 2px borders, no hairlines; blue only
// on the primary action and the direction line. Everything between motos is
// 56pt or taller.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Label, Small } from "../v3/primitives";
import { headingFont, interFont, V3 } from "../v3/theme";

export const OUT = { bg: "#000000", text: "#FFFFFF" } as const;

export function RideScreenBg({ out }: { out?: boolean }): ViewStyle {
  return { flex: 1, backgroundColor: out ? OUT.bg : V3.carbon };
}

/* ride.css .h1 override: 30px */
export function RideH1({ children, out, style }: { children: React.ReactNode; out?: boolean; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.h1, headingFont(), out && { color: OUT.text }, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

/* .pick (.on .empty) */
export function PickCard({
  label,
  title,
  empty,
  on,
  onPress,
  icon = "chevron-forward",
  iconColor,
}: {
  label?: string;
  title: string;
  empty?: boolean;
  on?: boolean;
  onPress?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"] | null;
  iconColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ? `${label}: ${title}` : title}
      style={({ pressed }) => [styles.pick, on && styles.pickOn, empty && styles.pickEmpty, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        {label ? <Label>{label}</Label> : null}
        <Text style={[empty ? styles.pickE : styles.pickT, interFont(empty ? 400 : 600)]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {icon ? <Ionicons name={icon} size={20} color={iconColor ?? V3.steel} /> : null}
    </Pressable>
  );
}

/* .ch (.on) inside .g2/.g3 grids */
export function ChoiceChip({
  label,
  sub,
  on,
  onPress,
  out,
  icon,
  dim,
  style,
  minHeight = 56,
}: {
  label: string;
  sub?: string;
  on?: boolean;
  onPress?: () => void;
  out?: boolean;
  icon?: React.ReactNode;
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
  minHeight?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={({ pressed }) => [
        styles.ch,
        { minHeight },
        out && { borderWidth: 2 },
        on && styles.chOn,
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.chText, interFont(on ? 700 : 400), on && { color: V3.carbon }, dim && !on && { color: V3.steel }]} numberOfLines={2}>
        {label}
      </Text>
      {sub ? <Text style={[styles.chSub, interFont(400), on && { color: V3.carbon }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Grid({ cols, children, style }: { cols: 2 | 3; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children);
  return (
    <View style={[styles.grid, style]}>
      {items.map((c, i) => (
        <View key={i} style={{ width: cols === 2 ? "48.5%" : "31.8%" }}>
          {c}
        </View>
      ))}
    </View>
  );
}

/* .cta (.dim .huge) */
export function Cta({ label, onPress, dim, huge, icon, style, disabled }: { label: string; onPress?: () => void; dim?: boolean; huge?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; disabled?: boolean }) {
  const inactive = dim || disabled;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      style={({ pressed }) => [styles.cta, huge && styles.ctaHuge, inactive && styles.ctaDim, pressed && !inactive && { opacity: 0.85 }, style]}
    >
      {icon}
      <Text style={[styles.ctaText, interFont(huge ? 800 : 700), huge && { fontSize: 24 }, inactive && { color: V3.muted }]}>{label}</Text>
    </Pressable>
  );
}

/* .gh (.dim) ghost buttons, 2px border */
export function Ghost({ label, onPress, dim, icon, style, thin }: { label: string; onPress?: () => void; dim?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; thin?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.gh, thin && { borderWidth: 1, paddingVertical: 14 }, pressed && { opacity: 0.85 }, style]}>
      {icon}
      <Text style={[styles.ghText, interFont(thin ? 600 : 700), thin && { fontSize: 14 }, dim && { color: V3.steel }]}>{label}</Text>
    </Pressable>
  );
}

/* .rowset + .rr with old → new */
export function RowSet({ children, out }: { children: React.ReactNode; out?: boolean }) {
  return <View style={[styles.rowset, out && { borderWidth: 2, borderColor: V3.line }]}>{children}</View>;
}

export function ValueRow({
  label,
  value,
  old,
  unit,
  onPress,
  last,
  out,
  small,
}: {
  label: string;
  value: string;
  old?: string | null;
  unit?: string;
  onPress?: () => void;
  last?: boolean;
  out?: boolean;
  small?: boolean;
}) {
  const inner = (
    <View style={[styles.rr, last && { borderBottomWidth: 0 }, small && { paddingVertical: 10, minHeight: 0 }]}>
      <Text style={[styles.rrK, interFont(400), out && { color: OUT.text }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        {old ? (
          <>
            <Text style={[styles.old, interFont(400)]}>{old}</Text>
            <Ionicons name="arrow-forward" size={15} color={V3.blue} style={{ marginHorizontal: 6, alignSelf: "center" }} />
          </>
        ) : null}
        <Text style={[styles.rrV, interFont(800), small && { fontSize: 22 }, out && { color: OUT.text }]}>{value}</Text>
        {unit ? <Text style={[styles.unit, interFont(400)]}> {unit}</Text> : null}
      </View>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${old ? `${old} to ` : ""}${value}`}>
      {inner}
    </Pressable>
  );
}

export function Hint({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Small style={[styles.hint, style]}>{children}</Small>;
}

/* .clock */
export function Clock({ children }: { children: React.ReactNode }) {
  return <Text style={[styles.clock, interFont(800)]}>{children}</Text>;
}

/* .stat */
export function Stat({ v, k, blue, icon }: { v: string; k: string; blue?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statV, interFont(800), blue && { color: V3.blue }]}>{v}</Text>
      <Text style={[styles.statK, interFont(400)]}>
        {k} {icon}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 30, lineHeight: 30, color: V3.white, marginBottom: 10, textTransform: "uppercase" },
  pick: {
    backgroundColor: V3.panel,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    minHeight: 64,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickOn: { borderWidth: 1, borderColor: V3.blue },
  pickEmpty: { borderWidth: 1, borderStyle: "dashed", borderColor: V3.line },
  pickT: { fontSize: 17, color: V3.white, marginTop: 3 },
  pickE: { fontSize: 16, color: V3.steel, marginTop: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  ch: {
    backgroundColor: V3.panel,
    borderWidth: 1,
    borderColor: V3.line,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  chOn: { backgroundColor: V3.blue, borderColor: V3.blue },
  chText: { fontSize: 15, color: V3.white, textAlign: "center" },
  chSub: { fontSize: 12, color: V3.steel },
  cta: { backgroundColor: V3.blue, borderRadius: 16, padding: 22, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaHuge: { padding: 28, borderRadius: 20 },
  ctaDim: { backgroundColor: V3.panel2 },
  ctaText: { fontSize: 18, color: V3.carbon },
  gh: { borderWidth: 2, borderColor: V3.line, borderRadius: 14, padding: 18, alignItems: "center", justifyContent: "center", flex: 1, minHeight: 56, flexDirection: "row", gap: 6 },
  ghText: { fontSize: 16, color: "#FFFFFF" },
  rowset: { backgroundColor: V3.panel, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 2, marginBottom: 12 },
  rr: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: V3.hair, minHeight: 60 },
  rrK: { fontSize: 16, color: V3.white },
  rrV: { fontSize: 32, lineHeight: 34, color: V3.white },
  old: { fontSize: 15, color: V3.muted },
  unit: { fontSize: 12, color: V3.steel },
  hint: { fontSize: 13, color: V3.steel, textAlign: "center", marginTop: 8, marginBottom: 12 },
  clock: { fontSize: 84, lineHeight: 88, color: "#FFFFFF", letterSpacing: -3, textAlign: "center" },
  stat: { flex: 1, backgroundColor: V3.panel, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, alignItems: "center" },
  statV: { fontSize: 26, lineHeight: 28, color: V3.white },
  statK: { fontSize: 11, color: V3.steel, marginTop: 4 },
});
