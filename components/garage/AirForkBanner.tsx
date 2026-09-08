// components/garage/AirForkBanner.tsx
// Returning riders on the nine region-ambiguous 2016 rows (2026-09-08): a
// one-time inline banner on the bike page asking air or coil. Save goes
// through the same path Add a bike uses (upsertQuizBike); Dismiss writes
// nothing and the banner returns on the next visit. Plain react-native so it
// renders under the jest stubs.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export const AIR_FORK_BANNER_LINE = "Your 2016 shipped with either air or coil forks depending on region. Which does yours have?";

export type AirForkBannerProps = {
  onChoose: (airFork: boolean) => void;
  onDismiss: () => void;
  busy?: boolean;
  colors?: { text: string; muted: string; border: string; accent: string; onAccent: string };
};

const DEFAULT_COLORS = { text: "#F5F7FC", muted: "#8A93A6", border: "#2A2E36", accent: "#1D9BF0", onAccent: "#0B0C10" };

export function AirForkBanner({ onChoose, onDismiss, busy = false, colors = DEFAULT_COLORS }: AirForkBannerProps) {
  return (
    <View style={[styles.card, { borderColor: colors.border }]} accessibilityLabel="Air or coil fork">
      <Text style={[styles.line, { color: colors.text }]}>{AIR_FORK_BANNER_LINE}</Text>
      <View style={styles.buttons}>
        <Pressable testID="air-fork-banner-air" accessibilityRole="button" disabled={busy} onPress={() => onChoose(true)} style={[styles.button, { backgroundColor: colors.accent }]}>
          <Text style={[styles.buttonText, { color: colors.onAccent }]}>Air fork (WP AER 48)</Text>
        </Pressable>
        <Pressable testID="air-fork-banner-coil" accessibilityRole="button" disabled={busy} onPress={() => onChoose(false)} style={[styles.button, { backgroundColor: colors.accent }]}>
          <Text style={[styles.buttonText, { color: colors.onAccent }]}>Coil fork (WP 4CS)</Text>
        </Pressable>
      </View>
      <Pressable testID="air-fork-banner-dismiss" accessibilityRole="button" onPress={onDismiss} hitSlop={8} style={styles.dismiss}>
        <Text style={[styles.dismissText, { color: colors.muted }]}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14, gap: 10 },
  line: { fontSize: 14, lineHeight: 19 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  buttonText: { fontSize: 13, fontWeight: "700" },
  dismiss: { alignSelf: "flex-start" },
  dismissText: { fontSize: 12 },
});
