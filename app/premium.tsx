// app/premium.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import {
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import { syncProFromRevenueCat } from "../lib/purchases";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { clearFunnelId, getOrCreateFunnelId, logEvent } from "../lib/usage";

const DEV_FORCE_PRO_KEY = "dev_force_pro_v1";

export default function PremiumScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    state,
    completeOnboarding,
    setStep,
  } = useOnboarding();

  // ✅ Where to go after the paywall closes
  const params = useLocalSearchParams<{ returnTo?: string; dev?: string }>();
  const returnTo =
    typeof params.returnTo === "string" && params.returnTo.length > 0
      ? params.returnTo
      : "/tune-results";

  // ✅ Dev override (use /premium?dev=1)
  const devMode = __DEV__ && params.dev === "1";
  const isOnboardingTrial = state.onboardingStep === "trial";
  const onboardingAgeMs = React.useMemo(() => {
    const parsed = Date.parse(state.lastUpdatedAt);
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  }, [state.lastUpdatedAt]);
  const ageMinutesSinceLastStep = Math.round(onboardingAgeMs / 60000);

  useEffect(() => {
    let isMounted = true;

    const handleOnboardingSuccess = async () => {
      const funnelId = await getOrCreateFunnelId();
      await logEvent("onboarding_trial_started", {
        funnel_id: funnelId,
        onboarding_step: state.onboardingStep,
        signed_in: true,
        account_created: state.accountCreated,
        trial_started: true,
        onboarding_complete: false,
        pending_tune_exists: !!(await readPendingTune()).tune,
        resume: ageMinutesSinceLastStep >= 5,
        age_minutes_since_last_step: ageMinutesSinceLastStep,
        source_route: "/premium",
      });
      await completeOnboarding();
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.id) {
        await supabase.from("profiles").upsert(
          {
            user_id: authData.user.id,
            onboarding_complete: true,
            onboarding_step: "complete",
          },
          { onConflict: "user_id" }
        );
      }
      const { tune: pending } = await readPendingTune();
      await logEvent("onboarding_completed", {
        funnel_id: funnelId,
        onboarding_step: "complete",
        signed_in: true,
        account_created: true,
        trial_started: true,
        onboarding_complete: true,
        pending_tune_exists: !!pending,
        resume: ageMinutesSinceLastStep >= 5,
        age_minutes_since_last_step: ageMinutesSinceLastStep,
        source_route: "/premium",
      });
      await clearFunnelId();
      return pending ? "/tune-results" : "/(tabs)";
    };

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
      let target = returnTo;

      try {
        // ✅ DEV: skip paywall entirely
        if (devMode) {
          await forceProForDev();
          if (isOnboardingTrial) {
            target = await handleOnboardingSuccess();
          }
          return;
        }

        if (isOnboardingTrial) {
          const funnelId = await getOrCreateFunnelId();
          await logEvent("onboarding_paywall_shown", {
            funnel_id: funnelId,
            onboarding_step: state.onboardingStep,
            signed_in: true,
            account_created: state.accountCreated,
            trial_started: state.trialStarted,
            onboarding_complete: state.onboardingComplete,
            pending_tune_exists: !!(await readPendingTune()).tune,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/premium",
          });
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
          const synced = await syncProFromRevenueCat();
          if (!synced) {
            toast.show("Purchase recorded but profile sync failed. Please restart the app.", { kind: "error" });
            return;
          }
          toast.show("Pro unlocked 🎉", { kind: "success" });
          if (isOnboardingTrial) {
            target = await handleOnboardingSuccess();
          }
        } else if (isOnboardingTrial) {
          const funnelId = await getOrCreateFunnelId();
          const { tune: pending } = await readPendingTune();
          await logEvent("onboarding_paywall_dismissed", {
            funnel_id: funnelId,
            onboarding_step: state.onboardingStep,
            signed_in: true,
            account_created: state.accountCreated,
            trial_started: state.trialStarted,
            onboarding_complete: state.onboardingComplete,
            pending_tune_exists: !!pending,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/premium",
            paywall_result: "dismissed",
          });
          await setStep("trial");
          // Drop to garage (tabs visible, Tune/Sessions locked) instead of the
          // blurred-results loop that existed before this change.
          target = "/(tabs)/garage";
        }
      } catch (e: any) {
        if (!isMounted) return;
        console.log("Paywall error", e);
        toast.show("Could not open paywall", { kind: "error" });
        if (isOnboardingTrial) {
          const funnelId = await getOrCreateFunnelId();
          const { tune: pending } = await readPendingTune();
          await logEvent("onboarding_paywall_dismissed", {
            funnel_id: funnelId,
            onboarding_step: state.onboardingStep,
            signed_in: true,
            account_created: state.accountCreated,
            trial_started: state.trialStarted,
            onboarding_complete: state.onboardingComplete,
            pending_tune_exists: !!pending,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/premium",
            paywall_result: "error",
            error_code: e?.code ?? e?.message ?? "unknown",
          });
          await setStep("trial");
          target = "/(tabs)/garage";
        }
      } finally {
        // ✅ Always land back on Tune Results (or whatever returnTo says)
        if (isMounted) {
          router.replace(target);
        }
      }
    };

    showPaywall();

    return () => {
      isMounted = false;
    };
  }, [
    devMode,
    ageMinutesSinceLastStep,
    completeOnboarding,
    isOnboardingTrial,
    returnTo,
    router,
    setStep,
    state.accountCreated,
    state.onboardingComplete,
    state.onboardingStep,
    state.trialStarted,
    toast,
  ]);

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
        {devMode
          ? "Enabling Dev Pro…"
          : isOnboardingTrial
            ? "Preparing your setup reveal…"
            : "Loading Pro options…"}
      </Text>
      {isOnboardingTrial ? (
        <Text style={[styles.subtext, { color: colors.MUTED }]}>
          {state.hasSeenIntro
            ? "Your tune is ready — start your free trial to unlock it."
            : "Your tune is ready. Start your free trial to reveal the exact numbers and notes."}
        </Text>
      ) : null}
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
  subtext: {
    marginTop: 10,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 28,
    lineHeight: 20,
  },
});
