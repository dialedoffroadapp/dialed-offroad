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
import type { ThemeTokens } from "../constants/theme";
import {
  PENDING_GUEST_BIKE_SYNC_KEY,
  readPendingTune,
  remapPendingTuneBikeId,
  useOnboarding,
} from "../lib/onboarding";
import { normalizeBikeStrings, resolveModelId } from "../lib/bikes";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";

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

      // 3) Ensure a profiles row exists so downstream screens never hit null.
      //    Retry up to 2 times to handle transient RLS/timing issues where the
      //    new session JWT may not be fully propagated yet.
      if (signInData?.user?.id) {
        let profileCreated = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          // is_pro is server-only (webhook/service role) since 20260710170000
          // — including it would fail the whole upsert on column grants.
          const { error: profileErr } = await supabase.from("profiles").upsert(
            {
              user_id: signInData.user.id,
              onboarding_step: "trial",
              onboarding_complete: false,
            },
            { onConflict: "user_id", ignoreDuplicates: false }
          );
          if (!profileErr) {
            profileCreated = true;
            break;
          }
          // Brief pause before retry to let the JWT propagate
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
        }
        if (!profileCreated) {
          // Profile creation failed after retries — still route the user forward
          // rather than stranding them. Login will detect the missing profile
          // and create it on next sign-in.
          console.warn("[Signup] profile upsert failed after retries");
        }

        // 4) Migrate guest bike from pending tune into Supabase so hasLegacyUsage
        //    fires correctly on next cold start and the TrialPromptModal can show.
        //    Capture the new uuid and rewrite the pending tune's bike ids with
        //    it — the tune was generated as a guest, so its meta still carries
        //    the LOCAL bike id, which would strand the post-signup refine/save
        //    flow bikeless (no lineage/history).
        let pendingBike: { make: string; model: string; year: number } | null = null;
        try {
          const { tune: pending } = await readPendingTune();
          if (pending) {
            const metaObj = JSON.parse(decodeURIComponent(pending.meta));
            const bike = metaObj?.bike;
            if (bike?.make && bike?.model && bike?.year) {
              const norm = normalizeBikeStrings(
                String(bike.make),
                String(bike.model)
              );
              pendingBike = {
                make: norm.make,
                model: norm.model,
                year: Number(bike.year),
              };
              const model_id = await resolveModelId(
                pendingBike.make,
                pendingBike.model,
                pendingBike.year
              );
              const { data: insertedBike, error: bikeInsertErr } = await supabase
                .from("bikes")
                .insert({
                  user_id: signInData.user.id,
                  ...pendingBike,
                  model_id,
                })
                .select("id")
                .single();
              if (bikeInsertErr) throw bikeInsertErr;
              pendingBike = null; // success — no retry needed
              if (insertedBike?.id) {
                await remapPendingTuneBikeId(insertedBike.id);
              }
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
      // Enumeration protection (email confirmation disabled) can make signUp()
      // return no error for an EXISTING email, with an empty identities[]. That
      // is a sign-in, not a new account — so sign_up only fires when identities
      // is non-empty (genuinely new); otherwise log sign_in.
      const isNewAccount =
        !Array.isArray(signUpData?.user?.identities) ||
        (signUpData?.user?.identities?.length ?? 0) > 0;
      await logEvent(isNewAccount ? "sign_up" : "sign_in");

      // Funnel completion for ANY new account created during active (incomplete)
      // onboarding — previously gated on step === "signup", which missed signups
      // routed in from the login screen, the guest-tune gate, cold-start resume,
      // and the tune-results fallback. Routing below stays gated on "signup".
      if (isNewAccount && !state.onboardingComplete) {
        const funnelId = await getOrCreateFunnelId();
        await logEvent("onboarding_signup_completed", {
          funnel_id: funnelId,
          onboarding_step: state.onboardingStep,
          signed_in: true,
          account_created: true,
          trial_started: false,
          onboarding_complete: false,
          pending_tune_exists: true,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/signup",
        });
      }

      if (state.onboardingStep === "signup") {
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

          {/* Headline + context-aware subtitle */}
          <Text style={styles.headline}>Create your account</Text>
          <Text style={styles.subtitle}>
            {state.onboardingStep === "signup"
              ? state.hasSeenIntro
                ? "Almost there — create your account to reveal your tune."
                : "Your setup is ready. Create your account to reveal it and save your bike."
              : "Start saving bikes, sessions, and AI-powered presets."}
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
