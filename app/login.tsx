// app/login.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking"; // 👈 NEW
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

function LoginInner() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [email, setEmail] = useState("");
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

  // If there is already a session, go straight into the app
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) router.replace("/(tabs)");
    })();
  }, [router]);

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
      router.replace("/(tabs)");
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

  // 🔐 REAL password reset flow via Supabase + deep link
  const onResetPassword = async () => {
    const emailClean = email.trim();

    if (!/^\S+@\S+\.\S+$/.test(emailClean)) {
      setEmailErr("Enter the email on your account first.");
      return;
    }

    try {
      setLoadingReset(true);

      // Let Expo Linking generate the right URL (dev / prod / TF)
      const redirectUrl = Linking.createURL("/reset-password");

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
          {/* Top bar with logo */}
          <View style={styles.headerRow}>
            <Image
              source={require("../assets/images/android-icon-foreground.png")}
              style={styles.logoImage}
            />
          </View>

          <View style={styles.brandTop}>
            <Text style={styles.brandTitle}>Welcome back</Text>
            <Text style={styles.brandSub}>
              Dial in your bike faster with zero-based tunes.
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
              placeholderTextColor={colors.MUTED}
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
                placeholder="••••••••"
                placeholderTextColor={colors.MUTED}
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
                  color={colors.MUTED}
                />
              </Pressable>
            </View>
            {!!pwErr && <Text style={styles.errorText}>{pwErr}</Text>}

            {/* Primary actions */}
            <View style={{ height: 12 }} />
            <Pressable
              onPress={onSignIn}
              disabled={loadingIn || !canSubmitPw}
              style={({ pressed }) => [
                styles.btn,
                (loadingIn || !canSubmitPw) && styles.btnDisabled,
                pressed && canSubmitPw && { opacity: 0.95 },
              ]}
            >
              {loadingIn ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Sign In</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onResetPassword}
              disabled={loadingReset}
              style={styles.linkBtn}
            >
              <Text style={styles.linkText}>
                {loadingReset ? "Sending…" : "Forgot password?"}
              </Text>
            </Pressable>

            {/* Help text */}
            <Text style={styles.help}>
              If the reset link doesn’t work, email{" "}
              <Text style={styles.linkInline}>dialedoffroadapp@gmail.com</Text>{" "}
              and we’ll help you get back in.
            </Text>

            {/* Footer copy + sign-up link */}
            <Text style={styles.terms}>
              By signing in, you agree to our{" "}
              <Text
                style={styles.link}
                onPress={() => router.push("/legal/privacy")}
              >
                Privacy Policy
              </Text>{" "}
              and{" "}
              <Text
                style={styles.link}
                onPress={() => router.push("/legal/terms")}
              >
                Terms of Service
              </Text>
              .
            </Text>

            <View style={{ height: 12 }} />

            <View style={styles.signupRow}>
              <Text style={styles.signupText}>New here?</Text>
              <Pressable onPress={() => router.push("/signup")}>
                <Text style={styles.signupLink}>Create an account</Text>
              </Pressable>
            </View>
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
    page: { flex: 1, padding: 16, paddingTop: 56, backgroundColor: C.BG },

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
    brandTitle: { color: C.TEXT, fontWeight: "900", fontSize: 22 },
    brandSub: { color: C.MUTED, marginTop: 4 },

    card: {
      backgroundColor: C.CARD,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 16,
      maxWidth: 560,
    },

    label: {
      marginTop: 6,
      marginBottom: 6,
      color: C.MUTED,
      fontWeight: "700",
    },

    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INK,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 10,
      fontSize: 16,
      color: C.TEXT,
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
      paddingVertical: 12,
      alignItems: "center",
    },
    btnText: { color: "#fff", fontWeight: "900" },
    btnDisabled: { opacity: 0.6 },

    linkBtn: { paddingVertical: 8, alignSelf: "flex-start" },
    linkText: { color: C.ACCENT, fontWeight: "800", fontSize: 12 },

    help: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 8,
    },
    linkInline: { color: C.ACCENT, fontWeight: "800" },

    terms: {
      color: C.MUTED,
      textAlign: "center",
      marginTop: 8,
      fontSize: 12,
    },

    link: { color: C.ACCENT, fontWeight: "800" },

    signupRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
    },
    signupText: { color: C.MUTED, fontSize: 13 },
    signupLink: { color: C.ACCENT, fontWeight: "800", fontSize: 13 },
  });
