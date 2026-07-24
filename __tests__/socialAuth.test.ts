// Provider-flow coverage for lib/socialAuth.ts: success, cancel/dismiss,
// failure, and the auto-link collision path (existing email account →
// isNewAccount=false) for both Apple and Google. The native SDKs are the
// stubs in __tests__/stubs/ (see jest.config.js moduleNameMapper).
const signInWithIdToken = jest.fn();
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...args: any[]) => signInWithIdToken(...args),
    },
  },
}));

const logEvent = jest.fn(async (..._args: any[]) => {});
jest.mock("../lib/usage", () => ({
  logEvent: (...args: any[]) => logEvent(...args),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        GOOGLE_WEB_CLIENT_ID: "web-id.apps.googleusercontent.com",
        GOOGLE_IOS_CLIENT_ID: "ios-id.apps.googleusercontent.com",
      },
    },
  },
}));

/* eslint-disable import/first -- these imports must follow the jest.mock
   factories above: the factories close over the mock fns (TDZ otherwise). */
// require() (not import *) — the ESM namespace wraps CJS exports in getters,
// but the tests must mutate the SAME module object lib/socialAuth.ts holds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppleAuth = require("expo-apple-authentication");
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  isNewOAuthUser,
  signInWithApple,
  signInWithGoogle,
} from "../lib/socialAuth";

const NOW = "2026-07-24T10:00:00.000Z";
const newUser = {
  id: "user-new",
  created_at: NOW,
  last_sign_in_at: "2026-07-24T10:00:12.000Z",
};
const linkedUser = {
  id: "user-existing",
  created_at: "2025-09-16T08:00:00.000Z",
  last_sign_in_at: NOW,
};

beforeEach(() => {
  jest.clearAllMocks();
  signInWithIdToken.mockResolvedValue({ data: { user: newUser }, error: null });
});

describe("isNewOAuthUser (created_at ≈ last_sign_in_at)", () => {
  test("first sign-in (timestamps within a minute) → new", () => {
    expect(isNewOAuthUser(newUser)).toBe(true);
  });
  test("auto-linked existing account (old created_at) → returning", () => {
    expect(isNewOAuthUser(linkedUser)).toBe(false);
  });
  test("missing timestamps → returning (safe default)", () => {
    expect(isNewOAuthUser(null)).toBe(false);
    expect(isNewOAuthUser({ created_at: NOW })).toBe(false);
  });
});

describe("availability gates", () => {
  test("Apple available on iOS with module + capability", async () => {
    await expect(isAppleSignInAvailable()).resolves.toBe(true);
  });
  test("Google available with module + web client id", () => {
    expect(isGoogleSignInAvailable()).toBe(true);
  });
});

