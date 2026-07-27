// app/premium.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { autoCreateBaselineFromPendingTune } from "../lib/autoBaseline";
import {
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import {
  getCustomerInfo,
  hasPurchasedThisSession,
  isPro as isProEntitlement,
  markPurchasedThisSession,
  syncProFromRevenueCat,
  withTimeout,
} from "../lib/purchases";
import { shouldLogDeclinerConversion } from "../lib/paywallDecliner";
import { scheduleRideReminder } from "../lib/rideReminder";
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

  // One presentation attempt per mount. The effect's deps include onboarding
  // state that the SUCCESS PATH ITSELF advances (completeOnboarding flips
  // onboardingStep/onboardingComplete/lastUpdatedAt while this screen is still
  // mounted), which re-ran the effect and presented the paywall a second time
  // right at the unlock transition.
  const presentedRef = React.useRef(false);

  // Navigation off this screen must be UNCONDITIONAL once the paywall flow
  // finishes. It used to be gated on the effect closure's isMounted flag —
  // but the success path itself advances onboarding state, which re-runs the
  // effect and flips the ORIGINAL closure's isMounted to false before its
  // finally could navigate (the re-run bails on presentedRef without
  // navigating either). Result: purchase succeeded, nobody navigated, the
  // screen's spinner sat forever. navigatedRef dedupes instead of gating.
  const navigatedRef = React.useRef(false);

  useEffect(() => {
    let isMounted = true;

    const go = (dest: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      router.replace(dest as any);
    };

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

      // Recovery-funnel metric. EVERY purchase passes through the trial step
      // (signup sets it minutes before the day-0 paywall), so "prior state
      // was trial" alone would count normal funnel conversions too — the
      // >=5min resume gate inside shouldLogDeclinerConversion separates a
      // decliner who came back from a straight-through funnel purchase.
      if (
        shouldLogDeclinerConversion(state.onboardingStep, ageMinutesSinceLastStep)
      ) {
        void logEvent("decliner_converted", {
          funnel_id: funnelId,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
        });
      }

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

      // Auto-save the onboarding tune as v1 so Home's ActiveSetupCard, the
      // tune tab's RunningSetupRow, and Bike Home all render real state on
      // Day 1 without the rider having to tap "Save Setup". Returns null on
      // any failure/skip — never blocks onboarding completion. The manual
      // Save button stays idempotent against this row (tune-results.tsx).
      const autoBaseline = await autoCreateBaselineFromPendingTune();
      if (autoBaseline) {
        // No-op unless notification permission is already granted — for a
        // brand-new user the inline ask on the results screen (which follows
        // this navigation) grants and schedules instead.
        void scheduleRideReminder({
          versionId: autoBaseline.version.id,
          versionNumber: autoBaseline.version.version_number,
          bikeName: autoBaseline.bikeTitle,
        });
      }

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

      if (presentedRef.current) return; // effect re-run — never present twice
      presentedRef.current = true;

      // Session purchase flag is authoritative: once any purchase succeeded
      // this session, no gate presents the paywall again — advance straight
      // to the unlocked app (completing onboarding if that's where we are).
      if (hasPurchasedThisSession()) {
        try {
          if (isOnboardingTrial) {
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
          }
        } catch (e) {
          console.warn("post-purchase advance failed", e);
        } finally {
          go(target);
        }
        return;
      }

      try {
        // ✅ DEV: skip paywall entirely
        if (devMode) {
          await forceProForDev();
          markPurchasedThisSession();
          if (isOnboardingTrial) {
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
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

        if (
          result === PAYWALL_RESULT.PURCHASED ||
          result === PAYWALL_RESULT.RESTORED
        ) {
          // Flag FIRST — synchronously, before any state advance or await —
          // so no gate anywhere can re-present this session.
          markPurchasedThisSession();
          // Best-effort profile sync (self-timeboxed inside). A miss is fine:
          // the session flag already unlocks the client and the RevenueCat
          // webhook heals the profile server-side. Never block the unlock.
          const synced = await syncProFromRevenueCat();
          if (!synced) {
            console.warn("[paywall] pro sync deferred to webhook");
          }
          toast.show("Pro unlocked 🎉", { kind: "success" });
          if (isOnboardingTrial) {
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
          }
        } else if (isOnboardingTrial) {
          // Paywall dismissed without PURCHASED/RESTORED — but the user may
          // already have an active entitlement (e.g. "already a member" from
          // the same Apple ID). Check RevenueCat directly before giving up.
          const info = await withTimeout(getCustomerInfo(), 5000, null);
          if (isProEntitlement(info)) {
            markPurchasedThisSession();
            void syncProFromRevenueCat(); // best-effort; webhook heals
            toast.show("Pro unlocked", { kind: "success" });
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
            // Skip the dismissal log — this is a success, not a dismissal.
            return;
          }

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
          target = pending ? "/tune-results" : "/(tabs)/tune";
        }
      } catch (e: any) {
        if (!isMounted) return;
        console.log("Paywall error", e);
        toast.show("Could not open paywall", { kind: "error" });
        if (isOnboardingTrial) {
          // Same fallback: the error may mask an existing entitlement
          const info = await withTimeout(getCustomerInfo(), 5000, null);
          if (isProEntitlement(info)) {
            markPurchasedThisSession();
            void syncProFromRevenueCat(); // best-effort; webhook heals
            toast.show("Pro unlocked", { kind: "success" });
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
            return;
          }

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
          target = pending ? "/tune-results" : "/(tabs)/tune";
        }
      } finally {
        // ✅ Navigation is unconditional: the flow finished, so we leave —
        // regardless of whether a state advance re-ran this effect and
        // flipped this closure's isMounted. navigatedRef dedupes.
        go(target);
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
            ? "Your tune is ready. Start your free trial to unlock it."
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
