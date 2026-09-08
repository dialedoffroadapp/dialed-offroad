// components/garage/TireSystemPicker.tsx
// What is in each tire: two segmented rows (front, rear) over the five
// systems the engine knows (lib/tirePlanCore.ts). Default "Not sure"; picking
// is never required. Plain react-native so the quiz and the garage sheet
// share it and it renders under the jest stubs.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TIRE_SYSTEMS, TIRE_SYSTEM_LABEL, type TireSystem } from "../../lib/tirePlanCore";

export type TireSystemPickerProps = {
  front: TireSystem;
  rear: TireSystem;
  onChange: (next: { front: TireSystem; rear: TireSystem }) => void;
  /** Colors from the surrounding theme (carbon / steel / ink). */
  colors?: { text: string; muted: string; border: string; on: string; onText: string };
  labelFront?: string;
  labelRear?: string;
};

const DEFAULT_COLORS = { text: "#F2F2F0", muted: "#8A8F98", border: "#2A2E36", on: "#F2F2F0", onText: "#101214" };

export function TireSystemPicker({ front, rear, onChange, colors = DEFAULT_COLORS, labelFront = "Front", labelRear = "Rear" }: TireSystemPickerProps) {
  const row = (end: "front" | "rear", value: TireSystem, label: string) => (
    <View style={styles.row} accessibilityLabel={`${label} tire system`}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <View style={styles.chips}>
        {TIRE_SYSTEMS.map((s) => {
          const on = s === value;
          return (
            <Pressable
              key={`${end}-${s}`}
              testID={`tire-${end}-${s}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(end === "front" ? { front: s, rear } : { front, rear: s })}
              style={[styles.chip, { borderColor: on ? colors.on : colors.border, backgroundColor: on ? colors.on : "transparent" }]}
            >
              <Text style={[styles.chipText, { color: on ? colors.onText : colors.text }]}>{TIRE_SYSTEM_LABEL[s]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      {row("front", front, labelFront)}
      {row("rear", rear, labelRear)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6 },
  label: { fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "600" },
});
