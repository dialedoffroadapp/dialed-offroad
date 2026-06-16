// app/signup.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ToastProvider, useToast } from "../components/Toast";
import { COLORS } from "../constants/theme";
import {
  PENDING_GUEST_BIKE_SYNC_KEY,
  readPendingTune,
  useOnboarding,
} from "../lib/onboarding";
import { supabase } from "../lib/supabase";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";

function SignupInner() {
  const router = useRouter();
  const toast = useToast();
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

  const emailValid = useMemo(() => /^\S+@\S+\.\S+$/.test(email.trim()), [email]);
  const canSubmit = emailValid && password.trim().length > 0 && accepted;
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
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
      });
      if (error) throw error;

      // 2) Immediately sign them in (no email verification required for now)
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (signInErr) {
        // Account was created but auto-login failed — send them to login with email pre-filled.
        toast.show("Account created! Please sign in to continue.", { kind: "success" });
        setLoadingUp(false);
        router.replace({ pathname: "/login", params: { email: email.trim() } } as never);
        return;
      }

      // 3) Ensure a profiles row exists so downstream screens never hit null
      if (signInData?.user?.id) {
        const { error: profileErr } = await supabase.from("profiles").upsert(
          {
            user_id: signInData.user.id,
            onboarding_step: "trial",
            onboarding_complete: false,
            is_pro: false,
          },
          { onConflict: "user_id", ignoreDuplicates: false }
        );
        if (profileErr) {
          toast.show("Account created but profile setup failed. Please try signing in.", { kind: "error" });
          setLoadingUp(false);
          return;
        }

        // 4) Migrate guest bike from pending tune into Supabase so hasLegacyUsage
        //    fires correctly on next cold start and the TrialPromptModal can show.
        let pendingBike: { make: string; model: string; year: number } | null = null;
        try {
          const { tune: pending } = await readPendingTune();
          if (pending) {
            const metaObj = JSON.parse(decodeURIComponent(pending.meta));
            const bike = metaObj?.bike;
            if (bike?.make && bike?.model && bike?.year) {
              pendingBike = {
                make: String(bike.make),
                model: String(bike.model),
                year: Number(bike.year),
              };
              await supabase.from("bikes").insert({
                user_id: signInData.user.id,
                ...pendingBike,
              });
              pendingBike = null; // success — no retry needed
            }
          }
        } catch {
          // Save for retry on next cold start
          if (pendingBike) {
            try {
              await AsyncStorage.setItem(
                PENDING_GUEST_BIKE_SYNC_KEY,
                JSON.stringify({ ...pendingBike, userId: signInData.user.id })
              );
            } catch {
              // ignore
            }
          }
        }
      }

      toast.show("Account created. You’re signed in ✅", {
        kind: "success",
      });
      await logEvent("sign_up");

      if (state.onboardingStep === "signup") {
        const funnelId = await getOrCreateFunnelId();
        await logEvent("onboarding_signup_completed", {
          funnel_id: funnelId,
          onboarding_step: "trial",
          signed_in: true,
          account_created: true,
          trial_started: false,
          onboarding_complete: false,
          pending_tune_exists: true,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/signup",
        });
        await markAccountCreated();
        await setStep("trial");
        router.replace("/premium");
        return;
      }

      // ✅ go to paywall (or whatever returnTo is)
      router.replace(returnTo);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to sign up", { kind: "error" });
    } finally {
      setLoadingUp(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: "#0B0C10" }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.page}>
        {/* Top bar with logo */}
        <View style={styles.headerRow}>
          <Image
            source={require("../assets/images/android-icon-foreground.png")}
            style={styles.logoImage}
          />
        </View>

        <View style={styles.brandTop}>
          <Text style={styles.brandTitle}>Create your account</Text>
          <Text style={styles.brandSub}>
            {state.onboardingStep === "signup"
              ? state.hasSeenIntro
                ? "Almost there — create your account to reveal your tune."
                : "Your setup is ready. Create your account to reveal it and save your bike."
              : "Start saving bikes, sessions, and AI-powered presets."}
          </Text>
        </View>

          <View style={styles.card}>
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
            placeholderTextColor="#6B7280"
            style={[styles.input, emailErr && styles.inputError]}
            returnKeyType="next"
            textContentType="username"
            />
            {!!emailErr && <Text style={styles.errorText}>{emailErr}</Text>}

          {/* Password + eye */}
            <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
            <View style={{ position: "relative" }}>
              <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (pwErr) setPwErr("");
              }}
              secureTextEntry={!showPw}
              placeholder="At least 6 characters"
              placeholderTextColor="#6B7280"
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
                color="#6B7280"
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
                style={styles.link}
                onPress={() => router.push("/legal/terms")}
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                style={styles.link}
                onPress={() => router.push("/legal/privacy")}
              >
                Privacy Policy
              </Text>
              .
              </Text>
            </View>

            <View style={{ height: 12 }} />

          {/* Create account button */}
            <Pressable
            onPress={onSignUp}
            disabled={loadingUp || !canSubmit}
            style={({ pressed }) => [
              styles.btn,
              (loadingUp || !canSubmit) && styles.btnDisabled,
              pressed && canSubmit && { opacity: 0.95 },
            ]}
          >
            {loadingUp ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Create Account</Text>
            )}
            </Pressable>

            <Text style={styles.terms}>
              You’ll use this email and password to sign in.
            </Text>

            <View style={{ height: 12 }} />

          {/* Sign in instead -> button */}
            <Pressable
              onPress={() => router.replace("/login")}
              style={styles.switchBtn}
            >
              <Text style={styles.switchBtnText}>
                Already have an account? Sign in
              </Text>
            </Pressable>
          </View>
        </View>
      </TouchableWithoutFeedback>
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

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, paddingTop: 56 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  logoImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
    resizeMode: "contain",
  },

  brandTop: { marginBottom: 12, paddingHorizontal: 4 },
  brandTitle: { color: "#F5F7FC", fontWeight: "900", fontSize: 22 },
  brandSub: { color: "#6B7280", marginTop: 4 },

  card: {
    backgroundColor: "#111318",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 16,
    maxWidth: 560,
  },

  label: {
    marginTop: 8,
    marginBottom: 6,
    color: "#6B7280",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.5,
  },

  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    backgroundColor: "#0C0D12",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#F5F7FC",
    minHeight: 44,
  },
  inputError: { borderColor: "#F05252" },
  errorText: { color: "#F05252", marginTop: 6, fontSize: 12 },

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
    backgroundColor: "#1D9BF0",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  btnDisabled: { opacity: 0.5 },

  terms: {
    color: "#6B7280",
    textAlign: "center",
    marginTop: 6,
    fontSize: 12,
  },

  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxOn: {
    backgroundColor: "#1D9BF0",
    borderColor: "#1D9BF0",
  },
  agreeText: { color: "#F5F7FC", flex: 1, lineHeight: 20, fontSize: 13 },
  link: { color: "#1D9BF0", fontWeight: "800" },

  switchBtn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  switchBtnText: { color: "#F5F7FC", fontWeight: "800", fontSize: 13 },
});
