// app/quiz/gate.tsx — the account gate (= the results_locked step's UI).
// "YOUR TUNE IS READY / Save it to your garage to see it." Locked-row tune
// card (no blur), Apple + Google, an email fallback (the shipped signup
// screen, which lands on the reveal too), and the passive terms line the
// provider paths need. Account-before-reveal is preserved exactly as today:
// auth runs through lib/authSuccess.ts:completeAuthSuccess, whose tail
// decides paywall-first (interstitial) or reveal-first (action-gated).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import { LockedTuneCard } from "../../components/quiz/TuneCards";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { completeAuthSuccess } from "../../lib/authSuccess";
import { readPendingTune, useOnboarding } from "../../lib/onboarding";
import { completeOnboardingSequence } from "../../lib/onboardingCompletion";
import { isActionGatedPaywall } from "../../lib/paywallPosition";
import { useQuiz } from "../../lib/quizContext";
import { bikeDisplayName, logQuizEvent, type TuneLike } from "../../lib/quizOnboarding";
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
  type SocialProvider,
} from "../../lib/socialAuth";
import { supabase } from "../../lib/supabase";
import { getOrCreateFunnelId, logEvent } from "../../lib/usage";

const REVEAL_ROUTE = "/quiz/reveal";
const VARIANT = "quiz_gate_v1";

