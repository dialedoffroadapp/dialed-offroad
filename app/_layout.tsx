// app/_layout.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import Onboarding from "../components/Onboarding";
import { ToastProvider } from "../components/Toast";
import { ProGateHost } from "../components/v3/ProGateSheet";
import TrialPromptModal, {
  TRIAL_MODAL_DISMISS_KEY,
  TRIAL_MODAL_MAX_DISMISSALS,
} from "../components/TrialPromptModal";
import { flushFeedbackRetryQueue } from "../lib/feedbackRetry";
import { cancelGuestRecoveryReminder } from "../lib/guestRecovery";
import { OnboardingProvider, useOnboarding } from "../lib/onboarding";
import { markReminderArrival } from "../lib/reminderArrival";
import { hasPurchasedThisSession, initPurchases } from "../lib/purchases";
import { deriveIsPro } from "../lib/proUtils";
import { QUIZ_ONBOARDING_ENABLED } from "../lib/featureFlags";
import { PAYWALL_SEEN_KEY } from "../lib/paywall";
import {
  hydratePaywallPosition,
  isActionGatedPaywall,
} from "../lib/paywallPosition";
import { supabase } from "../lib/supabase";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";
import { darkTheme } from "../constants/theme";
import { ThemeProvider, useTheme } from "../lib/theme";

// ─── Early deep-link capture ───────────────────────────────────────────────
// Expo Router consumes the incoming URL for routing before useURL() or
// getInitialURL() can return it to a screen component. We capture the raw URL
// (including the #fragment) at module load time — before any component mounts —
// so auth-callback.tsx can reliably read the recovery tokens.
//
// The cold-start getInitialURL() is async, so we expose a Promise-based
// consumer that auth-callback can `await` — no race between the resolve
// timing and the component mount.
console.log("[deep-link] module loaded, registering early capture");


let _capturedDeepLinkUrl: string | null = null;
let _initialUrlResolved = false;

// Cold start: grab the URL as early as possible.
// We store the Promise so consumers can `await` it if the value isn't ready yet.
const _initialUrlPromise: Promise<string | null> = Linking.getInitialURL()
  .then((url) => {
    _initialUrlResolved = true;
    if (url && url.includes("auth-callback")) {
      console.log("[deep-link] captured initial URL:", url);
      _capturedDeepLinkUrl = url;
      return url;
    }
    return null;
  })
  .catch(() => {
    // A rejected initial-URL read must not poison consumeCapturedDeepLink's
    // await (startup hardening — see app/index.tsx watchdogs).
    _initialUrlResolved = true;
    return null;
  });

// Warm start: listen for URL events fired while the app is backgrounded
Linking.addEventListener("url", ({ url }) => {
  if (url && url.includes("auth-callback")) {
    console.log("[deep-link] captured warm-start URL:", url);
    _capturedDeepLinkUrl = url;
  }
});

/**
 * Await the captured deep-link URL. Returns the URL (or null) once the
 * initial-URL check has resolved. Safe to call multiple times — only the
 * first call consumes the value.
 */
export async function consumeCapturedDeepLink(): Promise<string | null> {
  // If the initial check already resolved, return immediately
  if (_initialUrlResolved) {
    const url = _capturedDeepLinkUrl;
    _capturedDeepLinkUrl = null;
    return url;
  }
  // Otherwise wait for it (typically <50ms)
  await _initialUrlPromise;
  const url = _capturedDeepLinkUrl;
  _capturedDeepLinkUrl = null;
  return url;
}

function ThemedStatusBar() {
  const { colors } = useTheme();
  const isDark = colors.BG === darkTheme.BG;
  return (
    <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.BG} />
  );
}

function AppStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        contentStyle: { backgroundColor: colors.BG },
      }}
    >
      {/* Public routes */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="reset-password"
        options={{ headerShown: false, presentation: "card" }}
      />
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />

      {/* Private app (tabs live here) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* Modal/screen outside tabs */}
      <Stack.Screen
        name="tune-results"
        options={{ headerShown: false, presentation: "card" }}
      />
    </Stack>
  );
}

/**
 * This inner component lets us call useOnboarding()
 * (provider has to wrap it first).
 */
