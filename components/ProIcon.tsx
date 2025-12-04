import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function ProIcon() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.glyph}>★</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(59,130,246,0.15)",
    borderWidth: 1, borderColor: "rgba(59,130,246,0.4)",
  },
  glyph: { color: "#60A5FA", fontWeight: "900", lineHeight: 18, fontSize: 12 },
});