export default function QuizGateScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { answers } = useQuiz();
  const { state, onboardingActive, setStep, markAccountCreated, completeOnboarding } = useOnboarding();
  const [tune, setTune] = useState<TuneLike | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [googleAvailable] = useState(() => isGoogleSignInAvailable());
  const [loading, setLoading] = useState<SocialProvider | "session" | null>(null);
  const viewedRef = useRef(false);

  const ageMinutesSinceLastStep = Math.round(
    Math.max(0, Date.now() - Date.parse(state.lastUpdatedAt || "")) / 60000
  );

  useEffect(() => {
    let mounted = true;
    isAppleSignInAvailable()
      .then((ok) => mounted && setAppleAvailable(ok))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { tune: pending } = await readPendingTune();
        if (!alive) return;
        if (!pending) {
          // Nothing to gate — back to the quiz (answers persist).
          router.replace("/quiz" as never);
          return;
        }
        try {
          setTune(JSON.parse(decodeURIComponent(pending.r)) as TuneLike);
        } catch {
          setTune(null);
        }
        if (!viewedRef.current) {
          viewedRef.current = true;
          const funnelId = await getOrCreateFunnelId();
          void logEvent(
            "onboarding_locked_results_viewed",
            {
              funnel_id: funnelId,
              onboarding_step: state.onboardingStep,
              signed_in: false,
              pending_tune_exists: true,
              bike_id: pending.bikeId,
              resume: ageMinutesSinceLastStep >= 5,
              age_minutes_since_last_step: ageMinutesSinceLastStep,
              source_route: "/quiz/gate",
              variant: VARIANT,
            },
            { allowAnonymous: true, queueIfAnonymous: true }
          );
          void logQuizEvent("quiz_gate_viewed", { variant: VARIANT });
        }

        // Already signed in (rare: mid-onboarding with a session) — no
        // account to create; run the post-auth tail the gate would have.
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (uid && alive) {
          setLoading("session");
          try {
            if (isActionGatedPaywall()) {
              const done = await completeOnboardingSequence({
                completeOnboarding,
                onboardingStep: state.onboardingStep,
                accountCreated: true,
                trialStarted: state.trialStarted,
                ageMinutesSinceLastStep,
                sourceRoute: "/quiz/gate",
                viaPaywall: false,
                returnTo: REVEAL_ROUTE,
              });
              router.replace(done.target as never);
            } else {
              await setStep("trial");
              void supabase.from("profiles").upsert(
                { user_id: uid, onboarding_step: "trial" },
                { onConflict: "user_id" }
              );
              router.replace(`/premium?returnTo=${encodeURIComponent(REVEAL_ROUTE)}` as never);
            }
          } finally {
            if (alive) setLoading(null);
          }
        }
      })();
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const onProvider = async (provider: SocialProvider) => {
    if (loading) return;
    setLoading(provider);
    try {
      const funnelId = await getOrCreateFunnelId();
      void logQuizEvent("quiz_signin_method_chosen", { method: provider });
      void logEvent(
        "onboarding_unlock_clicked",
        {
          funnel_id: funnelId,
          onboarding_step: state.onboardingStep,
          signed_in: false,
          account_created: state.accountCreated,
          trial_started: state.trialStarted,
          onboarding_complete: state.onboardingComplete,
          pending_tune_exists: true,
          bike_id: answers.bikeLocalId ?? null,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/quiz/gate",
          variant: VARIANT,
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
      void logEvent(
        "onboarding_signup_started",
        {
          funnel_id: funnelId,
          onboarding_step: "signup",
          signed_in: false,
          source_route: "/quiz/gate",
          signup_method: provider,
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
      // The state machine's own transition (results_locked → signup), exactly
      // where tune-results' unlock CTA makes it.
      if (onboardingActive) await setStep("signup");

      const result = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
      if (result.status === "cancelled") return;
      if (result.status === "failed") {
        toast.show(result.message, { kind: "error" });
        return;
      }

      await completeAuthSuccess({
        userId: result.userId,
        isNewAccount: result.isNewAccount,
        method: provider,
        displayName: result.displayName,
        onboardingStep: "signup",
        onboardingComplete: state.onboardingComplete,
        ageMinutesSinceLastStep,
        notify: () =>
          toast.show(
            result.isNewAccount ? "Account created. You’re signed in ✅" : "Welcome back! Signed in ✅",
            { kind: "success" }
          ),
        markAccountCreated,
        setStep,
        completeOnboarding,
        revealRoute: REVEAL_ROUTE,
        completionMeta: { quiz: true, variant: VARIANT },
        replace: (route) => router.replace(route as never),
        returnTo: REVEAL_ROUTE,
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Sign-in failed", { kind: "error" });
    } finally {
      setLoading(null);
    }
  };

  const onEmail = async () => {
    void logQuizEvent("quiz_signin_method_chosen", { method: "email" });
    if (onboardingActive) await setStep("signup");
    router.push("/signup" as never);
  };

  const bikeName = bikeDisplayName(answers);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 28, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Text style={[styles.title, displayFont("black")]}>Your tune is ready</Text>
      <Text style={styles.subtitle}>Save it to your garage to see it.</Text>

      <View style={styles.cardWrap}>
        <LockedTuneCard tune={tune} title={bikeName || undefined} />
      </View>

      <View style={styles.buttons}>
        {Platform.OS === "ios" && appleAvailable ? (
          <Pressable
            onPress={() => void onProvider("apple")}
            disabled={!!loading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
            style={[styles.btn, styles.btnApple, loading && loading !== "apple" && styles.btnDim]}
          >
            {loading === "apple" ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Ionicons name="logo-apple" size={20} color="#000" />
                <Text style={[styles.btnText, styles.btnTextDark, displayFont("bold")]}>Continue with Apple</Text>
              </>
            )}
          </Pressable>
        ) : null}
        {googleAvailable ? (
          <Pressable
            onPress={() => void onProvider("google")}
            disabled={!!loading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            style={[styles.btn, styles.btnGoogle, loading && loading !== "google" && styles.btnDim]}
          >
            {loading === "google" ? (
              <ActivityIndicator color={Q.TEXT} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={Q.TEXT} />
                <Text style={[styles.btnText, displayFont("bold")]}>Continue with Google</Text>
              </>
            )}
          </Pressable>
        ) : null}
        <Pressable onPress={() => void onEmail()} disabled={!!loading} accessibilityRole="button" style={styles.emailLink}>
          <Text style={styles.emailLinkText}>Use email instead</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerLine, displayFont("bold")]}>Your tune is saved to your garage.</Text>
        <Text style={styles.terms}>
          By continuing you agree to our{" "}
          <Text style={styles.termsLink} onPress={() => router.push("/legal/terms" as never)}>
            Terms
          </Text>{" "}
          and{" "}
          <Text style={styles.termsLink} onPress={() => router.push("/legal/privacy" as never)}>
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Q.BG, paddingHorizontal: 20 },
  title: { color: Q.TEXT, fontSize: 40, lineHeight: 42, letterSpacing: 0.2, textTransform: "uppercase" },
  subtitle: { color: Q.STEEL, fontSize: 16, lineHeight: 22, marginTop: 10 },
  cardWrap: { marginTop: 24 },
  buttons: { marginTop: "auto", gap: 12 },
  btn: { height: 54, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  btnApple: { backgroundColor: "#FFFFFF" },
  btnGoogle: { backgroundColor: Q.PANEL, borderWidth: 1, borderColor: Q.BORDER_STRONG },
  btnDim: { opacity: 0.5 },
  btnText: { color: Q.TEXT, fontSize: 17, letterSpacing: 0.3 },
  btnTextDark: { color: "#000" },
  emailLink: { alignItems: "center", paddingVertical: 8 },
  emailLinkText: { color: Q.STEEL, fontSize: 15, textDecorationLine: "underline" },
  footer: { marginTop: 14, alignItems: "center", gap: 8 },
  footerLine: { color: Q.TEXT, fontSize: 14, letterSpacing: 0.3 },
  terms: { color: Q.STEEL, fontSize: 12, lineHeight: 17, textAlign: "center" },
  termsLink: { color: Q.STEEL, textDecorationLine: "underline" },
});
