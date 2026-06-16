import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { OnboardingStep } from "../lib/onboarding";
import { useOnboarding } from "../lib/onboarding";
import { useTheme } from "../lib/theme";

const TOTAL = 4;

// Steps 1–3 map to screens; step 4 ("Unlock") happens on the signup/paywall
// screens which don't show this indicator.
const STEP_MAP: Partial<Record<OnboardingStep, { step: number; label: string }>> = {
  garage_locked:  { step: 1, label: "Set Up Your Bike" },
  tune:           { step: 2, label: "Build Your Setup" },
  results_locked: { step: 3, label: "View Your Results" },
};

export function OnboardingProgress() {
  const { onboardingActive, state } = useOnboarding();
  const { colors: C } = useTheme();

  if (!onboardingActive) return null;

  const entry = STEP_MAP[state.onboardingStep];
  if (!entry) return null;

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: C.ACCENT }]} />
      <Text style={[styles.label, { color: C.ACCENT }]}>
        Step {entry.step} of {TOTAL} — {entry.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
