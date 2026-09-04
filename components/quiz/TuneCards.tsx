// components/quiz/TuneCards.tsx
// Locked-row card (account gate: labels in Steel, dashes + lock glyphs, NO
// blur), the full-values card (reveal), and the dialed meter's first
// appearance (endowed 20% with the reason stated; Pro rows locked in the
// locked-row pattern since the meter now does paywall-teaser work).
import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import {
  formatTuneValue,
  METER_CATEGORIES,
  METER_REASON,
  meterPct,
  tuneRowsFor,
  tuneRowValue,
  type MeterCategory,
  type TuneLike,
} from "../../lib/quizOnboarding";
import { displayFont, Q } from "./quizTheme";

export function LockedTuneCard({ tune, title }: { tune: TuneLike | null; title?: string }) {
  const rows = tuneRowsFor(tune);
  return (
    <View style={styles.card} accessibilityLabel="Your tune, locked until you save it">
      {title ? <Text style={[styles.cardTitle, displayFont("bold")]}>{title}</Text> : null}
      {rows.map((r, i) => (
        <View key={r.key} style={[styles.row, i > 0 && styles.rowBorder]}>
          <Text style={styles.rowLabelLocked}>{r.label}</Text>
          <View style={styles.lockedValue}>
            <Text style={[styles.dashes, displayFont("bold")]}>— —</Text>
            <Ionicons name="lock-closed" size={14} color={Q.STEEL} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function TuneValuesCard({ tune }: { tune: TuneLike }) {
  const rows = tuneRowsFor(tune);
  return (
    <View style={styles.card}>
      {rows.map((r, i) => {
        const v = tuneRowValue(tune, r.key);
        return (
          <View key={r.key} style={[styles.row, i > 0 && styles.rowBorder]}>
            <Text style={styles.rowLabel}>{r.label}</Text>
            <View style={styles.valueWrap}>
              <Text style={[styles.value, displayFont("black")]}>{formatTuneValue(v, r.unit)}</Text>
              <Text style={styles.unit}>{r.unit}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function MeterRow({ c }: { c: MeterCategory }) {
  const locked = c.state === "locked_pro";
  return (
    <View style={styles.meterRow}>
      {c.state === "done" ? (
        <View style={styles.meterDone}>
          <Ionicons name="checkmark" size={13} color={Q.INK} />
        </View>
      ) : locked ? (
        <Ionicons name="lock-closed" size={15} color={Q.STEEL} />
      ) : (
        <View style={styles.meterOpen} />
      )}
      <Text style={[styles.meterLabel, c.state === "done" && styles.meterLabelDone]}>{c.label}</Text>
      {locked ? (
        <View style={styles.proTag}>
          <Text style={[styles.proTagText, displayFont("bold")]}>PRO</Text>
        </View>
      ) : null}
      <Text style={[styles.meterPct, displayFont("bold")]}>
        {locked ? "— —" : `${c.pct}%`}
      </Text>
    </View>
  );
}

export function DialedMeterCard({
  categories = METER_CATEGORIES,
}: {
  categories?: readonly MeterCategory[];
}) {
  const pct = meterPct(categories);
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(pct, { duration: 700 });
  }, [pct, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={styles.card} accessibilityLabel={`${pct} percent dialed`}>
      <View style={styles.meterHead}>
        <Text style={[styles.meterTitle, displayFont("bold")]}>DIALED</Text>
        <Text style={[styles.meterBig, displayFont("black")]}>{pct}%</Text>
      </View>
      <View style={styles.bar}>
        <Animated.View style={[styles.barFill, fill]} />
      </View>
      <Text style={styles.reason}>{METER_REASON}</Text>
      <View style={styles.meterRows}>
        {categories.map((c) => (
          <MeterRow key={c.key} c={c} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Q.PANEL,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Q.BORDER,
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  cardTitle: {
    color: Q.STEEL,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: Q.BORDER },
  rowLabel: { color: Q.TEXT, fontSize: 16, flex: 1 },
  rowLabelLocked: { color: Q.STEEL, fontSize: 16, flex: 1 },
  lockedValue: { flexDirection: "row", alignItems: "center", gap: 10 },
  dashes: { color: Q.STEEL, fontSize: 22, letterSpacing: 2 },
  valueWrap: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  value: { color: Q.TEXT, fontSize: 36, lineHeight: 40 },
  unit: { color: Q.STEEL, fontSize: 13, letterSpacing: 0.4 },
  meterHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 12 },
  meterTitle: { color: Q.STEEL, fontSize: 13, letterSpacing: 0.8, paddingBottom: 8 },
  meterBig: { color: Q.BLUE, fontSize: 40, lineHeight: 42 },
  bar: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden", marginTop: 8 },
  barFill: { height: 8, borderRadius: 4, backgroundColor: Q.BLUE },
  reason: { color: Q.TEXT, fontSize: 14, lineHeight: 19, marginTop: 12 },
  meterRows: { marginTop: 8, paddingBottom: 6 },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Q.BORDER },
  meterDone: { width: 20, height: 20, borderRadius: 10, backgroundColor: Q.BLUE, alignItems: "center", justifyContent: "center" },
  meterOpen: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: Q.STEEL, marginHorizontal: 2 },
  meterLabel: { flex: 1, color: Q.STEEL, fontSize: 15 },
  meterLabelDone: { color: Q.TEXT },
  proTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(29,155,240,0.14)" },
  proTagText: { color: Q.BLUE, fontSize: 10, letterSpacing: 0.8 },
  meterPct: { color: Q.STEEL, fontSize: 14, minWidth: 40, textAlign: "right" },
});
