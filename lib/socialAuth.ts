// lib/socialAuth.ts
// Native Apple / Google sign-in → Supabase signInWithIdToken. No web OAuth,
// no redirects, no deep links — the password-reset auth-callback machinery
// is untouched by design.
//
// Feature gating: the native modules ship in builds ≥ v2.3.0. Older binaries
// don't have them, so every module is loaded through a try/require guard and
// the availability checks below drive whether the signup screen renders the
// provider buttons at all (same "inert in old builds" posture as
// expo-notifications).
//
// ⚠️ oauth_started / oauth_failed are ANALYTICS-DARK: the usage_events CHECK
// constraint doesn't include them yet (staged migration
// 20260724090000_usage_events_oauth_event_types.sql, batched with the next
// push). They are deliberately logged WITHOUT queueIfAnonymous — a queued
// unknown event type would fail the entire pre-auth flush batch insert and
// take the onboarding funnel events down with it. Only add queueing in a
// build released AFTER the migration is verified applied.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { logEvent } from "./usage";

export type SocialProvider = "apple" | "google";

export type SocialAuthResult =
  | {
      status: "success";
      userId: string | null;
      isNewAccount: boolean;
      /** Provider name for display_name; Apple sends it on FIRST auth only. */
      displayName: string | null;
    }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const extra: any =
  (Constants as any)?.expoConfig?.extra ??
  (Constants as any)?.manifest?.extra ??
  {};

const GOOGLE_WEB_CLIENT_ID: string =
  typeof extra.GOOGLE_WEB_CLIENT_ID === "string"
    ? extra.GOOGLE_WEB_CLIENT_ID.trim()
    : "";
const GOOGLE_IOS_CLIENT_ID: string =
  typeof extra.GOOGLE_IOS_CLIENT_ID === "string"
    ? extra.GOOGLE_IOS_CLIENT_ID.trim()
    : "";

// require() guards — null when the module isn't usable in this binary.
//
// ⚠️ Metro resolves require() at BUNDLE time and rejects non-literal
// arguments ("Invalid call: require(name)") — a loadModule(name) helper here
// crashed the app at boot on the dev client's first launch (2026-07-28;
// jest and the native build both passed because neither goes through
// Metro). Each module therefore gets its own STATIC require in a try/catch:
// the string literal lets Metro resolve it, and the catch preserves the
// old-binary posture — native module absent → module factory throws →
// null → button hidden, never a crash.
/* eslint-disable @typescript-eslint/no-require-imports */
let appleAuthModule: any | null = null;
try {
  appleAuthModule = require("expo-apple-authentication");
} catch {
  appleAuthModule = null;
}

let cryptoModule: any | null = null;
try {
  cryptoModule = require("expo-crypto");
} catch {
  cryptoModule = null;
}

let googleModule: any | null = null;
try {
  googleModule = require("@react-native-google-signin/google-signin");
} catch {
  googleModule = null;
}
/* eslint-enable @typescript-eslint/no-require-imports */

function getAppleAuth(): any | null {
  return appleAuthModule;
}

function getCrypto(): any | null {
  return cryptoModule;
}

function getGoogleSignin(): any | null {
  return googleModule;
}

/** Apple: iOS 13+ device, module present in the binary, and OS capability on. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const mod = getAppleAuth();
  const crypto = getCrypto();
  if (!mod?.isAvailableAsync || !crypto?.digestStringAsync) return false;
  try {
    return (await mod.isAvailableAsync()) === true;
  } catch {
    return false;
  }
}

/** Google: module present in the binary and a web client id configured. */
export function isGoogleSignInAvailable(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;
  const mod = getGoogleSignin();
  return !!mod?.GoogleSignin && GOOGLE_WEB_CLIENT_ID.length > 0;
}

/** New-vs-returning for OAuth (requirement: created_at ≈ last_sign_in_at).
 *  Auto-linked existing accounts have an old created_at → returning. The
 *  email path keeps its own identities[] heuristic — do not share this. */
export function isNewOAuthUser(user: {
  created_at?: string;
  last_sign_in_at?: string | null;
} | null): boolean {
  const created = Date.parse(user?.created_at ?? "");
  const lastSignIn = Date.parse(user?.last_sign_in_at ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(lastSignIn)) return false;
  return Math.abs(lastSignIn - created) < 60_000;
}

function joinName(...parts: (string | null | undefined)[]): string | null {
  const joined = parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(" ");
  return joined.length > 0 ? joined : null;
}

function errorMessage(e: any, fallback: string): string {
  return typeof e?.message === "string" && e.message.length > 0
    ? e.message
    : fallback;
}

