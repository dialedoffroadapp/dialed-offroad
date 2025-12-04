// app/premium.tsx
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { refreshProFromRC } from "../lib/purchases";
import { useTheme } from "../lib/theme";

export default function PremiumScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let isMounted = true;

    const showPaywall = async () => {
      try {
        const result = await RevenueCatUI.presentPaywall({
          dismissAutomatically: true,
        });

        if (!isMounted) return;

        if (
          result === PAYWALL_RESULT.PURCHASED ||
          result === PAYWALL_RESULT.RESTORED
        ) {
          // 🔵 NEW: sync RC entitlements → Supabase profiles
          await refreshProFromRC();

          toast.show("Pro unlocked 🎉", { kind: "success" });
        }
      } catch (e: any) {
        if (!isMounted) return;
        console.log("Paywall error", e);
        toast.show("Could not open paywall", { kind: "error" });
      } finally {
        // Always go back once the paywall closes (purchase, restore, cancel, or error)
        if (isMounted) {
          router.back();
        }
      }
    };

    showPaywall();

    return () => {
      isMounted = false;
    };
  }, [router, toast]);

  // Simple loading state while the native paywall is being presented
  return (
    <View
      style={[
        styles.center,
        {
          paddingTop: insets.top,
          backgroundColor: colors.BG,
        },
      ]}
    >
      <ActivityIndicator color={colors.TEXT} />
      <Text style={[styles.text, { color: colors.MUTED }]}>
        Loading Pro options…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    marginTop: 8,
    fontSize: 14,
  },
});
