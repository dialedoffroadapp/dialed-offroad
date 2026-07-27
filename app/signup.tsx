// app/signup.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  UIManager,
  View,
} from "react-native";
import { ToastProvider, useToast } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import { completeAuthSuccess } from "../lib/authSuccess";
import { readPendingTune, useOnboarding } from "../lib/onboarding";
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
  type SocialProvider,
} from "../lib/socialAuth";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { claimAnonTuneCalls } from "../lib/tuneAttribution";
import { TuneTeaseCard, type TuneTeaseValues } from "../components/TuneTeaseCard";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";

// LayoutAnimation drives the email-form expand; Android needs the opt-in.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function SignupInner() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { state, markAccountCreated, setStep } = useOnboarding();

  // ✅ allow caller to specify where to go after signup
  // If nothing provided, default to Paywall
  const params = useLocalSearchParams<{ returnTo?: string }>();

  // ✅ Default: go to premium
  // ✅ DEV: automatically add dev=1 + returnTo=/tune-results so the paywall screen skips
  const defaultReturnTo = __DEV__
    ? "/premium?dev=1&returnTo=/tune-results"
    : "/premium?returnTo=/tune-results";

  const returnTo =
    typeof params.returnTo === "string" && params.returnTo.length > 0
      ? params.returnTo
      : defaultReturnTo;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");

  const [accepted, setAccepted] = useState(false);
  const [loadingUp, setLoadingUp] = useState(false);

  // v2.3.0 redesign: blurred tease of the rider's real pending tune, and the
  // email form collapsed behind a "Continue with email" row.
  const [teaseTune, setTeaseTune] = useState<TuneTeaseValues | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const emailExpandLoggedRef = useRef(false);

  // Provider buttons render ONLY when the native module is in this binary
  // (older builds: absent, not broken) — see lib/socialAuth.ts guards.
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [googleAvailable] = useState(() => isGoogleSignInAvailable());
  const [providerLoading, setProviderLoading] = useState<SocialProvider | null>(
    null
  );

  useEffect(() => {
    let mounted = true;
    isAppleSignInAvailable()
      .then((ok) => {
        if (mounted) setAppleAvailable(ok);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const emailValid = useMemo(() => /^\S+@\S+\.\S+$/.test(email.trim()), [email]);
  const canSubmit = emailValid && password.trim().length > 0 && accepted;

  // Tease card data: the SAME pending tune the locked results screen reads.
  // No pending tune (direct signup route) → card hidden entirely.
  useEffect(() => {
    void (async () => {
      const { tune } = await readPendingTune();
      if (!tune) return;
      try {
        const r = JSON.parse(decodeURIComponent(tune.r));
        setTeaseTune({
          fork_comp:
            typeof r?.fork?.comp_clicks === "number" ? r.fork.comp_clicks : null,
          shock_reb:
            typeof r?.shock?.reb_clicks === "number" ? r.shock.reb_clicks : null,
          air_bar:
            typeof r?.fork?.air_pressure_bar === "number"
              ? r.fork.air_pressure_bar
              : null,
        });
      } catch {
        // Unparseable pending tune: the screen just renders without the tease.
      }
    })();
  }, []);

  const onToggleEmail = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !emailOpen;
    setEmailOpen(next);
    if (next) {
      // Focus after the expand animation settles. Optional-call keeps the
      // test-renderer host instance (no .focus) from throwing.
      setTimeout(() => emailInputRef.current?.focus?.(), 120);
      if (!emailExpandLoggedRef.current) {
        emailExpandLoggedRef.current = true;
        // No dedicated event type today (the CHECK constraint is live and no
        // migration ships with this): ride heard_card_shown's meta — the
        // documented carrier precedent (surface: "notif_prompt"). Queued
        // pre-auth like this screen's sibling events; filter by surface.
        void logEvent(
          "heard_card_shown",
          { surface: "signup_email_expand", source_route: "/signup" },
          { allowAnonymous: true, queueIfAnonymous: true }
        );
      }
    }
  };
  const onboardingAgeMs = useMemo(() => {
    const parsed = Date.parse(state.lastUpdatedAt);
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  }, [state.lastUpdatedAt]);
  const ageMinutesSinceLastStep = Math.round(onboardingAgeMs / 60000);

  useEffect(() => {
    if (state.onboardingStep !== "signup") return;

    void (async () => {
      const funnelId = await getOrCreateFunnelId();
      await logEvent(
        "onboarding_signup_started",
        {
          funnel_id: funnelId,
          onboarding_step: state.onboardingStep,
          signed_in: false,
          account_created: state.accountCreated,
          trial_started: state.trialStarted,
          onboarding_complete: state.onboardingComplete,
          pending_tune_exists: true,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/signup",
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    })();
  }, [
    ageMinutesSinceLastStep,
    state.accountCreated,
    state.onboardingComplete,
    state.onboardingStep,
    state.trialStarted,
  ]);

  const onSignUp = async () => {
    setEmailErr("");
    setPwErr("");

    if (!emailValid) setEmailErr("Enter a valid email.");
    if (!password.trim()) setPwErr("Password is required.");
    if (!emailValid || !password.trim()) return;

    if (!accepted) {
      toast.show("Please agree to the Terms and Privacy Policy.", {
        kind: "error",
      });
      return;
    }

    setLoadingUp(true);
    try {
      // 1) Create the account
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
      });

      // If the user already exists (half-created state from a prior failed attempt),
      // try to sign them in and create the missing profile instead of dead-ending.
      if (signUpErr) {
        const isAlreadyRegistered =
          signUpErr.message?.toLowerCase().includes("already registered") ||
          signUpErr.message?.toLowerCase().includes("already been registered") ||
          signUpErr.message?.toLowerCase().includes("user already exists");

        if (isAlreadyRegistered) {
          // Attempt to recover: sign in with these credentials
          const { data: recoveryData, error: recoveryErr } =
            await supabase.auth.signInWithPassword({
              email: email.trim(),
              password: password.trim(),
            });

          if (recoveryErr) {
            // Credentials don't match the existing account — send to login
            toast.show("An account with this email already exists. Please sign in.", { kind: "info" });
            setLoadingUp(false);
            router.replace({ pathname: "/login", params: { email: email.trim() } } as never);
            return;
          }

          // Signed in successfully — ensure the profile row exists (it may be missing)
          // is_pro is intentionally NOT in the payload: it's server-only
          // (webhook/service role) since 20260710170000, and including it
          // would fail the whole upsert on column grants.
          //
          // Write the user's ACTUAL local funnel position. The old default of
          // "complete" for every non-signup step let a mid-funnel re-signup
          // (e.g. results_locked) skip the paywall once the onboarding
          // columns began persisting (20260710200000). "signup" maps to
          // "trial" (the account now exists); "intro" carries no funnel info
          // — a fresh install recovering an old account — so only the row's
          // existence is ensured, never a step downgrade.
          if (recoveryData?.user?.id) {
            const local = state.onboardingStep;
            const payload: Record<string, unknown> = {
              user_id: recoveryData.user.id,
            };
            if (local !== "intro") {
              const resolvedStep = local === "signup" ? "trial" : local;
              payload.onboarding_step = resolvedStep;
              payload.onboarding_complete = resolvedStep === "complete";
            }
            await supabase.from("profiles").upsert(payload, {
              onConflict: "user_id",
              ignoreDuplicates: false,
            });
          }

          toast.show("Welcome back! Signed in ✅", { kind: "success" });
          // This recovered sign-in bypasses completeAuthSuccess (inline heal
          // + custom routing), so it claims pre-auth tune_calls directly —
          // the gap WS-C flagged: without this, a guest who tunes, hits
          // "already registered", and recovers into their account never
          // attributes their pre-auth rows.
          await claimAnonTuneCalls();
          await logEvent("sign_in");

          if (state.onboardingStep === "signup") {
            await markAccountCreated();
            await setStep("trial");
            router.replace("/premium");
          } else {
            router.replace("/(tabs)");
          }
          return;
        }

        // Some other signup error (network, etc.) — surface it
        throw signUpErr;
      }

      // 2) Immediately sign them in (no email verification required for now)
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (signInErr) {
        // Account was created but auto-login failed — send them to login with
        // email pre-filled. Record accountCreated first so the results CTA
        // routes this user to /login (not /signup) from here on.
        await markAccountCreated();
        toast.show("Account created! Please sign in to continue.", { kind: "success" });
        setLoadingUp(false);
        router.replace({ pathname: "/login", params: { email: email.trim() } } as never);
        return;
      }

      // 3+) Shared post-auth sequence (lib/authSuccess.ts): profile upsert w/
      //     retries, guest-bike migration + remap, sign_up/sign_in + funnel
      //     events, onboarding advance, routing. Apple/Google sign-in call the
      //     SAME function — keep provider-specific logic out of it.
      //
      // Enumeration protection (email confirmation disabled) can make signUp()
      // return no error for an EXISTING email, with an empty identities[]. That
      // is a sign-in, not a new account — so sign_up only fires when identities
      // is non-empty (genuinely new); otherwise log sign_in.
      const isNewAccount =
        !Array.isArray(signUpData?.user?.identities) ||
        (signUpData?.user?.identities?.length ?? 0) > 0;
      await completeAuthSuccess({
        userId: signInData?.user?.id ?? null,
        isNewAccount,
        method: "email",
        onboardingStep: state.onboardingStep,
        onboardingComplete: state.onboardingComplete,
        ageMinutesSinceLastStep,
        notify: () =>
          toast.show("Account created. You’re signed in ✅", {
            kind: "success",
          }),
        markAccountCreated,
        setStep,
        replace: (route) => router.replace(route as never),
        returnTo,
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to sign up", { kind: "error" });
    } finally {
      setLoadingUp(false);
    }
  };

  const onProviderSignIn = async (provider: SocialProvider) => {
    // Provider path carries no checkbox (v2.3.0 redesign): the passive terms
    // line under the buttons covers agreement. The email path keeps its
    // explicit checkbox via canSubmit — that gate is untouched.
    setProviderLoading(provider);
    try {
      const result =
        provider === "apple"
          ? await signInWithApple()
          : await signInWithGoogle();

      // Sheet dismissed — stay on signup, nothing was touched.
      if (result.status === "cancelled") return;
      if (result.status === "failed") {
        toast.show(result.message, { kind: "error" });
        return;
      }

      // Same-email collisions auto-link in Supabase (verified email), so a
      // returning rider lands on their existing account: isNewAccount=false,
      // garage and entitlements intact.
      await completeAuthSuccess({
        userId: result.userId,
        isNewAccount: result.isNewAccount,
        method: provider,
        displayName: result.displayName,
        onboardingStep: state.onboardingStep,
        onboardingComplete: state.onboardingComplete,
        ageMinutesSinceLastStep,
        notify: () =>
          toast.show(
            result.isNewAccount
              ? "Account created. You’re signed in ✅"
              : "Welcome back! Signed in ✅",
            { kind: "success" }
          ),
        markAccountCreated,
        setStep,
        replace: (route) => router.replace(route as never),
        returnTo,
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Sign-in failed", { kind: "error" });
    } finally {
      setProviderLoading(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: colors.BG }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      {/* The provider buttons pushed the form past the fold on SE-class
          screens (and past it everywhere with the keyboard open) — the page
          must scroll. keyboardShouldPersistTaps lets the submit/provider
          buttons receive their first tap while the keyboard is up. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.pageInner}>
          {/* Logo */}
          <Image
            source={require("../assets/images/android-icon-foreground.png")}
            style={styles.logo}
          />

          {/* Blurred tease of the rider's real pending tune (hidden when no
              pending tune exists — direct signup route). */}
          {teaseTune && <TuneTeaseCard values={teaseTune} />}

          {/* Headline: brand display fallback (Barlow Condensed not bundled) —
              heaviest weight, uppercase, tight leading, accent period. */}
          <Text style={styles.headline}>
            CREATE YOUR ACCOUNT
            <Text style={styles.headlineDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>
            One step left to reveal your settings.
          </Text>

          {/* Provider sign-in (feature-gated: absent in binaries without the
              native modules). Apple first on iOS per App Store convention;
              Android shows Google only. */}
          {(appleAvailable || googleAvailable) && (
            <View style={styles.providerBlock}>
              {appleAvailable && (
                <>
                  <Pressable
                    onPress={() => onProviderSignIn("apple")}
                    disabled={providerLoading !== null || loadingUp}
                    style={({ pressed }) => [
                      styles.providerBtn,
                      pressed && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Apple"
                  >
                    {providerLoading === "apple" ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="logo-apple" size={18} color="#000" />
                        <Text style={styles.providerBtnText}>
                          Continue with Apple
                        </Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
              {googleAvailable && (
                <Pressable
                  onPress={() => onProviderSignIn("google")}
                  disabled={providerLoading !== null || loadingUp}
                  style={({ pressed }) => [
                    styles.providerBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                >
                  {providerLoading === "google" ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color="#3c4043" />
                      <Text style={styles.providerBtnText}>
                        Continue with Google
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
              {/* Hint moved BELOW the buttons (v2.3.0), caption weight. */}
              {appleAvailable && (
                <Text style={styles.providerHint}>
                  Signed up with email before? Choose Share My Email so we
                  find your garage.
                </Text>
              )}
              {/* Passive agreement covers the provider path; the email path
                  keeps its explicit checkbox inside the form. */}
              <Text style={styles.termsPassive}>
                By continuing you agree to the{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/terms")}
                >
                  Terms of Service
                </Text>{" "}
                and{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/privacy")}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
            </View>
          )}

          {/* Email path, collapsed to one row; tapping expands the EXISTING
              form in place (logic untouched). */}
          <Pressable
            onPress={onToggleEmail}
            style={({ pressed }) => [
              styles.emailRow,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              emailOpen ? "Hide the email form" : "Continue with email"
            }
          >
            <Ionicons name="mail-outline" size={18} color={colors.TEXT} />
            <Text style={styles.emailRowText}>Continue with email</Text>
            <View style={{ flex: 1 }} />
            <Ionicons
              name={emailOpen ? "chevron-up-outline" : "chevron-down-outline"}
              size={16}
              color="rgba(255,255,255,0.4)"
            />
          </Pressable>

          {/* Form (existing, unchanged logic) — renders only when expanded */}
          {emailOpen && (
          <View style={styles.form}>
            {/* Email */}
            <Text style={styles.label}>Email</Text>
            <TextInput
              ref={emailInputRef}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailErr) setEmailErr("");
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, emailErr && styles.inputError]}
              returnKeyType="next"
              textContentType="username"
            />
            {!!emailErr && <Text style={styles.errorText}>{emailErr}</Text>}

            {/* Password + eye */}
            <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (pwErr) setPwErr("");
                }}
                secureTextEntry={!showPw}
                placeholder="At least 6 characters"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={[
                  styles.input,
                  pwErr && styles.inputError,
                  { paddingRight: 44 },
                ]}
                returnKeyType="done"
                onSubmitEditing={() => {
                  Keyboard.dismiss();
                  onSignUp();
                }}
                textContentType="newPassword"
              />
              <Pressable
                onPress={() => setShowPw((s) => !s)}
                hitSlop={8}
                style={styles.eye}
                accessibilityRole="button"
                accessibilityLabel={showPw ? "Hide password" : "Show password"}
              >
                <Ionicons
                  name={showPw ? "eye-off" : "eye"}
                  size={18}
                  color="rgba(255,255,255,0.4)"
                />
              </Pressable>
            </View>
            {!!pwErr && <Text style={styles.errorText}>{pwErr}</Text>}

            {/* Agreement row */}
            <View style={styles.agreeRow}>
              <Pressable
                onPress={() => setAccepted((a) => !a)}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: accepted }}
                style={[styles.checkbox, accepted && styles.checkboxOn]}
              >
                {accepted ? (
                  <Ionicons name="checkmark" size={14} color="#fff" />
                ) : null}
              </Pressable>
              <Text style={styles.agreeText}>
                I agree to the{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/terms")}
                >
                  Terms of Service
                </Text>{" "}
                and{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/privacy")}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>

            {/* Create account button */}
            <Pressable
              onPress={onSignUp}
              disabled={loadingUp || !canSubmit}
              style={({ pressed }) => [
                styles.btn,
                !canSubmit && !loadingUp && styles.btnDisabled,
                loadingUp && styles.btnDisabled,
                pressed && canSubmit && { opacity: 0.92 },
              ]}
            >
              {loadingUp ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={[styles.btnText, !canSubmit && styles.btnTextDisabled]}
                >
                  Create Account
                </Text>
              )}
            </Pressable>

            <Text style={styles.helper}>
              You’ll use this email and password to sign in.
            </Text>
          </View>
          )}

          {/* Switch to login */}
          <Pressable
            onPress={() => router.replace("/login")}
            style={styles.switchRow}
          >
            <Text style={styles.switchText}>
              Already have an account?{" "}
              <Text style={styles.switchAccent}>Sign in</Text>
            </Text>
          </Pressable>
        </View>
      </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function SignupScreen() {
  return (
    <ToastProvider>
      <SignupInner />
    </ToastProvider>
  );
}

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    // Scroll container (was a fixed `page` view — see ScrollView comment in
    // render). flexGrow keeps short content filling the viewport; bottom
    // padding clears the home indicator on notched devices.
    pageContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 60,
      paddingBottom: 48,
      backgroundColor: C.BG,
    },
    pageInner: {
      flexGrow: 1,
    },

    logo: {
      width: 36,
      height: 36,
      borderRadius: 10,
      resizeMode: "contain",
      marginBottom: 28,
    },

    // Brand display fallback: Barlow Condensed Black Italic is not bundled,
    // so heaviest system weight, uppercase (literal), tight leading.
    headline: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 30,
      lineHeight: 32,
      letterSpacing: 0.2,
      marginBottom: 6,
    },
    headlineDot: {
      color: C.ACCENT,
    },
    subtitle: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 24,
    },

    providerBlock: {
      marginBottom: 16,
    },
    // Footnote weight, sits below the provider buttons as a caption.
    providerHint: {
      color: "rgba(255,255,255,0.38)",
      fontSize: 11,
      lineHeight: 15,
      maxWidth: "88%",
      marginBottom: 6,
    },
    termsPassive: {
      color: "rgba(255,255,255,0.38)",
      fontSize: 11,
      lineHeight: 15,
      marginBottom: 10,
    },
    providerBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: "#fff",
      borderRadius: 12,
      paddingVertical: 14,
      minHeight: 50,
      marginBottom: 10,
    },
    providerBtnText: {
      color: "#000",
      fontWeight: "700",
      fontSize: 15,
    },
    // Rhythm: buttons carry marginBottom 10, so the divider adds none of its
    // own — every gap in the provider stack reads as the same 10pt beat.
    // alignItems centers the hairlines on the "or" text's vertical middle.
    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 0,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: C.BORDER,
    },
    dividerText: {
      color: "rgba(255,255,255,0.35)",
      fontSize: 12,
      fontWeight: "600",
    },

    // Same height/radius family as the provider buttons, outlined.
    emailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 12,
      paddingHorizontal: 14,
      minHeight: 50,
    },
    emailRowText: {
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 15,
    },

    form: {
      backgroundColor: C.CARD,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 20,
      marginTop: 10,
    },

    label: {
      marginBottom: 6,
      color: "rgba(255,255,255,0.6)",
      fontWeight: "600",
      fontSize: 13,
    },

    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: C.TEXT,
      minHeight: 46,
    },
    inputError: { borderColor: C.ERROR },
    errorText: { color: C.ERROR, marginTop: 6, fontSize: 12 },

    eye: {
      position: "absolute",
      right: 4,
      top: 0,
      bottom: 0,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },

    agreeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 16,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: C.BORDER,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    checkboxOn: {
      backgroundColor: C.ACCENT,
      borderColor: C.ACCENT,
    },
    agreeText: {
      color: "rgba(255,255,255,0.55)",
      flex: 1,
      lineHeight: 20,
      fontSize: 13,
    },
    legalLink: {
      color: "rgba(255,255,255,0.75)",
      fontWeight: "600",
    },

    btn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 18,
      minHeight: 52,
    },
    btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
    btnDisabled: {
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    btnTextDisabled: {
      color: "rgba(255,255,255,0.3)",
    },

    helper: {
      color: "rgba(255,255,255,0.35)",
      textAlign: "center",
      marginTop: 10,
      fontSize: 12,
    },

    switchRow: {
      marginTop: 20,
      alignItems: "center",
    },
    switchText: {
      color: "rgba(255,255,255,0.45)",
      fontSize: 14,
    },
    switchAccent: {
      color: C.ACCENT,
      fontWeight: "700",
    },
  });
