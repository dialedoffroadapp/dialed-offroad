// app/index.tsx
import { useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type OnboardingStep,
  PENDING_GUEST_BIKE_SYNC_KEY,
  readLocalOnboardingState,
  readPendingTune,
} from "../lib/onboarding";
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

  useEffect(() => {
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

          // Fix 4: Retry guest bike insert that failed during signup migration
          try {
            const syncRaw = await AsyncStorage.getItem(PENDING_GUEST_BIKE_SYNC_KEY);
            if (syncRaw) {
              const syncData = JSON.parse(syncRaw);
              if (
                syncData?.userId === userId &&
                syncData?.make &&
                syncData?.model &&
                syncData?.year
              ) {
                const { error: bikeErr } = await supabase.from("bikes").insert({
                  user_id: userId,
                  make: String(syncData.make),
                  model: String(syncData.model),
                  year: Number(syncData.year),
                });
                if (!bikeErr) {
                  await AsyncStorage.removeItem(PENDING_GUEST_BIKE_SYNC_KEY);
                }
              }
            }
          } catch {
            // Non-critical
          }

          // Only run the legacy-usage heuristic for genuine pre-onboarding-system
          // users (onboarding_step is null/absent). If onboarding_step is a known
          // mid-flow value, the user is mid-onboarding — not a legacy user — and
          // must NOT be auto-completed just because they have a bike from the flow.
          const isMidOnboarding =
            profile?.onboarding_step != null &&
            isOnboardingStep(profile.onboarding_step) &&
            profile.onboarding_step !== "complete";

          if (
            !isMidOnboarding &&
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
                // Already signed in — advance past signup to trial
                void supabase.from("profiles").upsert(
                  { user_id: userId, onboarding_step: "trial" },
                  { onConflict: "user_id" }
                );
                target = "/(tabs)/garage";
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
  }, [router]);

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
