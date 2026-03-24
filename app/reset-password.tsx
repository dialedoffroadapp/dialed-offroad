// app/reset-password.tsx
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

function ResetInner() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [pwErr, setPwErr] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error || !data.session) {
          setSessionError("Reset link is invalid or has expired.");
          return;
        }

        setSessionError(null);
      } catch (e: any) {
        setSessionError(
          e?.message ?? "Something went wrong opening the reset link."
        );
      } finally {
        setLoadingSession(false);
      }
    };

    run();
  }, []);

  const onSaveNewPassword = async () => {
    setPwErr("");

    if (password.length < 8) {
      setPwErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setPwErr("Passwords do not match.");
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      toast.show("Password updated. You can sign in again now.", {
        kind: "success",
      });

      await supabase.auth.signOut();

      router.replace("/login");
    } catch (e: any) {
      setPwErr(e?.message ?? "Could not update password.");
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------- UI states ----------------------------

  if (loadingSession) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1 }}
      >
        <View style={[styles.page, styles.center]}>
          <ActivityIndicator />
          <Text style={styles.mutedText}>Opening reset link…</Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (sessionError) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1 }}
      >
        <View style={[styles.page, styles.card]}>
          <Text style={styles.title}>Password reset</Text>
          <Text style={styles.errorText}>{sessionError}</Text>

          <Pressable
            style={[styles.btn, { marginTop: 16 }]}
            onPress={() => router.replace("/login")}
          >
            <Text style={styles.btnText}>Back to Sign In</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Normal “enter new password” form
  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.page}>
          <View style={styles.card}>
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.mutedText}>
              Enter a new password for your Dialed Offroad account.
            </Text>

            <Text style={styles.label}>New password</Text>
            <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (pwErr) setPwErr("");
              }}
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              returnKeyType="next"
            />

            <Text style={[styles.label, { marginTop: 8 }]}>
              Confirm new password
            </Text>
            <TextInput
              value={password2}
              onChangeText={(v) => {
                setPassword2(v);
                if (pwErr) setPwErr("");
              }}
              secureTextEntry
              style={styles.input}
              placeholder="••••••••"
              returnKeyType="done"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                onSaveNewPassword();
              }}
            />

            {!!pwErr && <Text style={styles.errorText}>{pwErr}</Text>}

            <Pressable
              style={[styles.btn, { marginTop: 16 }]}
              onPress={onSaveNewPassword}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Update password</Text>
              )}
            </Pressable>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

export default function ResetPasswordScreen() {
  return (
    <ToastProvider>
      <ResetInner />
    </ToastProvider>
  );
}

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: C.BG,
      padding: 16,
      justifyContent: "center",
      alignItems: "center",
    },
    center: {
      justifyContent: "center",
      alignItems: "center",
    },
    card: {
      backgroundColor: C.CARD,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 16,
      width: "100%",
      maxWidth: 560,
    },
    title: {
      color: C.TEXT,
      fontSize: 20,
      fontWeight: "900",
      marginBottom: 8,
    },
    mutedText: {
      color: C.MUTED,
      fontSize: 13,
      marginBottom: 12,
    },
    label: {
      marginTop: 12,
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
    errorText: {
      color: C.ERROR,
      marginTop: 8,
      fontSize: 12,
    },
    btn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    btnText: {
      color: "#fff",
      fontWeight: "900",
    },
  });
