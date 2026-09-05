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
import { completeOnboardingSequence } from "../lib/onboardingCompletion";
import { PAYWALL_SEEN_KEY, parsePaywallTrigger } from "../lib/paywall";
import {
  getCustomerInfo,
  hasPurchasedThisSession,
  isPro as isProEntitlement,
  markPurchasedThisSession,
  syncProFromRevenueCat,
  withTimeout,
} from "../lib/purchases";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";

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
  const params = useLocalSearchParams<{
    returnTo?: string;
    dev?: string;
    trigger?: string;
  }>();
  const hasReturnTo =
    typeof params.returnTo === "string" && params.returnTo.length > 0;
  const returnTo = hasReturnTo ? (params.returnTo as string) : "/tune-results";

  // ✅ Dev override (use /premium?dev=1)
  const devMode = __DEV__ && params.dev === "1";
  const isOnboardingTrial = state.onboardingStep === "trial";
  // Which Pro action summoned the paywall (lib/paywall.ts). The funnel's
  // auto-present is "onboarding_interstitial"; every gate names itself, and
  // every paywall event below carries it (paywall_position is stamped
  // centrally in lib/usage.ts).
  const parsedTrigger = parsePaywallTrigger(params.trigger);
  const trigger =
    parsedTrigger === "unspecified" && isOnboardingTrial
      ? "onboarding_interstitial"
      : parsedTrigger;
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
      // "back": action-gated triggers return to the screen that summoned
      // the paywall instead of replacing to a route (lib/paywall.ts).
      if (dest === "back") {
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)" as any);
        return;
      }
      router.replace(dest as any);
    };

    // The completion sequence itself lives in lib/onboardingCompletion.ts
    // (shared with the action-gated world, where it runs at signup).
    const handleOnboardingSuccess = async () => {
      const done = await completeOnboardingSequence({
        completeOnboarding,
        onboardingStep: state.onboardingStep,
        accountCreated: state.accountCreated,
        trialStarted: state.trialStarted,
        ageMinutesSinceLastStep,
        sourceRoute: "/premium",
        viaPaywall: true,
        // A caller-supplied returnTo (the quiz reveal) wins; absent, the
        // shipped destinations apply.
        returnTo: hasReturnTo ? returnTo : undefined,
        extraMeta: { paywall_trigger_action: trigger },
      });
      return done.target;
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
            paywall_trigger_action: trigger,
          });
        }

        // Position-agnostic presentation events: every trigger, every world
        // (the onboarding_* events above stay funnel-only, as shipped).
        void AsyncStorage.setItem(PAYWALL_SEEN_KEY, "1").catch(() => {});
        void logEvent("paywall_shown", {
          paywall_trigger_action: trigger,
          onboarding: isOnboardingTrial,
        });

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
          void logEvent("paywall_purchased", {
            paywall_trigger_action: trigger,
            onboarding: isOnboardingTrial,
            result: result === PAYWALL_RESULT.RESTORED ? "restored" : "purchased",
          });
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
            void logEvent("paywall_purchased", {
              paywall_trigger_action: trigger,
              onboarding: true,
              result: "entitled",
            });
            target = await withTimeout(handleOnboardingSuccess(), 8000, "/(tabs)");
            // Skip the dismissal log — this is a success, not a dismissal.
            return;
          }
          void logEvent("paywall_dismissed", {
            paywall_trigger_action: trigger,
            onboarding: true,
            result: "dismissed",
          });

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
            paywall_trigger_action: trigger,
            paywall_result: "dismissed",
          });
          await setStep("trial");
          // A caller-supplied returnTo (the quiz reveal) wins on dismiss and error
          // too (decision 15); the legacy results screen is the fallback only.
          target = hasReturnTo ? returnTo : pending ? "/tune-results" : "/(tabs)/tune";
        } else {
          void logEvent("paywall_dismissed", {
            paywall_trigger_action: trigger,
            onboarding: false,
            result: "dismissed",
          });
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
            paywall_trigger_action: trigger,
            paywall_result: "error",
            error_code: e?.code ?? e?.message ?? "unknown",
          });
          await setStep("trial");
          // A caller-supplied returnTo (the quiz reveal) wins on dismiss and error
          // too (decision 15); the legacy results screen is the fallback only.
          target = hasReturnTo ? returnTo : pending ? "/tune-results" : "/(tabs)/tune";
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
    hasReturnTo,
    trigger,
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
