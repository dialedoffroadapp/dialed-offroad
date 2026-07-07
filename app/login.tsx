// app/login.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { ToastProvider, useToast } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import type { OnboardingStep } from "../lib/onboarding";
import {
  readLocalOnboardingState,
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import { deriveIsPro } from "../lib/proUtils";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
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
  const { markAccountCreated, setStep } = useOnboarding();
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

  const emailValid = useMemo(
    () => /^\S+@\S+\.\S+$/.test(email.trim()),
    [email]
  );
  const canSubmitPw = emailValid && password.length > 0;

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
            await supabase.from("profiles").upsert(
              {
                user_id: uid,
                onboarding_step: fallbackStep,
                onboarding_complete: fallbackStep === "complete",
                is_pro: false,
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
      router.replace(target);
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
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.page}>
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
    page: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 60,
      backgroundColor: C.BG,
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
