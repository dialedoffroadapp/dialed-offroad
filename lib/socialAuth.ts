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

/** require() guard — returns null when the module isn't in this binary. */
function loadModule(name: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name);
  } catch {
    return null;
  }
}

let appleAuthModule: any | null | undefined;
function getAppleAuth(): any | null {
  if (appleAuthModule === undefined) {
    appleAuthModule = loadModule("expo-apple-authentication");
  }
  return appleAuthModule;
}

let cryptoModule: any | null | undefined;
function getCrypto(): any | null {
  if (cryptoModule === undefined) {
    cryptoModule = loadModule("expo-crypto");
  }
  return cryptoModule;
}

let googleModule: any | null | undefined;
function getGoogleSignin(): any | null {
  if (googleModule === undefined) {
    googleModule = loadModule("@react-native-google-signin/google-signin");
  }
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
    return {
      status: "failed",
      message: errorMessage(e, "Apple sign-in failed. Please try again."),
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
    return {
      status: "failed",
      message: errorMessage(e, "Google sign-in failed. Please try again."),
    };
  }
}
