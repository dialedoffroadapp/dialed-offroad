import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function ProBadge({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.badge, compact && styles.compact]}>
      <Text style={[styles.text, compact && styles.textCompact]}>Pro</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#3B82F6",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  text: { color: "#fff", fontWeight: "900", fontSize: 11 },
  compact: { paddingHorizontal: 6, paddingVertical: 3 },
  textCompact: { fontSize: 10 },
});
