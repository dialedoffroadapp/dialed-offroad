// app/index.tsx
import { useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  type OnboardingStep,
  readLocalOnboardingState,
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import { reconcileGuestBikes } from "../lib/bikeReconcile";
import { deriveIsPro } from "../lib/proUtils";
import { supabase } from "../lib/supabase";

SplashScreen.preventAutoHideAsync().catch(() => {});

type ProfileBootRow = {
  onboarding_complete?: boolean | null;
  onboarding_step?: string | null;
  is_pro?: boolean | null;
  pro_until?: string | null;
  trial_tunes_used?: number | null;
};

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    value === "intro" ||
    value === "garage_locked" ||
    value === "tune" ||
    value === "results_locked" ||
    value === "signup" ||
    value === "trial" ||
    value === "complete"
  );
}

export default function IndexGate() {
  const router = useRouter();
  const [readyToHide, setReadyToHide] = useState(false);
  const hidOnce = useRef(false);
  const didNavigateRef = useRef(false);
  const { hydrated, replaceState, setStep } = useOnboarding();

  useEffect(() => {
    // Wait for the OnboardingProvider to finish its hydration READ before any
    // boot resolution. The reconciliation write below goes through the
    // provider's replaceState, so ordering the whole effect after hydration
    // guarantees read-then-write — the write can never race the hydration read.
    if (!hydrated) return;

    let mounted = true;

    (async () => {
      try {
        const [{ data: sessionData }, localState, { tune: pendingTune }] =
          await Promise.all([
            supabase.auth.getSession(),
            readLocalOnboardingState(),
            readPendingTune(),
          ]);

        if (!mounted || didNavigateRef.current) return;

        const session = sessionData?.session;
        const userId = session?.user?.id ?? null;

        let profile: ProfileBootRow | null = null;
        let hasLegacyUsage = false;
        if (userId) {
          const { data } = await supabase
            .from("profiles")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();

          if (!mounted || didNavigateRef.current) return;
          profile = (data as ProfileBootRow | null) ?? null;

          // Reconcile guest-era bike state for signed-in users: migrates any
          // surviving guest-store bikes into the bikes table (deduped), retries
          // the signup-time sync record (previously "Fix 4"), remaps the guest
          // default-bike key, and heals local bike ids inside the pending tune.
          try {
            await reconcileGuestBikes(userId);
          } catch {
            // Non-critical
          }

          // Only run the legacy-usage heuristic for genuine pre-onboarding-system
          // users. Two signals disqualify a user from "legacy":
          //  1. The profile says mid-onboarding (a known non-complete step).
          //  2. THIS DEVICE has funnel state in AsyncStorage — a mid-flow local
          //     step, or intro seen without completing. The funnel itself
          //     migrates the guest bike at signup, so a bike count alone must
          //     never auto-complete a funnel user whose profile step-write
          //     failed (null step) — that would skip the trial/paywall.
          const isMidOnboarding =
            profile?.onboarding_step != null &&
            isOnboardingStep(profile.onboarding_step) &&
            profile.onboarding_step !== "complete";

          const hasLocalFunnelState =
            !localState.onboardingComplete &&
            ((localState.onboardingStep !== "intro" &&
              localState.onboardingStep !== "complete") ||
              localState.hasSeenIntro);

          if (
            !isMidOnboarding &&
            !hasLocalFunnelState &&
            !profile?.onboarding_complete &&
            !profile?.is_pro &&
            !(
              profile?.pro_until &&
              new Date(profile.pro_until).getTime() > Date.now()
            )
          ) {
            const [bikesRes, sessionsRes, presetsRes] = await Promise.all([
              supabase
                .from("bikes")
                .select("*", { count: "exact", head: true })
                .eq("user_id", userId),
              supabase
                .from("sessions")
                .select("*", { count: "exact", head: true })
                .eq("user_id", userId),
              supabase
                .from("user_presets")
                .select("*", { count: "exact", head: true })
                .eq("user_id", userId),
            ]);

            if (!mounted || didNavigateRef.current) return;

            hasLegacyUsage =
              (profile?.trial_tunes_used ?? 0) > 0 ||
              (bikesRes.count ?? 0) > 0 ||
              (sessionsRes.count ?? 0) > 0 ||
              (presetsRes.count ?? 0) > 0;

            if (hasLegacyUsage) {
              const { error: upsertErr } = await supabase.from("profiles").upsert({
                user_id: userId,
                onboarding_complete: true,
                onboarding_step: "complete",
              });
              if (upsertErr) {
                console.warn("[IndexGate] legacy upsert failed:", upsertErr);
              }
            }
          }
        }

        const hasPro = deriveIsPro(profile);
        const onboardingComplete =
          hasPro ||
          profile?.onboarding_complete === true ||
          hasLegacyUsage ||
          localState.onboardingComplete;
        const onboardingStep =
          profile && isOnboardingStep(profile.onboarding_step)
            ? profile.onboarding_step
            : localState.onboardingStep;

        // Reconcile the resolved step back into local state (S2). Screens like
        // /premium read LOCAL state for their onboarding gating — without this
        // write, a fresh install with a mid-onboarding profile (e.g. "trial")
        // sees local step "intro", never runs the onboarding paywall handling,
        // and loops back to /premium on every cold start. replaceState updates
        // AsyncStorage AND the provider's in-memory state together, so screens
        // mounted after navigation see the reconciled value immediately.
        if (userId) {
          const resolvedStep: OnboardingStep = onboardingComplete
            ? "complete"
            : onboardingStep;
          if (
            localState.onboardingStep !== resolvedStep ||
            localState.onboardingComplete !== (resolvedStep === "complete") ||
            !localState.accountCreated
          ) {
            await replaceState((current) => ({
              ...current,
              onboardingStep: resolvedStep,
              onboardingComplete: resolvedStep === "complete",
              // Signed in ⇒ an account exists; record it so downstream auth
              // routing (results CTA) can distinguish "has account" from guest.
              accountCreated: true,
              // Any step past intro implies the intro was seen on some device.
              hasSeenIntro: current.hasSeenIntro || resolvedStep !== "intro",
            }));
          }
          if (!mounted || didNavigateRef.current) return;
        }

        let target = "/(tabs)/garage";

        if (userId) {
          if (hasPro || onboardingComplete || onboardingStep === "complete") {
            target = "/(tabs)";
          } else {
            switch (onboardingStep) {
              case "intro":
                target = "/";
                break;
              case "garage_locked":
                target = "/(tabs)/garage";
                break;
              case "tune":
                target = "/(tabs)/tune";
                break;
              case "results_locked":
                target = pendingTune ? "/tune-results" : "/(tabs)/tune";
                break;
              case "signup":
                // Already signed in — advance past signup to trial in BOTH
                // stores, then send to the paywall. Garage stranded the user:
                // tabs hidden mid-onboarding and no funnel CTA there (S4).
                await setStep("trial");
                void supabase.from("profiles").upsert(
                  { user_id: userId, onboarding_step: "trial" },
                  { onConflict: "user_id" }
                );
                target = "/premium";
                break;
              case "trial":
                target = "/premium";
                break;
              default:
                target = "/(tabs)";
                break;
            }
          }
        } else if (!localState.hasSeenIntro && onboardingStep === "intro") {
          target = "/";
        } else {
          switch (onboardingStep) {
            case "intro":
              target = "/";
              break;
            case "garage_locked":
              target = "/(tabs)/garage";
              break;
            case "tune":
              target = "/(tabs)/tune";
              break;
            case "results_locked":
              target = pendingTune ? "/tune-results" : "/(tabs)/tune";
              break;
            case "signup":
              target = localState.accountCreated ? "/login" : "/signup";
              break;
            case "trial":
              target = localState.accountCreated ? "/login" : "/signup";
              break;
            case "complete":
              target = localState.accountCreated ? "/login" : "/(tabs)/garage";
              break;
            default:
              target = "/(tabs)/garage";
              break;
          }
        }

        if (!didNavigateRef.current) {
          didNavigateRef.current = true;
          router.replace(target as never);
        }
      } finally {
        if (!mounted) return;
        setReadyToHide(true);

        setTimeout(() => {
          if (!hidOnce.current) {
            SplashScreen.hideAsync().catch(() => {});
            hidOnce.current = true;
          }
        }, 1200);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router, hydrated, replaceState, setStep]);

  // Hide splash after first layout of the routed screen
  const onLayout = useCallback(() => {
    if (readyToHide && !hidOnce.current) {
      requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
        hidOnce.current = true;
      });
    }
  }, [readyToHide]);

  // Render an empty root that receives the layout callback.
  return <View style={{ flex: 1 }} onLayout={onLayout} />;
}
