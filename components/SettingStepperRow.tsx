// components/SettingStepperRow.tsx
// Big-number setting row with - / + adjusters for the Current Setup screen
// (ride-day plan 4.2). Touch targets are 56px minimum by spec. Display-only
// when no value exists (null base: adjusters render disabled).

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

type Props = {
  label: string;
  /** Small unit caption under the value ("clicks", "mm", "bar", "turns"). */
  unit: string;
  value: number | null;
  decimals: number;
  /** Net pending change for this circuit (renders a +N / -N badge). */
  pendingDelta?: number;
  onAdjust: (direction: 1 | -1) => void;
};

const TARGET = 56; // minimum touch target per plan 4.2

export default function SettingStepperRow({
  label,
  unit,
  value,
  decimals,
  pendingDelta = 0,
  onAdjust,
}: Props) {
  const { colors: C } = useTheme();
  const disabled = typeof value !== "number";
  const display = disabled ? "—" : value!.toFixed(decimals);
  const deltaTxt =
    pendingDelta !== 0
      ? `${pendingDelta > 0 ? "+" : ""}${Number(pendingDelta.toFixed(2))}`
      : null;

  return (
    <View style={[S.row, { borderColor: C.BORDER }]}>
      <StepBtn glyph="−" onPress={() => onAdjust(-1)} disabled={disabled} />
      <View style={S.center}>
        <Text style={[S.label, { color: C.MUTED }]}>{label}</Text>
        <View style={S.valueRow}>
          <Text
            style={[S.value, { color: C.TEXT }]}
            accessibilityLabel={`${label} ${display} ${unit}`}
          >
            {display}
          </Text>
          {deltaTxt ? (
            <Text style={[S.delta, { color: C.ACCENT }]}>{deltaTxt}</Text>
          ) : null}
        </View>
        <Text style={[S.unit, { color: C.MUTED }]}>{unit}</Text>
      </View>
      <StepBtn glyph="+" onPress={() => onAdjust(1)} disabled={disabled} />
    </View>
  );
}

function StepBtn({
  glyph,
  onPress,
  disabled,
}: {
  glyph: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { colors: C } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={glyph === "+" ? "increase" : "decrease"}
      style={({ pressed }) => [
        S.btn,
        {
          backgroundColor: pressed ? C.ACCENT : C.CARD,
          borderColor: C.BORDER,
          opacity: disabled ? 0.3 : 1,
        },
      ]}
    >
      <Text style={[S.btnGlyph, { color: C.TEXT }]}>{glyph}</Text>
    </Pressable>
  );
}

const S = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: "center" },
  label: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  value: {
    // Approximates the Barlow Condensed Black Italic direction until fonts
    // land: heaviest system weight, italic, tabular digits.
    fontSize: 44,
    fontWeight: "900",
    fontStyle: "italic",
    fontVariant: ["tabular-nums"],
    lineHeight: 50,
  },
  delta: { fontSize: 15, fontWeight: "800" },
  unit: { fontSize: 11, fontWeight: "600", marginTop: -2 },
  btn: {
    width: TARGET,
    height: TARGET,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGlyph: { fontSize: 28, fontWeight: "800", lineHeight: 32 },
});
