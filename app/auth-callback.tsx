// app/auth-callback.tsx
// Handles the deep link from Supabase's password-reset email.
// Supports both implicit flow (#access_token in fragment) and PKCE flow (?code in query).

import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { consumeCapturedDeepLink } from "./_layout";
import { ToastProvider } from "../components/Toast";
import type { ThemeTokens } from "../constants/theme";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

/** How long to wait for a valid URL before showing an error (ms). */
const URL_TIMEOUT_MS = 10_000;

function AuthCallbackInner() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Expo Router may have parsed query-string params (useful for PKCE ?code=)
  const routeParams = useLocalSearchParams<{
    code?: string;
    access_token?: string;
    refresh_token?: string;
    type?: string;
  }>();

  const processedRef = useRef(false);
  const [message, setMessage] = useState("Opening reset link\u2026");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (processedRef.current) return;
    let mounted = true;

    const fail = (msg: string) => {
      if (!mounted) return;
      setError(msg);
    };

    // ── Resolve the URL from all available sources ──────────────────────

    const resolveUrl = async (): Promise<string | null> => {
      // 1. Module-level capture (registered before Expo Router consumed it)
      const captured = consumeCapturedDeepLink();
      if (captured) {
        console.log("[auth-callback] source: captured deep link =", captured);
        return captured;
      }

      // 2. Linking.useURL() equivalent — try getInitialURL
      const initial = await Linking.getInitialURL();
      if (initial && initial.includes("auth-callback")) {
        console.log("[auth-callback] source: getInitialURL =", initial);
        return initial;
      }

      // 3. Wait briefly for a warm-start URL event
      return new Promise<string | null>((resolve) => {
        const sub = Linking.addEventListener("url", ({ url }) => {
          if (url && url.includes("auth-callback")) {
            console.log("[auth-callback] source: addEventListener =", url);
            sub.remove();
            resolve(url);
          }
        });
        // Give the event listener 2s to fire; if nothing, resolve null
        setTimeout(() => {
          sub.remove();
          resolve(null);
        }, 2000);
      });
    };

    // ── Token exchange (implicit #fragment OR PKCE ?code) ───────────────

    const exchangeTokens = async () => {
      processedRef.current = true;
      setMessage("Starting password reset\u2026");

      const url = await resolveUrl();
      console.log("[auth-callback] resolved URL:", url);

      // ── Try PKCE path first (from route params or URL query) ──────
      const pkceCode =
        routeParams.code ??
        (url ? Linking.parse(url).queryParams?.code : undefined);

      if (typeof pkceCode === "string" && pkceCode.length > 0) {
        console.log("[auth-callback] PKCE code found, exchanging\u2026");
        setMessage("Verifying reset code\u2026");

        const { error: codeErr } =
          await supabase.auth.exchangeCodeForSession(pkceCode);
        if (codeErr) throw codeErr;

        const { data, error: userErr } = await supabase.auth.getUser();
        if (userErr || !data.user) {
          throw userErr ?? new Error("Could not verify the recovery session.");
        }

        console.log("[auth-callback] PKCE exchange success, routing to /reset-password");
        if (mounted) router.replace("/reset-password");
        return;
      }

      // ── Implicit / fragment path ──────────────────────────────────
      // Tokens may be in the URL fragment, route params, or query string.
      let accessToken: string | undefined;
      let refreshToken: string | undefined;
      let type: string | undefined;

      if (url && url.includes("#")) {
        // Normalize fragment → query so Linking.parse can read them
        const normalized = url.replace("#", "?");
        const parsed = Linking.parse(normalized);
        accessToken = parsed.queryParams?.access_token as string | undefined;
        refreshToken = parsed.queryParams?.refresh_token as string | undefined;
        type = parsed.queryParams?.type as string | undefined;
        console.log("[auth-callback] fragment tokens:", { accessToken: !!accessToken, refreshToken: !!refreshToken, type });
      }

      // Fallback: check route params (Expo Router might have parsed them)
      if (!accessToken && typeof routeParams.access_token === "string") {
        accessToken = routeParams.access_token;
        refreshToken = routeParams.refresh_token;
        type = routeParams.type;
        console.log("[auth-callback] route-param tokens:", { accessToken: !!accessToken, refreshToken: !!refreshToken, type });
      }

      // Also try plain query-string parse of the URL (no fragment)
      if (!accessToken && url) {
        const parsed = Linking.parse(url);
        if (typeof parsed.queryParams?.access_token === "string") {
          accessToken = parsed.queryParams.access_token;
          refreshToken = parsed.queryParams.refresh_token as string | undefined;
          type = parsed.queryParams.type as string | undefined;
          console.log("[auth-callback] query-string tokens:", { accessToken: !!accessToken, refreshToken: !!refreshToken, type });
        }
      }

      if (type !== "recovery") {
        throw new Error("This password reset link is invalid.");
      }
      if (
        typeof accessToken !== "string" ||
        typeof refreshToken !== "string"
      ) {
        throw new Error(
          "This password reset link is invalid or has expired."
        );
      }

      setMessage("Verifying your identity\u2026");
      console.log("[auth-callback] calling setSession\u2026");

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) throw sessionError;

      console.log("[auth-callback] setSession success, verifying user\u2026");

      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) {
        throw (
          userError ?? new Error("Could not verify the recovery session.")
        );
      }

      console.log("[auth-callback] verified, routing to /reset-password");
      if (mounted) router.replace("/reset-password");
    };

    // ── Run with timeout ────────────────────────────────────────────────

    const timeout = setTimeout(() => {
      if (!mounted || processedRef.current) return;
      // If exchangeTokens is still running (awaiting setSession / getUser),
      // we don't cancel it — we just ensure the UI doesn't spin forever.
      fail(
        "This reset link has expired or is invalid. Please request a new one."
      );
    }, URL_TIMEOUT_MS);

    exchangeTokens().catch((e: any) => {
      console.log("[auth-callback] error:", e?.message ?? e);
      fail(e?.message ?? "Something went wrong opening the reset link.");
    }).finally(() => {
      clearTimeout(timeout);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, [routeParams, router]); // eslint-disable-line react-hooks/exhaustive-deps

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
