// app/login.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from "react-native";
import { ToastProvider, useToast } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import { completeAuthSuccess } from "../lib/authSuccess";
import { QUIZ_ONBOARDING_ENABLED } from "../lib/featureFlags";
import type { OnboardingStep } from "../lib/onboarding";
import { useOnboarding } from "../lib/onboarding";
import { isAppleSignInAvailable, isGoogleSignInAvailable, signInWithApple, signInWithGoogle, type SocialProvider } from "../lib/socialAuth";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

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
  const { state, markAccountCreated, setStep, completeOnboarding } = useOnboarding();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string }>();
  // The quiz gate hands us the reveal: the rider is this device's guest and
  // their pending tune must land in the garage.
  const fromGate = typeof params.returnTo === "string" && params.returnTo.startsWith("/quiz/reveal");

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
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email: emailClean,
        password: passwordRaw,
      });
      if (error) throw error;

      // The ONE post-auth path (audit item 9): profile heal (login mode never
      // downgrades onboarding columns), claim, sign_in event, funnel
      // completion when the local step is "signup", routing. The inline
      // IndexGate mirror that lived here routed retired legacy screens.
      await completeAuthSuccess({
        userId: signInData?.user?.id ?? null,
        isNewAccount: false,
        method: "email",
        mode: "login",
        onboardingStep: state.onboardingStep,
        onboardingComplete: state.onboardingComplete,
        ageMinutesSinceLastStep,
        notify: () => toast.show("Signed in ✅", { kind: "success" }),
        markAccountCreated,
        setStep,
        completeOnboarding,
        revealRoute: QUIZ_ONBOARDING_ENABLED ? "/quiz/reveal" : undefined,
        absorbGuestState: fromGate,
        replace: (route) => router.replace(route as never),
        returnTo: typeof params.returnTo === "string" && params.returnTo.length > 0 ? params.returnTo : "/(tabs)",
      });
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
        completeOnboarding,
        revealRoute: QUIZ_ONBOARDING_ENABLED ? "/quiz/reveal" : undefined,
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
              {/* Passive agreement for the provider path — identical copy
                  and styling to signup. Matters here because auto-linking
                  can MINT a new account from this screen (isNewAccount true)
                  and that user would otherwise never see terms. */}
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
    // Identical to signup's passive terms treatment.
    termsPassive: {
      color: "rgba(255,255,255,0.38)",
      fontSize: 11,
      lineHeight: 15,
      marginBottom: 10,
    },
    legalLink: {
      color: "rgba(255,255,255,0.75)",
      fontWeight: "600",
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
