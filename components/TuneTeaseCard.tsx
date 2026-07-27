// components/TuneTeaseCard.tsx
// Signup-screen tease (v2.3.0 redesign): the rider's REAL pending-tune
// values, compact and blurred, directly above the headline — the account is
// the last step between them and these numbers. Values come from the same
// pending tune the locked results screen reads; the screen hides this card
// entirely when no pending tune exists (direct signup route).
//
// Blur treatment matches the locked-results BlurCards verbatim
// (intensity 30, tint by background) — deliberately not extracted from
// app/tune-results.tsx today; params are copied, not shared (ship-day scope).

import { BlurView } from "expo-blur";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

export type TuneTeaseValues = {
  fork_comp: number | null;
  shock_reb: number | null;
  air_bar: number | null;
};

export function TuneTeaseCard({ values }: { values: TuneTeaseValues }) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  const rows = [
    {
      label: "Fork compression",
      text: values.fork_comp != null ? `${values.fork_comp} clicks` : null,
    },
    {
      label: "Shock rebound",
      text: values.shock_reb != null ? `${values.shock_reb} clicks` : null,
    },
    {
      label: "Air pressure",
      text: values.air_bar != null ? `${values.air_bar.toFixed(2)} bar` : null,
    },
  ].filter((r) => r.text !== null);

  if (rows.length === 0) return null;

  return (
    <View style={S.card}>
      <Text style={S.header}>YOUR TUNE IS READY</Text>
      {rows.map((r) => (
        <View key={r.label} style={S.row}>
          <Text style={S.label}>{r.label}</Text>
          <View style={S.valueWrap}>
            <Text style={S.value}>{r.text}</Text>
            <BlurView
              intensity={30}
              tint={C.BG === "#FFFFFF" ? "light" : "dark"}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (C: {
  CARD: string;
  TEXT: string;
  MUTED: string;
  ACCENT: string;
  BORDER: string;
  BG: string;
}) =>
  StyleSheet.create({
    // Budget: header (~16) + 3 rows (~24 each) + padding ≈ 100pt, under the
    // 110pt cap.
    card: {
      backgroundColor: C.CARD,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.BORDER,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 20,
    },
    header: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.4,
      marginBottom: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 3,
    },
    label: {
      color: C.MUTED,
      fontSize: 13,
    },
    // overflow keeps the blur clipped to the value pill.
    valueWrap: {
      borderRadius: 6,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    value: {
      color: C.ACCENT,
      fontSize: 14,
      fontWeight: "800",
    },
  });
