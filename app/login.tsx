// app/login.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { ToastProvider, useToast } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import { completeAuthSuccess } from "../lib/authSuccess";
import type { OnboardingStep } from "../lib/onboarding";
import {
  readLocalOnboardingState,
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import { deriveIsPro } from "../lib/proUtils";
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
import { logEvent } from "../lib/usage";

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

function LoginInner() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { state, markAccountCreated, setStep } = useOnboarding();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(
    typeof params.email === "string" ? params.email : ""
  );
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");

  const [loadingIn, setLoadingIn] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  // Provider buttons render ONLY when the native module is in this binary —
  // same gating as app/signup.tsx (lib/socialAuth.ts guards).
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

  const emailValid = useMemo(
    () => /^\S+@\S+\.\S+$/.test(email.trim()),
    [email]
  );
  const canSubmitPw = emailValid && password.length > 0;
  const ageMinutesSinceLastStep = useMemo(() => {
    const parsed = Date.parse(state.lastUpdatedAt);
    const ageMs = Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
    return Math.round(ageMs / 60000);
  }, [state.lastUpdatedAt]);

  const onSignIn = async () => {
    setEmailErr("");
    setPwErr("");

    const emailClean = email.trim();
    const passwordRaw = password;

    if (!emailValid) setEmailErr("Enter a valid email.");
    if (!passwordRaw) setPwErr("Password is required.");
    if (!emailValid || !passwordRaw) return;

    setLoadingIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailClean,
        password: passwordRaw,
      });
      if (error) throw error;

      toast.show("Signed in ✅", { kind: "success" });
      // Attribute pre-auth tune_calls (WS-C). The email sign-in path keeps
      // its own inline flow (the IndexGate-mirror routing below) and never
      // reaches completeAuthSuccess — so it claims directly; OAuth on this
      // screen claims inside completeAuthSuccess like every other path.
      await claimAnonTuneCalls();
      await logEvent("sign_in");

      // Record locally that this device's user has an account — downstream
      // auth routing (results CTA) uses this to route to /login, not /signup.
      await markAccountCreated();

      // Route based on onboarding state (mirrors IndexGate logic)
      // Supabase-first, local-AsyncStorage-fallback resolution
      let target: string = "/(tabs)";
      try {
        const [{ data: authData }, localState, { tune: pendingTune }] =
          await Promise.all([
            supabase.auth.getUser(),
            readLocalOnboardingState(),
            readPendingTune(),
          ]);
        const uid = authData?.user?.id;
        if (uid) {
          let { data: prof } = await supabase
            .from("profiles")
            .select("onboarding_complete, onboarding_step, is_pro, pro_until, trial_tunes_used")
            .eq("user_id", uid)
            .maybeSingle();

          // Recovery: if the auth user exists but has no profile row
          // (e.g. signup created auth but profile insert failed), create it now.
          if (!prof) {
            const fallbackStep = localState.onboardingStep === "signup" ? "trial" : (localState.onboardingStep ?? "complete");
            // is_pro is server-only (webhook/service role) since 20260710170000
            // — including it would fail the whole upsert on column grants.
            await supabase.from("profiles").upsert(
              {
                user_id: uid,
                onboarding_step: fallbackStep,
                onboarding_complete: fallbackStep === "complete",
              },
              { onConflict: "user_id" }
            );
            // Re-read the profile so routing logic below uses the new row
            const { data: refetched } = await supabase
              .from("profiles")
              .select("onboarding_complete, onboarding_step, is_pro, pro_until, trial_tunes_used")
              .eq("user_id", uid)
              .maybeSingle();
            prof = refetched;
          }

          const hasPro = deriveIsPro(prof);
          const onboardingComplete =
            hasPro ||
            prof?.onboarding_complete === true ||
            localState.onboardingComplete;
          const onboardingStep =
            prof && isOnboardingStep(prof.onboarding_step)
              ? prof.onboarding_step
              : localState.onboardingStep;

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
                  { user_id: uid, onboarding_step: "trial" },
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
        }
      } catch {
        // Fall through to default "/(tabs)" if profile check fails
      }
      // target is assembled from typed literals above; the cast mirrors the
      // signup screen's replace callback (typed-routes vs dynamic string).
      router.replace(target as never);
    } catch (e: any) {
      const msg =
        e?.message?.toLowerCase().includes("invalid")
          ? "Email or password is incorrect."
          : e?.message ?? "Failed to sign in";
      toast.show(msg, { kind: "error" });
    } finally {
      setLoadingIn(false);
    }
  };

  const onProviderSignIn = async (provider: SocialProvider) => {
    setProviderLoading(provider);
    try {
      const result =
        provider === "apple"
          ? await signInWithApple()
          : await signInWithGoogle();

      // Sheet dismissed — stay on login, nothing was touched.
      if (result.status === "cancelled") return;
      if (result.status === "failed") {
        toast.show(result.message, { kind: "error" });
        return;
      }

      // Same-email accounts auto-link in Supabase, so an email/password user
      // tapping a provider lands in their existing account (isNewAccount
      // false). Record accountCreated like onSignIn does — downstream auth
      // routing (results CTA) uses it to route to /login, not /signup.
      await markAccountCreated();

      // mode "login": returning users get email login's heal-only profile
      // write — never a downgrade of their onboarding columns.
      await completeAuthSuccess({
        userId: result.userId,
        isNewAccount: result.isNewAccount,
        method: provider,
        displayName: result.displayName,
        mode: "login",
        onboardingStep: state.onboardingStep,
        onboardingComplete: state.onboardingComplete,
        ageMinutesSinceLastStep,
        notify: () =>
          toast.show(
            result.isNewAccount
              ? "Account created. You’re signed in ✅"
              : "Signed in ✅",
            { kind: "success" }
          ),
        markAccountCreated,
        setStep,
        replace: (route) => router.replace(route as never),
        returnTo: "/(tabs)",
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Sign-in failed", { kind: "error" });
    } finally {
      setProviderLoading(null);
    }
  };

  const onResetPassword = async () => {
    const emailClean = email.trim();

    if (!/^\S+@\S+\.\S+$/.test(emailClean)) {
      setEmailErr("Enter the email on your account first.");
      return;
    }

    try {
      setLoadingReset(true);

      const redirectUrl =
        Platform.OS === "web"
          ? Linking.createURL("/auth-callback")
          : __DEV__
            ? Linking.createURL("/auth-callback")
            : "dialedoffroad://auth-callback";

      const { error } = await supabase.auth.resetPasswordForEmail(
        emailClean,
        {
          redirectTo: redirectUrl,
        }
      );

      if (error) throw error;

      Alert.alert(
        "Check your email",
        "We sent a password reset link. Open it on your phone to set a new password."
      );
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to send reset email.", {
        kind: "error",
      });
    } finally {
      setLoadingReset(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: colors.BG }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      {/* Same scroll treatment as signup (c9f052d): the provider buttons
          consumed the vertical slack of a fixed layout, clipping the form on
          SE-class devices and everywhere with the keyboard open. */}
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

          {/* Headline + subtitle */}
          <Text style={styles.headline}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Dial in your bike faster with zero-based tunes.
          </Text>

          {/* Provider sign-in (feature-gated; Apple first on iOS, Google only
              on Android — same behavior as app/signup.tsx, no hint line). */}
          {(appleAvailable || googleAvailable) && (
            <View style={styles.providerBlock}>
              {appleAvailable && (
                <Pressable
                  onPress={() => onProviderSignIn("apple")}
                  disabled={providerLoading !== null || loadingIn}
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
              )}
              {googleAvailable && (
                <Pressable
                  onPress={() => onProviderSignIn("google")}
                  disabled={providerLoading !== null || loadingIn}
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
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
            </View>
          )}

          {/* Form */}
          <View style={styles.form}>
            {/* Email */}
            <Text style={styles.label}>Email</Text>
            <TextInput
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
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={[
                  styles.input,
                  pwErr && styles.inputError,
                  { paddingRight: 44 },
                ]}
                returnKeyType="done"
                onSubmitEditing={() => {
                  Keyboard.dismiss();
                  onSignIn();
                }}
                textContentType="password"
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

            {/* Sign In button */}
            <Pressable
              onPress={onSignIn}
              disabled={loadingIn || !canSubmitPw}
              style={({ pressed }) => [
                styles.btn,
                !canSubmitPw && !loadingIn && styles.btnDisabled,
                loadingIn && styles.btnDisabled,
                pressed && canSubmitPw && { opacity: 0.92 },
              ]}
            >
              {loadingIn ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={[styles.btnText, !canSubmitPw && styles.btnTextDisabled]}
                >
                  Sign In
                </Text>
              )}
            </Pressable>

            {/* Forgot password — single soft link */}
            <Pressable
              onPress={onResetPassword}
              disabled={loadingReset}
              style={styles.forgotBtn}
            >
              <Text style={styles.forgotText}>
                {loadingReset ? "Sending…" : "Forgot password?"}
              </Text>
            </Pressable>
          </View>

          {/* Divider + Create an account */}
          <View style={styles.divider} />
          <Pressable
            onPress={() => router.push("/signup")}
            style={styles.switchRow}
          >
            <Text style={styles.switchText}>
              New here?{" "}
              <Text style={styles.switchAccent}>Create an account</Text>
            </Text>
          </Pressable>

          {/* Fine print: legal + support — recessed at bottom */}
          <View style={styles.finePrintWrap}>
            <Text style={styles.finePrint}>
              By signing in, you agree to our{" "}
              <Text
                style={styles.finePrintLink}
                onPress={() => router.push("/legal/privacy")}
              >
                Privacy Policy
              </Text>{" "}
              and{" "}
              <Text
                style={styles.finePrintLink}
                onPress={() => router.push("/legal/terms")}
              >
                Terms of Service
              </Text>
              .{"\n"}
              Reset link not working? Email{" "}
              <Text style={styles.finePrintEmphasis}>dialedoffroadapp@gmail.com</Text>
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function LoginScreen() {
  return (
    <ToastProvider>
      <LoginInner />
    </ToastProvider>
  );
}

/* ----------------------------- styles (themed) ---------------------------- */

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    // Scroll container (was a fixed `page` view — see ScrollView comment in
    // render). flexGrow keeps short content filling the viewport; bottom
    // padding clears the home indicator.
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

    headline: {
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 24,
      letterSpacing: -0.3,
      marginBottom: 6,
    },
    subtitle: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 28,
    },

    providerBlock: {
      marginBottom: 18,
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
    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
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

    form: {
      backgroundColor: C.CARD,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 20,
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

    forgotBtn: {
      alignSelf: "center",
      paddingVertical: 10,
      marginTop: 4,
    },
    forgotText: {
      color: C.ACCENT,
      fontWeight: "600",
      fontSize: 13,
    },

    finePrintWrap: {
      marginTop: 24,
      paddingHorizontal: 4,
    },
    finePrint: {
      color: "rgba(255,255,255,0.28)",
      fontSize: 10,
      lineHeight: 15,
      textAlign: "center",
    },
    finePrintEmphasis: {
      color: "rgba(255,255,255,0.45)",
      fontWeight: "600",
    },
    finePrintLink: {
      color: "rgba(255,255,255,0.45)",
      fontWeight: "600",
      textDecorationLine: "underline",
    },

    divider: {
      height: 1,
      backgroundColor: C.BORDER,
      marginTop: 20,
      marginBottom: 16,
    },

    switchRow: {
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
