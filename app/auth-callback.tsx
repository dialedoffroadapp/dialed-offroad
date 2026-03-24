import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ToastProvider } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

function AuthCallbackInner() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const currentUrl = Linking.useURL();
  const processedUrlRef = useRef<string | null>(null);

  const [message, setMessage] = useState("Opening reset link...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const handleUrl = async (url: string | null) => {
      if (!url || processedUrlRef.current === url) return;
      processedUrlRef.current = url;

      try {
        setError(null);
        setMessage("Starting password reset...");

        const normalized = url.includes("#") ? url.replace("#", "?") : url;
        const parsed = Linking.parse(normalized);

        const accessToken = parsed.queryParams?.access_token;
        const refreshToken = parsed.queryParams?.refresh_token;
        const type = parsed.queryParams?.type;

        if (type !== "recovery") {
          throw new Error("This password reset link is invalid.");
        }

        if (
          typeof accessToken !== "string" ||
          typeof refreshToken !== "string"
        ) {
          throw new Error("This password reset link is invalid or has expired.");
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (sessionError) {
          throw sessionError;
        }

        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) {
          throw userError ?? new Error("Could not verify the recovery session.");
        }

        if (!mounted) return;
        router.replace("/reset-password");
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message ?? "Something went wrong opening the reset link.");
      }
    };

    if (currentUrl) {
      handleUrl(currentUrl);
    } else {
      Linking.getInitialURL().then(handleUrl).catch((e) => {
        if (!mounted) return;
        setError(e?.message ?? "Something went wrong opening the reset link.");
      });
    }

    return () => {
      mounted = false;
    };
  }, [currentUrl, router]);

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        {error ? (
          <>
            <Text style={styles.title}>Password reset</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={[styles.btn, { marginTop: 16 }]}
              onPress={() => router.replace("/login")}
            >
              <Text style={styles.btnText}>Back to Sign In</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={styles.title}>Password reset</Text>
            <Text style={styles.mutedText}>{message}</Text>
          </>
        )}
      </View>
    </View>
  );
}

export default function AuthCallbackScreen() {
  return (
    <ToastProvider>
      <AuthCallbackInner />
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
    card: {
      backgroundColor: C.CARD,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 16,
      width: "100%",
      maxWidth: 560,
      alignItems: "center",
    },
    title: {
      color: C.TEXT,
      fontSize: 20,
      fontWeight: "900",
      marginTop: 12,
      marginBottom: 8,
    },
    mutedText: {
      color: C.MUTED,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    errorText: {
      color: C.DANGER,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    btn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
    },
    btnText: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 15,
    },
  });
