import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

/**
 * Small pill chip used in summary rows on tune-results screens.
 */
export function Chip({ label }: { label: string }) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  return (
    <View style={S.chip}>
      <Text numberOfLines={1} style={S.text}>{label}</Text>
    </View>
  );
}

const makeStyles = (C: {
  TEXT: string;
  BORDER: string;
  CHIP_BG?: string;
}) =>
  StyleSheet.create({
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.06)",
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    text: { color: C.TEXT, fontSize: 12, fontWeight: "700" },
  });