function RootInner() {
  const pathname = usePathname();
  const router = useRouter();
  const [showOnboardingOverlay, setShowOnboardingOverlay] = useState(true);
  const { state, hydrated, markIntroSeen, setStep } = useOnboarding();
  const isRecoveryRoute =
    pathname === "/auth-callback" || pathname === "/reset-password";
  // Only show the intro overlay for genuinely new users. The overlay must
  // NOT appear after onboarding has been completed (or the intro has been
  // seen) — otherwise it re-shows on every cold start because pathname "/"
  // matches both the boot resolver AND the (tabs)/index Home tab.
  const shouldShowOnboardingOverlay =
    hydrated &&
    !state.onboardingComplete &&
    !state.hasSeenIntro &&
    showOnboardingOverlay &&
    pathname === "/" &&
    !isRecoveryRoute;

  // ——— Trial prompt modal for existing signed-in non-pro users ———
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [trialBikeTitle, setTrialBikeTitle] = useState("");
  // Lapsed subscriber (pro_until in the past): stores won't grant a second
  // free trial, so the modal must show winback copy, never "Free for 7 days".
  const [trialModalLapsed, setTrialModalLapsed] = useState(false);

  // Paywall decliner (persisted trial step): Home shows them the unlock
  // banner, so the cold-start modal on top of it would be double paywall
  // pressure in the first second. For them the modal is ARMED at cold start
  // (all the same eligibility checks) and FIRED once per session on the first
  // navigation into /bike-home — a genuine value moment — via the pathname
  // this layout already tracks (no navigation listeners needed). A ref
  // mirrors the flag so the once-per-boot effect below reads fresh state.
  const isPaywallDecliner =
    hydrated &&
    state.onboardingStep === "trial" &&
    !state.onboardingComplete;
  const declinerRef = React.useRef(isPaywallDecliner);
  declinerRef.current = isPaywallDecliner;
  const declinerModalArmedRef = React.useRef(false);
  const declinerModalFiredRef = React.useRef(false);

  useEffect(() => {
    if (!declinerModalArmedRef.current || declinerModalFiredRef.current) return;
    if (pathname !== "/bike-home") return;
    // Re-check at fire time — a conversion earlier in the session flips the
    // provider state / session purchase flag and permanently disarms this.
    if (!declinerRef.current || hasPurchasedThisSession()) return;
    declinerModalFiredRef.current = true;
    setShowTrialModal(true);
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;

    let mounted = true;
    (async () => {
      try {
        // Check dismiss count first (fast local check)
        const raw = await AsyncStorage.getItem(TRIAL_MODAL_DISMISS_KEY);
        const dismissCount = raw ? parseInt(raw, 10) : 0;
        if (dismissCount >= TRIAL_MODAL_MAX_DISMISSALS) return;

        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user?.id) return;

        // Check Pro status. Do NOT add onboarding_step here: that column does
        // not exist in production profiles (verified 2026-07-10) — naming it
        // 400s the whole select, prof comes back undefined, and the modal
        // would show to Pro users. Decliner detection below uses local
        // onboarding state only.
        const { data: prof } = await supabase
          .from("profiles")
          .select("is_pro, pro_until")
          .eq("user_id", auth.user.id)
          .maybeSingle();

        if (deriveIsPro(prof)) {
          setShowTrialModal(false);
          return;
        }

        // Not Pro here — a non-null pro_until therefore lies in the past
        // (deriveIsPro would have returned true otherwise): lapsed subscriber.
        // pro_until null/never-set keeps the trial copy.
        setTrialModalLapsed(!!prof?.pro_until);

        // Check has at least one bike
        const { data: bikes } = await supabase
          .from("bikes")
          .select("id, make, model, year, nickname")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: true })
          .limit(1);

        if (!mounted) return;
        if (!bikes || bikes.length === 0) return;

        const b = bikes[0] as any;
        const fallback = [b.year, b.make, b.model].filter(Boolean).join(" ");
        setTrialBikeTitle(b.nickname || fallback);

        // Decliners: don't stack the modal on the Home unlock banner at cold
        // start — arm it for the first /bike-home visit this session instead.
        // (Their pro_until is null, so trialModalLapsed stays false above and
        // they correctly get the trial copy when it does fire.) Local state is
        // the only decliner signal: profiles has no onboarding_step column in
        // production, so a fresh-install decliner (local state reset) simply
        // gets the modal at cold start — the pre-recovery behavior.
        if (declinerRef.current) {
          declinerModalArmedRef.current = true;
          return;
        }

        // Action-gated world (lib/paywallPosition.ts): the FIRST paywall a
        // rider meets must be summoned by a Pro action, never by a cold
        // start — a brand-new free account would otherwise get this modal
        // on its second launch. It stays a follow-up nudge once a gate has
        // presented the paywall at least once on this device.
        if (isActionGatedPaywall()) {
          const seen = await AsyncStorage.getItem(PAYWALL_SEEN_KEY);
          if (!seen) return;
        }

        setShowTrialModal(true);
      } catch {
        // Silently ignore — modal is non-critical
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hydrated]);

  // Flush lineage writes that failed during a previous session's refine flow
  // (lib/feedbackRetry.ts). Entries survive while signed out.
  useEffect(() => {
    void flushFeedbackRetryQueue();
  }, []);

  // Ride-reminder tap → Home tab, where the check-in card mounts. Local
  // notifications never auto-navigate, so both the warm tap and the tap that
  // cold-started the app are handled here. "/(tabs)" is exactly where
  // IndexGate sends completed users anyway (app/index.tsx), so racing the
  // boot resolver is harmless — the cold-start handler still waits a beat so
  // its navigation lands on top of the resolver's replace().
  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleResponse = (
      resp: Notifications.NotificationResponse | null
    ) => {
      const data: any = resp?.notification?.request?.content?.data;
      if (data?.kind !== "ride_reminder" && data?.kind !== "trial_reminder") {
        return;
      }
      if (data.kind === "ride_reminder") {
        // Arrival flag: lets the check-in card bypass its 12h age gate so
        // the tap always lands on the experience the notification promised.
        void markReminderArrival(
          typeof data.version_id === "string" ? data.version_id : null
        );
      }
      router.navigate("/(tabs)" as any);
    };

    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        if (!cancelled && resp) setTimeout(() => handleResponse(resp), 800);
      })
      .catch(() => {});

    const sub =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);

  // Paywall position: device cache now, prod app_config in the background
  // (lib/paywallPosition.ts). Flippable without a store release.
  useEffect(() => {
    void hydratePaywallPosition();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id ?? undefined;
        await initPurchases(userId);
      } catch (e) {
        console.warn("[RC] initPurchases error:", e);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const userId = session?.user?.id ?? undefined;
        // Any session means they're not an abandoned guest — the recovery
        // nudge (lib/guestRecovery.ts) has nothing left to recover.
        if (userId) void cancelGuestRecoveryReminder();
        initPurchases(userId).catch((e) => {
          console.warn("[RC] initPurchases error (auth change):", e);
        });
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <ThemedStatusBar />

      {/* Router + normal app tree ALWAYS mounts so splash can hide */}
      <AppStack />

      {/* Onboarding overlay on TOP */}
      {shouldShowOnboardingOverlay && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="auto">
          <Onboarding
            onFinish={async () => {
              // Persist state before navigating so cold-start resume lands correctly.
              // (onboardingActive derives from this committed step, so Garage sees
              // it as true on its first render — no explicit activation needed.)
              await markIntroSeen();
              await setStep("garage_locked");
              // Fire-and-forget so it never delays the intro→garage transition;
              // guests are session-less here, so it queues and flushes at signup
              // (the same path onboarding_tune_generated already relies on).
              void (async () => {
                const funnelId = await getOrCreateFunnelId();
                await logEvent(
                  "onboarding_intro_completed",
                  {
                    funnel_id: funnelId,
                    onboarding_step: state.onboardingStep,
                    signed_in: false,
                    source_route: "/",
                  },
                  { allowAnonymous: true, queueIfAnonymous: true }
                );
              })();
              // Navigate first, then remove the overlay — both are synchronous
              // calls after the awaits so React 18 batches them in one render.
              // This means the overlay never disappears before the new screen
              // is committed, eliminating the blank "/" flash.
              // Quiz onboarding (feat/quiz-onboarding): same state-machine step,
              // different UI for it — the quiz owns garage_locked + tune.
              router.replace(
                (QUIZ_ONBOARDING_ENABLED ? "/quiz" : "/(tabs)/garage") as never
              );
              setShowOnboardingOverlay(false);
            }}
          />
        </View>
      )}

      {/* Trial prompt for existing signed-in non-pro users
           — never show during password-reset flow */}
      {/* Pro gate (lib/proGate.ts): the locked-row sheet before the paywall. */}
      <ProGateHost />

      <TrialPromptModal
        visible={showTrialModal && !isRecoveryRoute}
        bikeTitle={trialBikeTitle}
        lapsed={trialModalLapsed}
        onRequestClose={() => setShowTrialModal(false)}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        {/* Provider controls whether tabs are locked */}
        <OnboardingProvider>
          <RootInner />
        </OnboardingProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
