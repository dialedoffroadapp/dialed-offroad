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

/** How long to wait before showing an error (ms). */
const URL_TIMEOUT_MS = 10_000;

function AuthCallbackInner() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  // Grab route params once — stash in a ref so the effect doesn't re-fire
  const routeParams = useLocalSearchParams<{
    code?: string;
    access_token?: string;
    refresh_token?: string;
    type?: string;
  }>();
  const routeParamsRef = useRef(routeParams);
  routeParamsRef.current = routeParams;

  const routerRef = useRef(router);
  routerRef.current = router;

  const ranRef = useRef(false);
  const [message, setMessage] = useState("Opening reset link\u2026");
  const [error, setError] = useState<string | null>(null);

  // ── Single-run effect (empty deps — never re-fires) ───────────────────
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let mounted = true;
    console.log("[auth-callback] effect mounted");

    const fail = (msg: string) => {
      if (!mounted) return;
      console.log("[auth-callback] fail:", msg);
      setError(msg);
    };

    // ── Timeout: arms IMMEDIATELY, fires if nothing completes in 10s ──
    const timeout = setTimeout(() => {
      console.log("[auth-callback] timeout fired");
      fail(
        "This reset link has expired or is invalid. Please request a new one."
      );
    }, URL_TIMEOUT_MS);

    // ── Resolve the URL from all available sources ────────────────────

    const resolveUrl = async (): Promise<string | null> => {
      // 1. Module-level capture (stashed before Expo Router consumed it)
      const captured = await consumeCapturedDeepLink();
      if (captured) {
        console.log("[auth-callback] source: captured deep link =", captured);
        return captured;
      }

      // 2. Linking.getInitialURL (may still work on some Expo versions)
      try {
        const initial = await Linking.getInitialURL();
        if (initial && initial.includes("auth-callback")) {
          console.log("[auth-callback] source: getInitialURL =", initial);
          return initial;
        }
      } catch {
        // ignore
      }

      // 3. Wait briefly for a warm-start URL event
      return new Promise<string | null>((resolve) => {
        const sub = Linking.addEventListener("url", ({ url }) => {
          if (url && url.includes("auth-callback")) {
            console.log(
              "[auth-callback] source: addEventListener =",
              url
            );
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

    // ── Token exchange (implicit #fragment OR PKCE ?code) ────────────

    const exchangeTokens = async () => {
      if (!mounted) return;
      setMessage("Starting password reset\u2026");

      const url = await resolveUrl();
      console.log("[auth-callback] resolved URL:", url);

      const params = routeParamsRef.current;

      // ── Try PKCE path first (from route params or URL query) ──────
      const pkceCode =
        params.code ??
        (url ? Linking.parse(url).queryParams?.code : undefined);

      if (typeof pkceCode === "string" && pkceCode.length > 0) {
        console.log("[auth-callback] PKCE code found, exchanging\u2026");
        if (!mounted) return;
        setMessage("Verifying reset code\u2026");

        const { error: codeErr } =
          await supabase.auth.exchangeCodeForSession(pkceCode);
        if (codeErr) throw codeErr;

        const { data, error: userErr } = await supabase.auth.getUser();
        if (userErr || !data.user) {
          throw (
            userErr ?? new Error("Could not verify the recovery session.")
          );
        }

        console.log(
          "[auth-callback] PKCE exchange success, routing to /reset-password"
        );
        if (mounted) routerRef.current.replace("/reset-password");
        return;
      }

      // ── Implicit / fragment path ──────────────────────────────────
      let accessToken: string | undefined;
      let refreshToken: string | undefined;
      let type: string | undefined;

      // Try URL fragment first
      if (url && url.includes("#")) {
        const normalized = url.replace("#", "?");
        const parsed = Linking.parse(normalized);
        accessToken = parsed.queryParams?.access_token as string | undefined;
        refreshToken = parsed.queryParams?.refresh_token as string | undefined;
        type = parsed.queryParams?.type as string | undefined;
        console.log("[auth-callback] fragment tokens:", {
          accessToken: !!accessToken,
          refreshToken: !!refreshToken,
          type,
        });
      }

      // Fallback: route params (Expo Router may have parsed query params)
      if (!accessToken && typeof params.access_token === "string") {
        accessToken = params.access_token;
        refreshToken = params.refresh_token;
        type = params.type;
        console.log("[auth-callback] route-param tokens:", {
          accessToken: !!accessToken,
          refreshToken: !!refreshToken,
          type,
        });
      }

      // Fallback: plain query-string parse of URL
      if (!accessToken && url) {
        const parsed = Linking.parse(url);
        if (typeof parsed.queryParams?.access_token === "string") {
          accessToken = parsed.queryParams.access_token;
          refreshToken = parsed.queryParams.refresh_token as
            | string
            | undefined;
          type = parsed.queryParams.type as string | undefined;
          console.log("[auth-callback] query-string tokens:", {
            accessToken: !!accessToken,
            refreshToken: !!refreshToken,
            type,
          });
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

      if (!mounted) return;
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
      if (mounted) routerRef.current.replace("/reset-password");
    };

    // ── Fire and handle errors ──────────────────────────────────────────

    exchangeTokens()
      .catch((e: any) => {
        console.log("[auth-callback] error:", e?.message ?? e);
        fail(e?.message ?? "Something went wrong opening the reset link.");
      })
      .finally(() => {
        // Only clear if the exchange finished (success or error).
        // The timeout is the safety net — don't clear it if we somehow
        // reach finally without having shown a result.
        if (mounted) clearTimeout(timeout);
      });

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

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
