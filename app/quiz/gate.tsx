// app/quiz/gate.tsx — the account gate (= the results_locked step's UI).
// "YOUR TUNE IS READY / Save it to your garage to see it." Locked-row tune
// card (no blur), Apple + Google, and email sign-up INLINE on this screen:
// "Continue with email" expands the fields under the locked rows and the
// primary button becomes "Create account and reveal" (no second screen, no
// second headline). When neither native provider is available (simulator,
// missing config) the email entry IS the primary button in their slot.
// Account-before-reveal is preserved exactly as today: every success runs
// through lib/authSuccess.ts:completeAuthSuccess, whose tail decides
// paywall-first (interstitial) or reveal-first (action-gated); the email
// auth calls themselves are lib/emailSignup.ts, shared with the legacy
// signup screen (retired under the quiz flag).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import { LockedTuneCard } from "../../components/quiz/TuneCards";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { completeAuthSuccess } from "../../lib/authSuccess";
import { signUpWithEmail, validateEmailSignup } from "../../lib/emailSignup";
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
const VARIANT = "quiz_gate_v2_inline_email";

type Loading = SocialProvider | "email" | "session" | null;

export default function QuizGateScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { answers } = useQuiz();
  const { state, onboardingActive, setStep, markAccountCreated, completeOnboarding } = useOnboarding();
  const [tune, setTune] = useState<TuneLike | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [googleAvailable] = useState(() => isGoogleSignInAvailable());
  const [loading, setLoading] = useState<Loading>(null);
  const viewedRef = useRef(false);

  // Inline email form.
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const emailExpandLoggedRef = useRef(false);

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

  /** The funnel events every sign-up attempt logs, provider or email. */
  const logAttempt = async (method: SocialProvider | "email") => {
    const funnelId = await getOrCreateFunnelId();
    void logQuizEvent("quiz_signin_method_chosen", { method });
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
        signup_method: method,
      },
      { allowAnonymous: true, queueIfAnonymous: true }
    );
  };

  /** The ONE post-auth path, identical for providers and email. */
  const finishAuth = async (args: {
    userId: string | null;
    isNewAccount: boolean;
    method: SocialProvider | "email";
    displayName?: string | null;
    recovered?: boolean;
  }) => {
    await completeAuthSuccess({
      userId: args.userId,
      isNewAccount: args.isNewAccount,
      method: args.method,
      displayName: args.displayName,
      onboardingStep: "signup",
      onboardingComplete: state.onboardingComplete,
      ageMinutesSinceLastStep,
      notify: () =>
        toast.show(
          args.isNewAccount ? "Account created. You’re signed in ✅" : "Welcome back! Signed in ✅",
          { kind: "success" }
        ),
      markAccountCreated,
      setStep,
      completeOnboarding,
      revealRoute: REVEAL_ROUTE,
      completionMeta: {
        quiz: true,
        variant: VARIANT,
        signup_method: args.method,
        ...(args.recovered ? { recovered: true } : {}),
      },
      replace: (route) => router.replace(route as never),
      returnTo: REVEAL_ROUTE,
    });
  };

  const onProvider = async (provider: SocialProvider) => {
    if (loading) return;
    setLoading(provider);
    try {
      await logAttempt(provider);
      // The state machine's own transition (results_locked → signup), exactly
      // where tune-results' unlock CTA makes it.
      if (onboardingActive) await setStep("signup");

      const result = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
      if (result.status === "cancelled") return;
      if (result.status === "failed") {
        toast.show(result.message, { kind: "error" });
        return;
      }
      await finishAuth({
        userId: result.userId,
        isNewAccount: result.isNewAccount,
        method: provider,
        displayName: result.displayName,
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Sign-in failed", { kind: "error" });
    } finally {
      setLoading(null);
    }
  };

  const openEmail = () => {
    if (loading) return;
    setEmailOpen(true);
    setTimeout(() => emailRef.current?.focus?.(), 160);
    if (!emailExpandLoggedRef.current) {
      emailExpandLoggedRef.current = true;
      void logQuizEvent("quiz_signin_method_chosen", { method: "email" });
      // Same meta carrier the legacy signup screen used for its expand.
      void logEvent(
        "heard_card_shown",
        { surface: "signup_email_expand", source_route: "/quiz/gate" },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    }
  };

  const onEmailSubmit = async () => {
    if (loading) return;
    const v = validateEmailSignup(email, password);
    setEmailErr(v.emailErr);
    setPwErr(v.pwErr);
    if (!v.ok) return;
    Keyboard.dismiss();
    setLoading("email");
    try {
      await logAttempt("email");
      if (onboardingActive) await setStep("signup");

      const result = await signUpWithEmail(email, password);
      if (result.status === "exists_wrong_password") {
        toast.show("An account with this email already exists. Please sign in.", { kind: "info" });
        router.replace({ pathname: "/login", params: { email: email.trim() } } as never);
        return;
      }
      if (result.status === "created_signin_failed") {
        await markAccountCreated();
        toast.show("Account created! Please sign in to continue.", { kind: "success" });
        router.replace({ pathname: "/login", params: { email: email.trim() } } as never);
        return;
      }
      if (result.status === "error") {
        toast.show(result.message, { kind: "error" });
        return;
      }
      // "created" and "recovered" both finish through the one shared path
      // (the recovered case is a returning rider: sign_in, never sign_up).
      await finishAuth({
        userId: result.userId,
        isNewAccount: result.status === "created" ? result.isNewAccount : false,
        method: "email",
        recovered: result.status === "recovered",
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to sign up", { kind: "error" });
    } finally {
      setLoading(null);
    }
  };

  const bikeName = bikeDisplayName(answers);
  const showApple = Platform.OS === "ios" && appleAvailable;
  const providersAvailable = showApple || googleAvailable;
  const busy = !!loading;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={styles.root}
    >
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 28, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, displayFont("black")]}>Your tune is ready</Text>
        <Text style={styles.subtitle}>Save it to your garage to see it.</Text>

        <View style={styles.cardWrap}>
          <LockedTuneCard tune={tune} title={bikeName || undefined} />
        </View>

        {emailOpen ? (
          <Animated.View entering={FadeIn.duration(160)} style={styles.form}>
            <View>
              <TextInput
                ref={emailRef}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (emailErr) setEmailErr("");
                }}
                placeholder="Email"
                placeholderTextColor={Q.STEEL}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus?.()}
                editable={!busy}
                accessibilityLabel="Email"
                style={[styles.input, !!emailErr && styles.inputError]}
              />
              {emailErr ? <Text style={styles.fieldError}>{emailErr}</Text> : null}
            </View>
            <View>
              <View style={[styles.input, styles.inputRow, !!pwErr && styles.inputError]}>
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (pwErr) setPwErr("");
                  }}
                  placeholder="Password"
                  placeholderTextColor={Q.STEEL}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password-new"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={() => void onEmailSubmit()}
                  editable={!busy}
                  accessibilityLabel="Password"
                  style={styles.inputInner}
                />
                <Pressable
                  onPress={() => setShowPw((s) => !s)}
                  accessibilityRole="button"
                  accessibilityLabel={showPw ? "Hide password" : "Show password"}
                  hitSlop={8}
                >
                  <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={Q.STEEL} />
                </Pressable>
              </View>
              {pwErr ? <Text style={styles.fieldError}>{pwErr}</Text> : null}
            </View>
            <Pressable
              onPress={() => router.push({ pathname: "/login", params: email.trim() ? { email: email.trim() } : {} } as never)}
              disabled={busy}
              accessibilityRole="button"
              style={styles.signInLink}
            >
              <Text style={styles.signInLinkText}>
                Have an account? <Text style={styles.signInLinkStrong}>Sign in</Text>
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <View style={styles.buttons}>
          {showApple ? (
            <Pressable
              onPress={() => void onProvider("apple")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Apple"
              style={[styles.btn, styles.btnApple, busy && loading !== "apple" && styles.btnDim]}
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
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              style={[styles.btn, styles.btnGoogle, busy && loading !== "google" && styles.btnDim]}
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

          {emailOpen ? (
            // Fields are open: the email entry IS the primary action now.
            <Pressable
              onPress={() => void onEmailSubmit()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Create account and reveal"
              style={[styles.btn, styles.btnPrimary, busy && loading !== "email" && styles.btnDim]}
            >
              {loading === "email" ? (
                <ActivityIndicator color={Q.INK} />
              ) : (
                <Text style={[styles.btnText, styles.btnTextInk, displayFont("bold")]}>Create account and reveal</Text>
              )}
            </Pressable>
          ) : providersAvailable ? (
            <Pressable onPress={openEmail} disabled={busy} accessibilityRole="button" style={styles.emailLink}>
              <Text style={styles.emailLinkText}>Continue with email</Text>
            </Pressable>
          ) : (
            // No native provider in this build (simulator, missing config):
            // email takes the primary slot instead of an underlined link.
            <Pressable
              onPress={openEmail}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continue with email"
              style={[styles.btn, styles.btnPrimary, busy && styles.btnDim]}
            >
              <Ionicons name="mail-outline" size={18} color={Q.INK} />
              <Text style={[styles.btnText, styles.btnTextInk, displayFont("bold")]}>Continue with email</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerLine, displayFont("bold")]}>Sign in and it’s saved to your garage. Free.</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Q.BG },
  content: { flexGrow: 1, paddingHorizontal: 20 },
  title: { color: Q.TEXT, fontSize: 40, lineHeight: 42, letterSpacing: 0.2, textTransform: "uppercase" },
  subtitle: { color: Q.STEEL, fontSize: 16, lineHeight: 22, marginTop: 10 },
  cardWrap: { marginTop: 24 },
  form: { marginTop: 18, gap: 10 },
  input: {
    height: 54,
    borderRadius: 14,
    backgroundColor: Q.PANEL,
    borderWidth: 1,
    borderColor: Q.BORDER_STRONG,
    paddingHorizontal: 16,
    color: Q.TEXT,
    fontSize: 16,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 14 },
  inputInner: { flex: 1, height: "100%", color: Q.TEXT, fontSize: 16 },
  inputError: { borderColor: "#F0506E" },
  fieldError: { color: "#F0506E", fontSize: 12, marginTop: 6, marginLeft: 4 },
  signInLink: { alignSelf: "center", paddingVertical: 4 },
  signInLinkText: { color: Q.STEEL, fontSize: 13 },
  signInLinkStrong: { color: Q.TEXT, textDecorationLine: "underline" },
  buttons: { marginTop: "auto", paddingTop: 18, gap: 12 },
  btn: { height: 54, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  btnApple: { backgroundColor: "#FFFFFF" },
  btnGoogle: { backgroundColor: Q.PANEL, borderWidth: 1, borderColor: Q.BORDER_STRONG },
  btnPrimary: { backgroundColor: Q.BLUE },
  btnDim: { opacity: 0.5 },
  btnText: { color: Q.TEXT, fontSize: 17, letterSpacing: 0.3 },
  btnTextDark: { color: "#000" },
  btnTextInk: { color: Q.INK },
  emailLink: { alignItems: "center", paddingVertical: 8 },
  emailLinkText: { color: Q.STEEL, fontSize: 15, textDecorationLine: "underline" },
  footer: { marginTop: 14, alignItems: "center", gap: 8 },
  footerLine: { color: Q.TEXT, fontSize: 14, letterSpacing: 0.3 },
  terms: { color: Q.STEEL, fontSize: 12, lineHeight: 17, textAlign: "center" },
  termsLink: { color: Q.STEEL, textDecorationLine: "underline" },
});
