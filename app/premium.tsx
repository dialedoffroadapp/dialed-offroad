// app/premium.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { refreshProFromRC } from "../lib/purchases";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

const DEV_FORCE_PRO_KEY = "dev_force_pro_v1";

export default function PremiumScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // ✅ Where to go after the paywall closes
  const params = useLocalSearchParams<{ returnTo?: string; dev?: string }>();
  const returnTo =
    typeof params.returnTo === "string" && params.returnTo.length > 0
      ? params.returnTo
      : "/tune-results";

  // ✅ Dev override (use /premium?dev=1)
  const devMode = __DEV__ && params.dev === "1";

  useEffect(() => {
    let isMounted = true;

    const forceProForDev = async () => {
      // Local flag (nice for debugging / future checks)
      await AsyncStorage.setItem(DEV_FORCE_PRO_KEY, "1");

      // Try to mark the signed-in user as pro in Supabase (so your existing isPro check works)
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      if (!user?.id) {
        toast.show("Dev Pro: sign in first", { kind: "error" });
        return;
      }

      // 30 days in the future
      const proUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await supabase
        .from("profiles")
        .update({ is_pro: true, pro_until: proUntil })
        .eq("user_id", user.id);

      if (error) throw error;

      toast.show("Dev Pro enabled ✅", { kind: "success" });
    };

    const showPaywall = async () => {
      try {
        // ✅ DEV: skip paywall entirely
        if (devMode) {
          await forceProForDev();
          return;
        }

        const result = await RevenueCatUI.presentPaywall({
          dismissAutomatically: true,
        });

        if (!isMounted) return;

        if (
          result === PAYWALL_RESULT.PURCHASED ||
          result === PAYWALL_RESULT.RESTORED
        ) {
          // sync RC entitlements → Supabase profiles
          await refreshProFromRC();
          toast.show("Pro unlocked 🎉", { kind: "success" });
        }
      } catch (e: any) {
        if (!isMounted) return;
        console.log("Paywall error", e);
        toast.show("Could not open paywall", { kind: "error" });
      } finally {
        // ✅ Always land back on Tune Results (or whatever returnTo says)
        if (isMounted) {
          router.replace(returnTo);
        }
      }
    };

    showPaywall();

    return () => {
      isMounted = false;
    };
  }, [router, toast, returnTo, devMode]);

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
        {devMode ? "Enabling Dev Pro…" : "Loading Pro options…"}
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