async function logOAuthFailed(provider: SocialProvider, e: any): Promise<void> {
  await logEvent("oauth_failed", {
    provider,
    code: typeof e?.code === "string" ? e.code : null,
    message: errorMessage(e, "unknown"),
  });
}

export async function signInWithApple(): Promise<SocialAuthResult> {
  const mod = getAppleAuth();
  const crypto = getCrypto();
  if (!mod || !crypto) {
    return {
      status: "failed",
      message: "Apple sign-in isn’t available in this version of the app.",
    };
  }

  await logEvent("oauth_started", { provider: "apple" });
  try {
    // Supabase requires the RAW nonce; Apple gets its SHA-256 digest.
    const rawNonce: string = crypto.randomUUID();
    const hashedNonce: string = await crypto.digestStringAsync(
      crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    );

    const credential = await mod.signInAsync({
      requestedScopes: [
        mod.AppleAuthenticationScope.FULL_NAME,
        mod.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential?.identityToken) {
      throw new Error("Apple returned no identity token.");
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    return {
      status: "success",
      userId: data?.user?.id ?? null,
      isNewAccount: isNewOAuthUser(data?.user ?? null),
      displayName: joinName(
        credential.fullName?.givenName,
        credential.fullName?.familyName
      ),
    };
  } catch (e: any) {
    // User dismissed the Apple sheet — not a failure, no event.
    if (e?.code === "ERR_REQUEST_CANCELED" || e?.code === "ERR_CANCELED") {
      return { status: "cancelled" };
    }
    await logOAuthFailed("apple", e);
    // Raw error is LOGGED (console + oauth_failed meta), never displayed —
    // provider/Supabase internals read as gibberish in a toast.
    console.warn("[socialAuth] apple sign-in failed:", errorMessage(e, "unknown"));
    return {
      status: "failed",
      message: "Couldn't sign in with Apple. Try again.",
    };
  }
}

let googleConfigured = false;

export async function signInWithGoogle(): Promise<SocialAuthResult> {
  const mod = getGoogleSignin();
  if (!mod?.GoogleSignin || !GOOGLE_WEB_CLIENT_ID) {
    return {
      status: "failed",
      message: "Google sign-in isn’t available in this version of the app.",
    };
  }

  await logEvent("oauth_started", { provider: "google" });
  try {
    if (!googleConfigured) {
      mod.GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
      });
      googleConfigured = true;
    }
    if (Platform.OS === "android") {
      await mod.GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }

    const response = await mod.GoogleSignin.signIn();
    // v13+ resolves { type: "cancelled" } instead of rejecting.
    if (response?.type === "cancelled") return { status: "cancelled" };
    const account = response?.data ?? response; // v13+ shape ?? legacy shape
    const idToken: string | null = account?.idToken ?? null;
    if (!idToken) throw new Error("Google returned no ID token.");

    // ⚠️ NO nonce here, and none can be added client-side (verified
    // 2026-07-28, do not "fix" blind):
    //   - GoogleSignIn's iOS SDK embeds an internally-generated nonce claim
    //     in the id_token; this wrapper (v16 free tier) exposes no API to
    //     supply our own (nonce params are paid/Universal-module only).
    //   - GoTrue validates ONLY sha256(passed_nonce) == token claim
    //     (supabase/auth internal/api/token_oidc.go) — we can never know the
    //     claim's preimage, so passing anything (including the claim itself)
    //     fails with "Nonces mismatch".
    //   - Ergo "Passed nonce and nonce in id_token should either both exist
    //     or not" is resolvable only server-side (Google provider
    //     skip_nonce_check) or by a paid/Universal wrapper migration.
    //   RESOLVED 2026-07-28: skip_nonce_check ENABLED on the Supabase Google
    //   provider (verified working on device). v2.3.x follow-up: Universal
    //   Sign-In migration with a real nonce, then disable the toggle.
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    if (error) throw error;

    return {
      status: "success",
      userId: data?.user?.id ?? null,
      isNewAccount: isNewOAuthUser(data?.user ?? null),
      displayName:
        joinName(account?.user?.name) ??
        joinName(account?.user?.givenName, account?.user?.familyName),
    };
  } catch (e: any) {
    if (e?.code === mod.statusCodes?.SIGN_IN_CANCELLED) {
      return { status: "cancelled" };
    }
    await logOAuthFailed("google", e);
    // Raw error is LOGGED (console + oauth_failed meta), never displayed.
    console.warn("[socialAuth] google sign-in failed:", errorMessage(e, "unknown"));
    return {
      status: "failed",
      message: "Couldn't sign in with Google. Try again.",
    };
  }
}
