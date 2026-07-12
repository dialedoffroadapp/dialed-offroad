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


// ── Startup watchdogs (Apple 2.1(a) hardening) ──────────────────────────────
// The boot resolver below awaits storage reads and network fetches with no
// native timeouts. A throw is survivable (finally still hides the splash),
// but an await that NEVER SETTLES — a wedged AsyncStorage read, a blackholed
// profile fetch on a proxied network, provider hydration stalling — used to
// leave the native splash up forever. Two layers, both no-ops on the happy
// path (navigation always wins the race and sets the guards first):
//   1. IndexGate arms a component watchdog on mount: after
//      SPLASH_WATCHDOG_MS without navigation, hide the splash and fall
//      through to the tab navigator with whatever local state exists — the
//      app degrades to usable, never hangs.
//   2. This module-scope timer is the last resort for the case where
//      IndexGate itself never mounts: hideAsync is idempotent, so firing
//      after the splash is already hidden does nothing.
const SPLASH_WATCHDOG_MS = 8000;

setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
}, SPLASH_WATCHDOG_MS + 2000);

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

  // Component watchdog: armed on MOUNT, independent of the `hydrated` gate
  // below (so it also covers provider hydration never completing). If the
  // resolver hasn't navigated within SPLASH_WATCHDOG_MS, force the safe
  // default route and hide the splash — signed-in users land on their tabs
  // with cached/local state, signed-out users get the app shell instead of a
  // dead splash. On the happy path the resolver navigates in well under a
  // second and this timer finds didNavigateRef already set.
  useEffect(() => {
    const watchdog = setTimeout(() => {
      if (didNavigateRef.current) return;
      console.warn(
        "[IndexGate] startup watchdog fired — boot resolution stalled; forcing safe route"
      );
      didNavigateRef.current = true;
      try {
        router.replace("/(tabs)" as never);
      } catch {
        // even a failed replace must not stop the splash from hiding
      }
      if (!hidOnce.current) {
        hidOnce.current = true;
        SplashScreen.hideAsync().catch(() => {});
      }
    }, SPLASH_WATCHDOG_MS);
    return () => clearTimeout(watchdog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Wait for the OnboardingProvider to finish its hydration READ before any
    // boot resolution. The reconciliation write below goes through the
    // provider's replaceState, so ordering the whole effect after hydration
    // guarantees read-then-write — the write can never race the hydration read.
    if (!hydrated) return;

    let mounted = true;

    (async () => {
      try {
        // ── Phase 1: session + local reads. Failure falls through to the
        // fresh-install defaults rather than blocking boot.
        let sessionData: Awaited<
          ReturnType<typeof supabase.auth.getSession>
        >["data"] = { session: null };
        let localState = await (async () => {
          try {
            return await readLocalOnboardingState();
          } catch (e) {
            console.warn("[IndexGate] local state read failed — defaults", e);
            // readLocalOnboardingState(null-raw) shape: fresh-install state.
            return {
              version: 1 as const,
              hasSeenIntro: false,
              onboardingStep: "intro" as OnboardingStep,
              guestBikeId: null,
              accountCreated: false,
              trialStarted: false,
              onboardingComplete: false,
              lastUpdatedAt: new Date(0).toISOString(),
            };
          }
        })();
        let pendingTune: unknown = null;
        try {
          const [s, p] = await Promise.all([
            supabase.auth.getSession(),
            readPendingTune(),
          ]);
          sessionData = s.data;
          pendingTune = p.tune;
        } catch (e) {
          console.warn("[IndexGate] session/pending reads failed — continuing signed-out", e);
        }

        if (!mounted || didNavigateRef.current) return;

        const session = sessionData?.session;
        const userId = session?.user?.id ?? null;

        let profile: ProfileBootRow | null = null;
        let hasLegacyUsage = false;
        if (userId) {
          // ── Phase 2: profile fetch (network). Failure = boot from local
          // state only; every consumer below already handles profile null.
          try {
            const { data } = await supabase
              .from("profiles")
              .select("*")
              .eq("user_id", userId)
              .maybeSingle();
            profile = (data as ProfileBootRow | null) ?? null;
          } catch (e) {
            console.warn("[IndexGate] profile fetch failed — local state only", e);
          }

          if (!mounted || didNavigateRef.current) return;

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
            // ── Phase 3: legacy-usage heuristic (network). Failure means the
            // user simply isn't auto-completed this launch — recoverable.
            try {
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
            } catch (e) {
              console.warn("[IndexGate] legacy heuristic failed — skipping", e);
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
            // Reconciliation write is best-effort — a storage failure must
            // not block routing (the resolved values below are in memory).
            try {
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
            } catch (e) {
              console.warn("[IndexGate] state reconcile write failed", e);
            }
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
                try {
                  await setStep("trial");
                } catch (e) {
                  console.warn("[IndexGate] setStep(trial) failed", e);
                }
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
          // ROOT CAUSE of the Apple 2.1(a) iPad frozen-splash rejection:
          // "/" IS this boot resolver's own route. router.replace("/") from
          // "/" is a no-op on iPhone but REMOUNTS this screen on iPad
          // (native-stack replace semantics differ by idiom), so the
          // resolver re-ran and re-navigated in a synchronous microtask loop
          // forever — starving timers, hideAsync, and the watchdog. Every
          // fresh install resolves target "/" (intro), which is why App
          // Review's fresh-install-on-iPad hit it 100% of the time. There is
          // nothing to navigate to: the intro overlay (RootInner) keys off
          // pathname === "/" — staying put is the correct behavior, and the
          // finally below still hides the splash.
          if (target !== "/") {
            router.replace(target as never);
          }
        }
      } catch (e) {
        // Belt-and-braces: the per-phase guards above should make this
        // unreachable, but an unexpected throw must still land the user in
        // the app shell — never a dead splash, never a blank gate view.
        console.error("[IndexGate] boot resolution threw — safe route", e);
        if (!didNavigateRef.current) {
          didNavigateRef.current = true;
          try {
            router.replace("/(tabs)" as never);
          } catch {
            // splash hide below still runs
          }
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
