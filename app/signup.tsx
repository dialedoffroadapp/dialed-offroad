// app/signup.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { ToastProvider, useToast } from "../components/Toast";
import { COLORS } from "../constants/theme";
import { supabase } from "../lib/supabase";
import { logEvent } from "../lib/usage";

function SignupInner() {
  const router = useRouter();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");

  const [accepted, setAccepted] = useState(false);
  const [loadingUp, setLoadingUp] = useState(false);

  const emailValid = useMemo(() => /^\S+@\S+\.\S+$/.test(email.trim()), [email]);
  const canSubmit = emailValid && password.trim().length > 0 && accepted;

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
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (signInErr) throw signInErr;

      toast.show("Account created. You’re signed in ✅", {
        kind: "success",
      });
      await logEvent("sign_up");

      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to sign up", { kind: "error" });
    } finally {
      setLoadingUp(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: COLORS.BG }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
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
            Start saving bikes, sessions, and AI-powered presets.
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
            placeholderTextColor={COLORS.MUTED}
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
              placeholderTextColor={COLORS.MUTED}
              style={[
                styles.input,
                pwErr && styles.inputError,
                { paddingRight: 44 },
              ]}
              returnKeyType="go"
              onSubmitEditing={onSignUp}
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
                color={COLORS.MUTED}
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
  brandTitle: { color: COLORS.TEXT, fontWeight: "900", fontSize: 22 },
  brandSub: { color: COLORS.MUTED, marginTop: 4 },

  card: {
    backgroundColor: COLORS.CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 16,
    maxWidth: 560,
  },

  label: {
    marginTop: 6,
    marginBottom: 6,
    color: COLORS.MUTED,
    fontWeight: "700",
  },

  input: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 10,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  inputError: { borderColor: COLORS.ERROR },
  errorText: { color: COLORS.ERROR, marginTop: 6, fontSize: 12 },

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
    backgroundColor: COLORS.ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "900" },
  btnDisabled: { opacity: 0.6 },

  terms: {
    color: COLORS.MUTED,
    textAlign: "center",
    marginTop: 8,
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
    borderColor: COLORS.BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxOn: {
    backgroundColor: COLORS.ACCENT,
    borderColor: COLORS.ACCENT,
  },
  agreeText: { color: COLORS.TEXT, flex: 1, lineHeight: 20 },
  link: { color: COLORS.ACCENT, fontWeight: "800" },

  switchBtn: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  switchBtnText: { color: COLORS.TEXT, fontWeight: "800", fontSize: 13 },
});
