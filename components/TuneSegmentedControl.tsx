import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

type Mode = "balanced" | "comfort" | "precision";

function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Balanced / Comfort / Precision mode selector used on tune-results screens.
 * Uses the INK-background pill container style from the new design language.
 */
export function TuneSegmentedControl({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  return (
    <View style={S.wrap}>
      {(["balanced", "comfort", "precision"] as Mode[]).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          style={[S.seg, value === m && S.segOn]}
        >
          <Text style={[S.segText, value === m && S.segTextOn]}>{cap(m)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (C: {
  INK: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
}) =>
  StyleSheet.create({
    wrap: {
      flexDirection: "row",
      marginHorizontal: 16,
      marginTop: 14,
      backgroundColor: C.INK,
      borderRadius: 10,
      padding: 3,
    },
    seg: {
      flex: 1,
      paddingVertical: 9,
      alignItems: "center",
      borderRadius: 8,
    },
    segOn: {
      backgroundColor: C.CARD,
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    segText: { color: C.MUTED, fontSize: 13, fontWeight: "700" },
    segTextOn: { color: C.TEXT, fontWeight: "800" },
  });
