// components/TuneTeaseCard.tsx
// Signup-screen tease (v2.3.0 redesign): a compact blurred settings card
// directly above the headline — the account is the last step between the
// rider and their numbers.
//
// ⚠️ PAYWALL INTEGRITY: this card renders STATIC DECOY values, never the
// rider's real tune. A weak blur over real numbers is recoverable from a
// screenshot, and this card sits BEFORE signup — real values here would be
// the cheapest paywall bypass in the app. The component takes no value
// props at all (structurally incapable of leaking); the screen consults the
// pending tune ONLY to decide render/no-render and whether an air row
// exists for this bike.
//
// Blur treatment matches the locked-results BlurCards verbatim
// (intensity 30, tint by background) — params copied, not shared (ship-day
// scope; see tune-results.tsx BlurCard).

import { BlurView } from "expo-blur";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

// Plausible mid-range decoys. Exported so tests can pin that ONLY these
// strings ever render.
export const TEASE_DECOY_FORK = "14 clicks";
export const TEASE_DECOY_SHOCK = "11 clicks";
export const TEASE_DECOY_AIR = "10.2 bar";

export function TuneTeaseCard({ showAir }: { showAir: boolean }) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  const rows = [
    { label: "Fork compression", text: TEASE_DECOY_FORK },
    { label: "Shock rebound", text: TEASE_DECOY_SHOCK },
    ...(showAir ? [{ label: "Air pressure", text: TEASE_DECOY_AIR }] : []),
  ];

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
