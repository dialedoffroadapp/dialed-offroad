import { Link } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "../constants/theme";

export function LegalLinks({ centered = true }: { centered?: boolean }) {
  return (
    <View style={[styles.row, centered && { justifyContent: "center" }]}>
      <Link href="/legal/terms" asChild>
        <Text style={styles.link}>Terms</Text>
      </Link>
      <Text style={styles.sep}> • </Text>
      <Link href="/legal/privacy" asChild>
        <Text style={styles.link}>Privacy</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginTop: 10 },
  link: { color: COLORS.MUTED, textDecorationLine: "underline", fontWeight: "700" },
  sep: { color: COLORS.MUTED },
});
