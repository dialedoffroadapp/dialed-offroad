// lib/authSuccess.ts
// The ONE post-auth success sequence, extracted verbatim from app/signup.tsx
// so email signup and Apple/Google sign-in land on the identical path:
//
//   profile upsert (3 attempts) → guest-bike migration + pending-tune remap
//   → notify (caller's toast) → sign_up/sign_in event (flushes the pre-auth
//   queue inside logEvent) → onboarding_signup_completed funnel event
//   → markAccountCreated → setStep("trial") → replace("/premium")
//
// Callers own everything provider-specific: establishing the session,
// deciding isNewAccount (email uses the identities[] enumeration-protection
// heuristic, OAuth uses created_at ≈ last_sign_in_at), and the toast copy.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeBikeStrings, resolveModelId } from "./bikes";
import {
  markPendingTuneMigrated,
  PENDING_GUEST_BIKE_SYNC_KEY,
  readPendingTune,
  remapPendingTuneBikeId,
  type OnboardingStep,
} from "./onboarding";
import { supabase } from "./supabase";
import { claimAnonTuneCalls } from "./tuneAttribution";
import { getOrCreateFunnelId, logEvent } from "./usage";

export type SignupMethod = "email" | "apple" | "google";

export type AuthSuccessParams = {
  /** Authenticated user id; null skips the profile/bike writes (matches the
   *  old `if (signInData?.user?.id)` guard). */
  userId: string | null;
  isNewAccount: boolean;
  method: SignupMethod;
  /** Provider-supplied name (Apple sends it on FIRST authorization only).
   *  Written to display_name for NEW accounts only — never overwrites an
   *  existing user's chosen name on auto-link. */
  displayName?: string | null;
  onboardingStep: OnboardingStep;
  onboardingComplete: boolean;
  ageMinutesSinceLastStep: number;
  /** Which screen's profile-write contract to honor. "signup" (default) is
   *  the pre-extraction signup.tsx behavior: always stamp
   *  onboarding_step "trial" / onboarding_complete false. "login" mirrors
   *  app/login.tsx's email path for RETURNING users: never downgrade an
   *  existing profile's onboarding columns — heal row existence only, and
   *  write onboarding_step "trial" solely when the local step is "signup"
   *  (login.tsx's own signup-step branch). New accounts are identical in
   *  both modes. */
  mode?: "signup" | "login";
  /** Caller's success toast, fired at the exact point the pre-extraction
   *  code showed it (after migration, before analytics). */
  notify?: () => void;
  markAccountCreated: () => Promise<unknown>;
  setStep: (step: OnboardingStep) => Promise<unknown>;
  replace: (route: string) => void;
  returnTo: string;
};

