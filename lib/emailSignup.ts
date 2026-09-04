// lib/emailSignup.ts
// The email sign-up sequence, extracted from app/signup.tsx: the AUTH CALLS
// only (create → "already registered" recovery sign-in → auto sign-in). The
// screens map the status to their own routing, and every success then runs
// lib/authSuccess.ts:completeAuthSuccess. Both the legacy signup screen and
// the quiz gate's inline form call this, so there is one place the sequence
// can drift. Messages and detection strings are verbatim from the screen.
import { supabase } from "./supabase";

export const EMAIL_RE = /^\S+@\S+\.\S+$/;

export type EmailSignupValidation = { ok: boolean; emailErr: string; pwErr: string };

export function validateEmailSignup(email: string, password: string): EmailSignupValidation {
  const emailOk = EMAIL_RE.test(email.trim());
  const pwOk = password.trim().length > 0;
  return {
    ok: emailOk && pwOk,
    emailErr: emailOk ? "" : "Enter a valid email.",
    pwErr: pwOk ? "" : "Password is required.",
  };
}

/** Supabase's "this email exists" wording (three variants seen in prod). */
export function isAlreadyRegisteredMessage(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("already registered") || m.includes("already been registered") || m.includes("user already exists");
}

export type EmailSignupResult =
  /** New sign-up (or, with enumeration protection, an existing email that
   *  signUp() silently accepted): signed in. isNewAccount decides sign_up
   *  vs sign_in downstream. */
  | { status: "created"; userId: string | null; isNewAccount: boolean }
  /** The email existed and these credentials signed in (the half-created
   *  account recovery). Treat as a returning rider. */
  | { status: "recovered"; userId: string | null }
  /** The email existed and the password did not match: send to login. */
  | { status: "exists_wrong_password" }
  /** Account created but the automatic sign-in failed: send to login. */
  | { status: "created_signin_failed" }
  | { status: "error"; message: string };

export async function signUpWithEmail(emailRaw: string, passwordRaw: string): Promise<EmailSignupResult> {
  const email = emailRaw.trim();
  const password = passwordRaw.trim();
  try {
    // 1) Create the account
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password });

    if (signUpErr) {
      if (isAlreadyRegisteredMessage(signUpErr.message)) {
        // Attempt to recover: sign in with these credentials
        const { data: recoveryData, error: recoveryErr } = await supabase.auth.signInWithPassword({ email, password });
        if (recoveryErr) return { status: "exists_wrong_password" };
        return { status: "recovered", userId: recoveryData?.user?.id ?? null };
      }
      return { status: "error", message: signUpErr.message || "Failed to sign up" };
    }

    // 2) Immediately sign them in (no email verification required for now)
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) return { status: "created_signin_failed" };

    // Enumeration protection (email confirmation disabled) can make signUp()
    // return no error for an EXISTING email, with an empty identities[]. That
    // is a sign-in, not a new account — so sign_up only fires when identities
    // is non-empty (genuinely new); otherwise log sign_in.
    const isNewAccount =
      !Array.isArray(signUpData?.user?.identities) || (signUpData?.user?.identities?.length ?? 0) > 0;
    return { status: "created", userId: signInData?.user?.id ?? null, isNewAccount };
  } catch (e: any) {
    return { status: "error", message: typeof e?.message === "string" && e.message ? e.message : "Failed to sign up" };
  }
}