describe("Apple sign-in", () => {
  test("success: hashed nonce to Apple, raw nonce to Supabase, name captured", async () => {
    const signInAsync = jest.fn(async () => ({
      identityToken: "apple-jwt",
      fullName: { givenName: "Eli", familyName: "Tomac" },
    }));
    (AppleAuth as any).signInAsync = signInAsync;

    const result = await signInWithApple();

    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      nonce: "sha256:raw-nonce-uuid",
    });
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "apple-jwt",
      nonce: "raw-nonce-uuid",
    });
    expect(result).toEqual({
      status: "success",
      userId: "user-new",
      isNewAccount: true,
      displayName: "Eli Tomac",
    });
    expect(logEvent).toHaveBeenCalledWith("oauth_started", { provider: "apple" });
    expect(logEvent).not.toHaveBeenCalledWith("oauth_failed", expect.anything());
  });

  test("relay/returning authorization without a name → displayName null", async () => {
    (AppleAuth as any).signInAsync = jest.fn(async () => ({
      identityToken: "apple-jwt",
      fullName: null,
    }));

    const result = await signInWithApple();
    expect(result).toMatchObject({ status: "success", displayName: null });
  });

  test("cancel: sheet dismissed → cancelled, no Supabase call, no oauth_failed", async () => {
    (AppleAuth as any).signInAsync = jest.fn(async () => {
      throw { code: "ERR_REQUEST_CANCELED" };
    });

    const result = await signInWithApple();

    expect(result).toEqual({ status: "cancelled" });
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalledWith("oauth_failed", expect.anything());
  });

  test("collision auto-link: existing email account → isNewAccount=false", async () => {
    (AppleAuth as any).signInAsync = jest.fn(async () => ({
      identityToken: "apple-jwt",
      fullName: { givenName: "Eli", familyName: "Tomac" },
    }));
    signInWithIdToken.mockResolvedValue({
      data: { user: linkedUser },
      error: null,
    });

    const result = await signInWithApple();
    expect(result).toMatchObject({
      status: "success",
      userId: "user-existing",
      isNewAccount: false,
    });
  });

  test("Supabase rejection → failed + oauth_failed", async () => {
    (AppleAuth as any).signInAsync = jest.fn(async () => ({
      identityToken: "apple-jwt",
      fullName: null,
    }));
    signInWithIdToken.mockResolvedValue({
      data: null,
      error: new Error("Invalid id token"),
    });

    const result = await signInWithApple();

    expect(result).toEqual({ status: "failed", message: "Invalid id token" });
    expect(logEvent).toHaveBeenCalledWith("oauth_failed", {
      provider: "apple",
      code: null,
      message: "Invalid id token",
    });
  });

  test("missing identity token → failed + oauth_failed", async () => {
    (AppleAuth as any).signInAsync = jest.fn(async () => ({
      identityToken: null,
      fullName: null,
    }));

    const result = await signInWithApple();
    expect(result).toMatchObject({ status: "failed" });
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "oauth_failed",
      expect.objectContaining({ provider: "apple" })
    );
  });
});

describe("Google sign-in", () => {
  test("success: id token to Supabase (no nonce), name captured", async () => {
    (GoogleSignin as any).signIn = jest.fn(async () => ({
      type: "success",
      data: { idToken: "google-jwt", user: { name: "Jett Lawrence" } },
    }));

    const result = await signInWithGoogle();

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-jwt",
    });
    expect(result).toEqual({
      status: "success",
      userId: "user-new",
      isNewAccount: true,
      displayName: "Jett Lawrence",
    });
    expect(logEvent).toHaveBeenCalledWith("oauth_started", {
      provider: "google",
    });
  });

  test("cancel (v13+ resolved shape) → cancelled, no Supabase call", async () => {
    (GoogleSignin as any).signIn = jest.fn(async () => ({
      type: "cancelled",
      data: null,
    }));

    const result = await signInWithGoogle();

    expect(result).toEqual({ status: "cancelled" });
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalledWith("oauth_failed", expect.anything());
  });

  test("cancel (legacy rejected shape) → cancelled", async () => {
    (GoogleSignin as any).signIn = jest.fn(async () => {
      throw { code: "SIGN_IN_CANCELLED" };
    });

    const result = await signInWithGoogle();
    expect(result).toEqual({ status: "cancelled" });
    expect(logEvent).not.toHaveBeenCalledWith("oauth_failed", expect.anything());
  });

  test("collision auto-link: existing email account → isNewAccount=false", async () => {
    (GoogleSignin as any).signIn = jest.fn(async () => ({
      type: "success",
      data: { idToken: "google-jwt", user: { name: "Jett Lawrence" } },
    }));
    signInWithIdToken.mockResolvedValue({
      data: { user: linkedUser },
      error: null,
    });

    const result = await signInWithGoogle();
    expect(result).toMatchObject({
      status: "success",
      userId: "user-existing",
      isNewAccount: false,
    });
  });

  test("missing id token → failed + oauth_failed", async () => {
    (GoogleSignin as any).signIn = jest.fn(async () => ({
      type: "success",
      data: { idToken: null, user: {} },
    }));

    const result = await signInWithGoogle();
    expect(result).toMatchObject({ status: "failed" });
    expect(logEvent).toHaveBeenCalledWith(
      "oauth_failed",
      expect.objectContaining({ provider: "google" })
    );
  });
});