export async function completeAuthSuccess(params: AuthSuccessParams): Promise<void> {
  const {
    userId,
    isNewAccount,
    method,
    displayName,
    onboardingStep,
    onboardingComplete,
    ageMinutesSinceLastStep,
    mode = "signup",
    notify,
    markAccountCreated,
    setStep,
    replace,
    returnTo,
  } = params;

  // 3) Ensure a profiles row exists so downstream screens never hit null.
  //    Retry up to 2 times to handle transient RLS/timing issues where the
  //    new session JWT may not be fully propagated yet.
  if (userId) {
    const trimmedName = displayName?.trim();
    // is_pro is server-only (webhook/service role) since 20260710170000
    // — including it would fail the whole upsert on column grants.
    const profilePayload: Record<string, unknown> =
      mode === "login" && !isNewAccount
        ? {
            user_id: userId,
            // Returning user on the login screen: heal-only, exactly like the
            // email path — the ONLY onboarding write email login makes for an
            // existing profile is the signup-step → "trial" advance.
            ...(onboardingStep === "signup" ? { onboarding_step: "trial" } : {}),
          }
        : {
            user_id: userId,
            onboarding_step: "trial",
            onboarding_complete: false,
            // Provider name beats handle_new_user's email-prefix default (which
            // is relay garbage for Apple private-relay signups). New accounts
            // only — auto-linked returning users keep their chosen name.
            ...(isNewAccount && trimmedName ? { display_name: trimmedName } : {}),
          };
    let profileCreated = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: profileErr } = await supabase.from("profiles").upsert(
        profilePayload,
        { onConflict: "user_id", ignoreDuplicates: false }
      );
      if (!profileErr) {
        profileCreated = true;
        break;
      }
      // Brief pause before retry to let the JWT propagate
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
    if (!profileCreated) {
      // Profile creation failed after retries — still route the user forward
      // rather than stranding them. Login will detect the missing profile
      // and create it on next sign-in.
      console.warn("[Signup] profile upsert failed after retries");
    }

    // 4) Migrate guest bike from pending tune into Supabase so hasLegacyUsage
    //    fires correctly on next cold start and the TrialPromptModal can show.
    //    Capture the new uuid and rewrite the pending tune's bike ids with
    //    it — the tune was generated as a guest, so its meta still carries
    //    the LOCAL bike id, which would strand the post-signup refine/save
    //    flow bikeless (no lineage/history).
    // Migration is gated to funnel-exit auths: the signup screen (email or
    // provider, INCLUDING auto-linked collisions — that person just walked
    // the guest funnel holding this device) and any auth that minted a new
    // account. A RETURNING login-screen auth must NOT absorb device-local
    // guest state that may belong to someone else (shipped dup, 2026-07-27:
    // one guest bike migrated into two accounts on the same device).
    const shouldMigrateGuestState = mode === "signup" || isNewAccount;

    let pendingBike: { make: string; model: string; year: number } | null = null;
    try {
      const { tune: pending } = await readPendingTune();
      // One-shot latch: a payload already migrated into ANY account never
      // migrates again — not into a second account (the dup), and not into
      // the same account twice (re-auth after a remap failure). Everything
      // AFTER this block (events, claim, onboarding advance, routing) still
      // runs on every auth.
      if (pending && shouldMigrateGuestState && !pending.migratedForUserId) {
        const metaObj = JSON.parse(decodeURIComponent(pending.meta));
        const bike = metaObj?.bike;
        if (bike?.make && bike?.model && bike?.year) {
          const norm = normalizeBikeStrings(
            String(bike.make),
            String(bike.model)
          );
          pendingBike = {
            make: norm.make,
            model: norm.model,
            year: Number(bike.year),
          };
          const model_id = await resolveModelId(
            pendingBike.make,
            pendingBike.model,
            pendingBike.year
          );
          const { data: insertedBike, error: bikeInsertErr } = await supabase
            .from("bikes")
            .insert({
              user_id: userId,
              ...pendingBike,
              model_id,
            })
            .select("id")
            .single();
          if (bikeInsertErr) throw bikeInsertErr;
          pendingBike = null; // success — no retry needed
          // Latch FIRST (bike row exists now); if the remap below throws,
          // the stash retry is user-bound and re-auth can no longer dup.
          await markPendingTuneMigrated(userId);
          if (insertedBike?.id) {
            await remapPendingTuneBikeId(insertedBike.id);
          }
        }
      }
    } catch {
      // Save for retry on next cold start
      if (pendingBike) {
        try {
          await AsyncStorage.setItem(
            PENDING_GUEST_BIKE_SYNC_KEY,
            JSON.stringify({ ...pendingBike, userId })
          );
        } catch {
          // ignore
        }
      }
    }
  }

  notify?.();

  // WS-C consolidation (v2.3.0 assembly): attribute this device's pre-auth
  // tune_calls rows — server-enforced claim, then id rotation. Every path
  // through here (email signup, Apple/Google on both screens) claims at the
  // same point C's inline call sites used: immediately before the
  // sign_up/sign_in event whose logEvent triggers the pre-auth queue flush.
  // Fail-silent by design. NOTE: login.tsx's email path and signup.tsx's
  // recovery branch do NOT route through this function — they keep direct
  // claim calls.
  await claimAnonTuneCalls();

  await logEvent(isNewAccount ? "sign_up" : "sign_in", { signup_method: method });

  // Funnel completion for ANY new account created during active (incomplete)
  // onboarding — previously gated on step === "signup", which missed signups
  // routed in from the login screen, the guest-tune gate, cold-start resume,
  // and the tune-results fallback. Routing below stays gated on "signup".
  if (isNewAccount && !onboardingComplete) {
    const funnelId = await getOrCreateFunnelId();
    await logEvent("onboarding_signup_completed", {
      funnel_id: funnelId,
      onboarding_step: onboardingStep,
      signed_in: true,
      account_created: true,
      trial_started: false,
      onboarding_complete: false,
      pending_tune_exists: true,
      resume: ageMinutesSinceLastStep >= 5,
      age_minutes_since_last_step: ageMinutesSinceLastStep,
      source_route: "/signup",
      signup_method: method,
    });
  }

  if (onboardingStep === "signup") {
    await markAccountCreated();
    await setStep("trial");
    replace("/premium");
    return;
  }

  // ✅ go to paywall (or whatever returnTo is)
  replace(returnTo);
}
