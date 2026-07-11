// components/TrialPromptModal.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

export const TRIAL_MODAL_DISMISS_KEY = "dialed_trial_modal_dismissals_v1";
export const TRIAL_MODAL_MAX_DISMISSALS = 3;

type Props = {
  visible: boolean;
  bikeTitle: string;
  /**
   * Lapsed subscriber (pro_until set but in the past). Apple/Google will NOT
   * grant these users a second free trial, so showing "Free for 7 days" is
   * false advertising — and unclear trial terms have caused Google Play
   * rejections before. Lapsed users get winback copy instead.
   */
  lapsed?: boolean;
  onRequestClose: () => void;
};

export default function TrialPromptModal({
  visible,
  bikeTitle,
  lapsed = false,
  onRequestClose,
}: Props) {
  const router = useRouter();
  const { colors: C } = useTheme();
  const insets = useSafeAreaInsets();

  const handleDismiss = async () => {
    try {
      const raw = await AsyncStorage.getItem(TRIAL_MODAL_DISMISS_KEY);
      const count = raw ? parseInt(raw, 10) : 0;
      await AsyncStorage.setItem(TRIAL_MODAL_DISMISS_KEY, String(count + 1));
    } catch {
      // ignore
    }
    onRequestClose();
  };

  const handleStartTrial = () => {
    // Do NOT increment dismiss count when user taps the primary CTA.
    onRequestClose();
    // Lapsed subscribers get the dedicated winback screen (their own data as
    // the hook, annual-first); trial-eligible users go to the paywall.
    router.push(lapsed ? ("/winback" as any) : "/premium");
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: C.CARD,
              borderColor: C.BORDER,
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
        >
          {/* Title */}
          <Text style={[styles.title, { color: C.TEXT }]} numberOfLines={2}>
            {lapsed
              ? "Welcome back — pick up where your setup left off"
              : `${bikeTitle} is ready to get dialed`}
          </Text>

          {/* Body */}
          <Text style={[styles.body, { color: C.MUTED }]}>
            {lapsed
              ? "Your bikes, sessions, and setup history are all still here. Resubscribe to keep refining with exact compression, rebound, and sag clicks."
              : "Get exact compression, rebound, and sag clicks for your specific bike, weight, and track. Free for 7 days."}
          </Text>

          {/* Primary CTA */}
          <Pressable
            onPress={handleStartTrial}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: C.ACCENT, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Text style={styles.primaryText}>
              {lapsed ? "Resubscribe · $7.99/mo" : "Start My Free Trial"}
            </Text>
          </Pressable>

          {/* Secondary CTA */}
          <Pressable
            onPress={handleDismiss}
            hitSlop={10}
            style={styles.secondaryBtn}
          >
            <Text style={[styles.secondaryText, { color: C.MUTED }]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    padding: 24,
    paddingTop: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 26,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryBtn: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
  },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
