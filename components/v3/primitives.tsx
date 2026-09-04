// components/v3/primitives.tsx
// Building blocks that map 1:1 onto dialed.css classes: .eyebrow .h1 .card
// (.dashed .ghost .active .callout .stripe-*) .label .row .big .num .unit .bar
// .text .sub .small .btn (.ghost) .divider .photo .stats .story-row .chip
// .badge .setup .tile .coming. Values are lifted, not approximated.
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { brandColor, headingFont, interFont, T, V3 } from "./theme";

type ChildrenStyle = { children?: React.ReactNode; style?: StyleProp<ViewStyle> };
type TextChildren = { children?: React.ReactNode; style?: StyleProp<TextStyle> } & Omit<TextProps, "style">;

/* .eyebrow — optional brand accent */
export function Eyebrow({ children, style, brand, ...rest }: TextChildren & { brand?: string | null }) {
  return (
    <Text
      style={[styles.eyebrow, interFont(400), brand ? { color: brandColor(brand) } : null, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

/* .h1 — Barlow Condensed Black Italic, headings only */
export function H1({ children, style, ...rest }: TextChildren) {
  return (
    <Text style={[styles.h1, headingFont(), style]} accessibilityRole="header" {...rest}>
      {children}
    </Text>
  );
}

/* .h1 .accent */
export function Accent({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: V3.blue }}>{children}</Text>;
}

/* .label */
export function Label({ children, style, ...rest }: TextChildren) {
  return (
    <Text style={[styles.label, interFont(400), style]} {...rest}>
      {children}
    </Text>
  );
}

/* .text / .sub / .small */
export function Body({ children, style, weight = 400, ...rest }: TextChildren & { weight?: 400 | 500 | 600 }) {
  return (
    <Text style={[styles.text, interFont(weight), style]} {...rest}>
      {children}
    </Text>
  );
}
export function Sub({ children, style, ...rest }: TextChildren) {
  return (
    <Text style={[styles.sub, interFont(400), style]} {...rest}>
      {children}
    </Text>
  );
}
export function Small({ children, style, ...rest }: TextChildren) {
  return (
    <Text style={[styles.small, interFont(400), style]} {...rest}>
      {children}
    </Text>
  );
}

/* .big.xl/.lg/.md — Barlow, blue */
export function Big({
  children,
  size = "md",
  color = V3.blue,
  style,
  ...rest
}: TextChildren & { size?: "xl" | "lg" | "md"; color?: string }) {
  const fontSize = size === "xl" ? T.bigXl : size === "lg" ? T.bigLg : T.bigMd;
  return (
    <Text
      style={[{ fontSize, lineHeight: Math.round(fontSize * 0.95) + 2, color }, headingFont(), style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

/* .num.lg/.md + .unit — Inter 700, regular width */
export function Num({
  value,
  unit,
  size = "md",
  color = V3.white,
  style,
}: {
  value: string | number;
  unit?: string;
  size?: "lg" | "md";
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[{ fontSize: size === "lg" ? T.numLg : T.numMd, lineHeight: size === "lg" ? 32 : 28, color }, interFont(700), style]}>
      {value}
      {unit ? <Text style={[styles.unit, interFont(400)]}> {unit}</Text> : null}
    </Text>
  );
}

/* .card and variants */
export function Card({
  children,
  style,
  variant,
  stripe,
  onPress,
  hitSlop,
  accessibilityLabel,
}: ChildrenStyle & {
  variant?: "dashed" | "ghost" | "active" | "callout";
  /** brand make → left stripe (.stripe-*) */
  stripe?: string | null;
  onPress?: PressableProps["onPress"];
  hitSlop?: PressableProps["hitSlop"];
  accessibilityLabel?: string;
}) {
  const base = [
    styles.card,
    variant === "dashed" && styles.cardDashed,
    variant === "ghost" && styles.cardGhost,
    variant === "active" && styles.cardActive,
    variant === "callout" && styles.cardCallout,
    stripe ? { borderLeftWidth: 4, borderLeftColor: brandColor(stripe) } : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

/* .row */
export function Row({ children, style, align = "center" }: ChildrenStyle & { align?: "center" | "flex-start" }) {
  return <View style={[styles.row, { alignItems: align }, style]}>{children}</View>;
}

/* .bar */
export function Bar({ pct, style, dim }: { pct: number; style?: StyleProp<ViewStyle>; dim?: boolean }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <View style={[styles.bar, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: w }}>
      <View style={[styles.barFill, { width: `${w}%` }, dim && { opacity: 0.7 }]} />
    </View>
  );
}

/* .divider with the chevron */
export function Divider() {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Ionicons name="chevron-down" size={14} color={V3.muted} />
      <View style={styles.dividerLine} />
    </View>
  );
}

/* .btn / .btn.ghost */
export function Button({
  label,
  onPress,
  ghost,
  icon,
  style,
  disabled,
  compact,
}: {
  label: string;
  onPress?: () => void;
  ghost?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btn,
        ghost && styles.btnGhost,
        compact && styles.btnCompact,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.btnText, interFont(600), ghost && { color: V3.white }, compact && { fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

/* .photo — the rider's own bike photo tile (camera prompt when empty) */
export function PhotoTile({
  size = 72,
  caption,
  onPress,
  children,
  accent,
}: {
  size?: number;
  caption?: string;
  onPress?: () => void;
  children?: React.ReactNode;
  /** blue camera glyph + steel caption (day-one "add photo") */
  accent?: boolean;
}) {
  const inner = children ?? (
    <>
      <Ionicons name="camera-outline" size={size >= 72 ? 20 : 18} color={accent ? V3.blue : V3.muted} />
      {caption ? (
        <Text style={[styles.photoCaption, interFont(400), accent && { color: V3.steel }]}>{caption}</Text>
      ) : null}
    </>
  );
  const box = <View style={[styles.photo, { width: size, height: size }]}>{inner}</View>;
  if (!onPress) return box;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={caption ?? "Bike photo"}>
      {box}
    </Pressable>
  );
}

/* .stats / .stat */
export function StatRow({ stats }: { stats: { v: string; k: string; muted?: boolean }[] }) {
  return (
    <View style={styles.stats}>
      {stats.map((s) => (
        <View key={s.k} style={styles.stat}>
          <Text style={[styles.statV, headingFont(), s.muted && { color: V3.muted }]}>{s.v}</Text>
          <Text style={[styles.statK, interFont(400)]}>{s.k}</Text>
        </View>
      ))}
    </View>
  );
}

/* .story-row */
export function StoryRow({
  v,
  text,
  date,
  current,
  locked,
  last,
}: {
  v: string;
  text: string;
  date?: string;
  current?: boolean;
  locked?: boolean;
  last?: boolean;
}) {
  const dim = !current;
  return (
    <View style={[styles.storyRow, last && { marginBottom: 0 }, locked && { opacity: 0.45 }]}>
      <Text style={[styles.storyV, interFont(600), dim && { color: V3.steel }]}>{v}</Text>
      <Text style={[styles.storyText, interFont(400), dim && { color: V3.steel }]} numberOfLines={1}>
        {text}
      </Text>
      {locked ? (
        <Ionicons name="lock-closed" size={13} color={V3.steel} style={{ marginLeft: "auto" }} />
      ) : (
        <Text style={[styles.storyD, interFont(400)]}>{date}</Text>
      )}
    </View>
  );
}

/* .chip / .chip.on / .chip.alt */
export function Chip({
  label,
  on,
  alt,
  onPress,
  icon,
}: {
  label: string;
  on?: boolean;
  alt?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
}) {
  const inner = (
    <View style={[styles.chip, on && styles.chipOn, alt && styles.chipAlt]}>
      {icon}
      <Text style={[styles.chipText, interFont(on || alt ? 600 : 400), on && { color: V3.carbon }, alt && { color: V3.white }]}>{label}</Text>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
      {inner}
    </Pressable>
  );
}

/* .badge */
export function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={[styles.badgeText, interFont(400)]}>{label}</Text>
    </View>
  );
}

/* .setup (.running) */
export function SetupRow({
  title,
  sub,
  running,
  badge,
  onPress,
  locked,
}: {
  title: string;
  sub: string;
  running?: boolean;
  badge?: string;
  onPress?: () => void;
  locked?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.setup, running && styles.setupRunning, locked && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[styles.setupT, interFont(600)]}>{title}</Text>
          {badge ? <Badge label={badge} /> : null}
        </View>
        <Text style={[styles.setupS, interFont(400)]}>{sub}</Text>
      </View>
      <Ionicons name={locked ? "lock-closed" : "chevron-forward"} size={18} color={V3.steel} />
    </Pressable>
  );
}

/* .tiles / .tile */
export function Tile({ label, value, sub, onPress, muted }: { label: string; value: string; sub: string; onPress?: () => void; muted?: boolean }) {
  const inner = (
    <>
      <Label>{label}</Label>
      <Text style={[styles.tileV, headingFont(), muted && { color: V3.muted }]}>{value}</Text>
      <Small>{sub}</Small>
    </>
  );
  if (!onPress) return <View style={styles.tile}>{inner}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
      {inner}
    </Pressable>
  );
}

/* .coming */
export function ComingRow({ label, right, last }: { label: string; right: string; last?: boolean }) {
  return (
    <View style={[styles.coming, last && { borderBottomWidth: 0 }]}>
      <Text style={[styles.comingText, interFont(400)]}>{label}</Text>
      <Text style={[styles.comingRight, interFont(400)]}>{right}</Text>
    </View>
  );
}

/* .dot.done/.now/.todo + .step */
export function Step({ state, n, text, last }: { state: "done" | "now" | "todo"; n: number; text: string; last?: boolean }) {
  return (
    <View style={[styles.step, last && { marginBottom: 0 }]}>
      <View style={[styles.dot, state === "done" && styles.dotDone, state === "now" && styles.dotNow, state === "todo" && styles.dotTodo]}>
        {state === "done" ? (
          <Ionicons name="checkmark" size={13} color={V3.carbon} />
        ) : (
          <Text style={[styles.dotText, interFont(600), state === "now" ? { color: V3.blue } : { color: V3.steel }]}>{n}</Text>
        )}
      </View>
      <Text
        style={[
          styles.stepText,
          interFont(state === "now" ? 500 : 400),
          state === "done" && { color: V3.steel, textDecorationLine: "line-through" },
          state === "todo" && { color: V3.steel },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...T.eyebrow, color: V3.steel, marginBottom: 4 },
  h1: { ...T.h1, color: V3.white, marginBottom: 14, textTransform: "uppercase" },
  label: { ...T.label, color: V3.steel },
  text: { fontSize: T.text, color: V3.white, lineHeight: 20 },
  sub: { fontSize: T.sub, color: V3.steel, marginTop: 3, lineHeight: 18 },
  small: { fontSize: T.small, color: V3.steel, lineHeight: 17 },
  unit: { fontSize: T.unit, color: V3.steel },
  card: { backgroundColor: V3.panel, borderRadius: V3.cardRadius, padding: V3.cardPad, marginBottom: V3.cardGap },
  cardDashed: { borderWidth: 1, borderStyle: "dashed", borderColor: V3.line },
  cardGhost: { opacity: 0.55, borderWidth: 1, borderStyle: "dashed", borderColor: V3.line },
  cardActive: { borderWidth: 1, borderColor: V3.blue },
  cardCallout: { borderLeftWidth: 3, borderLeftColor: V3.blue },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bar: { backgroundColor: V3.panel2, borderRadius: 999, height: 6, overflow: "hidden", marginTop: 12, marginBottom: 8 },
  barFill: { backgroundColor: V3.blue, height: 6 },
  divider: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: V3.hair },
  btn: {
    backgroundColor: V3.blue,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: V3.line },
  btnCompact: { padding: 14 },
  btnText: { color: V3.carbon, fontSize: T.btn },
  photo: { borderRadius: 12, backgroundColor: V3.panel2, alignItems: "center", justifyContent: "center", gap: 3, overflow: "hidden" },
  photoCaption: { color: V3.muted, fontSize: 9 },
  stats: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1 },
  statV: { fontSize: 26, lineHeight: 28, color: V3.white },
  statK: { fontSize: 11, color: V3.steel, marginTop: 2 },
  storyRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 9 },
  storyV: { color: V3.blue, width: 24, fontSize: 13 },
  storyText: { color: V3.white, fontSize: 13, flexShrink: 1 },
  storyD: { marginLeft: "auto", color: V3.steel, fontSize: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
    backgroundColor: V3.panel,
    borderWidth: 1,
    borderColor: V3.line,
    marginRight: 6,
  },
  chipOn: { backgroundColor: V3.blue, borderColor: V3.blue },
  chipAlt: { backgroundColor: V3.line, borderColor: V3.line },
  chipText: { fontSize: 11, color: V3.steel },
  badge: { backgroundColor: V3.blueDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 },
  badgeText: { fontSize: 10, color: V3.blue },
  setup: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: V3.panel,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    minHeight: 56,
  },
  setupRunning: { borderWidth: 1, borderColor: V3.blue },
  setupT: { fontSize: 15, color: V3.white },
  setupS: { fontSize: 12, color: V3.steel, marginTop: 2 },
  tile: { flex: 1, backgroundColor: V3.panel, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  tileV: { fontSize: 26, lineHeight: 28, color: V3.white, marginTop: 4, marginBottom: 2 },
  coming: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: V3.hair },
  comingText: { fontSize: 13, color: V3.steel },
  comingRight: { fontSize: 11, color: V3.muted },
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: V3.blue },
  dotNow: { borderWidth: 2, borderColor: V3.blue },
  dotTodo: { borderWidth: 1, borderColor: V3.line },
  dotText: { fontSize: 12 },
  stepText: { fontSize: 14, color: V3.white, flex: 1 },
});
