// components/v3/DateChips.tsx
// A no-keyboard date picker made of chips: a month row and a day row. Used
// for the next-ride date and race dates. Returns local-midnight Dates.
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Chip, Label } from "./primitives";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DateChips({
  value,
  onChange,
  minDate,
  monthsAhead = 12,
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  minDate?: Date;
  monthsAhead?: number;
}) {
  const min = minDate ?? new Date();
  const months = useMemo(() => {
    const out: { y: number; m: number }[] = [];
    let y = min.getFullYear();
    let m = min.getMonth();
    for (let i = 0; i < monthsAhead; i++) {
      out.push({ y, m });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }, [min, monthsAhead]);

  const selY = value?.getFullYear() ?? months[0].y;
  const selM = value?.getMonth() ?? months[0].m;
  const daysInMonth = new Date(selY, selM + 1, 0).getDate();
  const minDay = selY === min.getFullYear() && selM === min.getMonth() ? min.getDate() : 1;

  return (
    <View>
      <Label style={{ marginBottom: 8 }}>Month</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {months.map(({ y, m }) => {
          const on = y === selY && m === selM;
          return (
            <Chip
              key={`${y}-${m}`}
              label={`${MONTHS[m]}${y !== min.getFullYear() ? ` ${y}` : ""}`}
              on={on}
              onPress={() => {
                const d = Math.max(minDay, Math.min(value?.getDate() ?? minDay, new Date(y, m + 1, 0).getDate()));
                onChange(new Date(y, m, d));
              }}
            />
          );
        })}
      </ScrollView>
      <Label style={{ marginTop: 14, marginBottom: 8 }}>Day</Label>
      <View style={styles.days}>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1)
          .filter((d) => d >= minDay)
          .map((d) => (
            <Chip key={d} label={String(d)} on={value?.getDate() === d && value.getMonth() === selM} onPress={() => onChange(new Date(selY, selM, d))} />
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 2 },
  days: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
});
