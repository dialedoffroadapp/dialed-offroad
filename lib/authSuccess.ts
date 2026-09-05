// lib/authSuccess.ts
// The ONE post-auth success sequence, extracted verbatim from app/signup.tsx
// so email signup and Apple/Google sign-in land on the identical path:
//
//   profile upsert (3 attempts) → guest-bike migration + pending-tune remap
//   → notify (caller's toast) → sign_up/sign_in event (flushes the pre-auth
//   queue inside logEvent) → onboarding_signup_completed funnel event
//   → markAccountCreated → setStep("trial") → replace("/premium")
//
// Paywall position (lib/paywallPosition.ts, River 2026-09-02): the tail
// above is the INTERSTITIAL ordering and stays byte-identical. In the
// ACTION-GATED world the same sequence runs, then onboarding completes right
// here (lib/onboardingCompletion.ts) and the rider lands on the reveal; the
// paywall presents later, on the first Pro action.
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
import { completeOnboardingSequence } from "./onboardingCompletion";
import { getPaywallPosition, type PaywallPosition } from "./paywallPosition";
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
  /** Where the trial paywall sits. Defaults to the live remote/cached value
   *  (lib/paywallPosition.ts); tests pin it explicitly. */
  paywallPosition?: PaywallPosition;
  /** Quiz reveal route. Interstitial: handed to /premium as its returnTo so
   *  the paywall lands on the reveal. Action-gated: the post-completion
   *  destination. Absent = the shipped destinations ("/tune-results"). */
  revealRoute?: string;
  /** OnboardingProvider's completeOnboarding — needed by the action-gated
   *  completion. Falls back to setStep("complete") when a caller omits it. */
  completeOnboarding?: () => Promise<unknown>;
  /** Extra meta for the completion events (quiz markers). */
  completionMeta?: Record<string, unknown>;
  /** Login mode only: the rider signing in is this device's guest (the quiz
   *  gate's sign-in link), so migrate the guest bike + pending tune. */
  absorbGuestState?: boolean;
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
    revealRoute,
    completeOnboarding,
    completionMeta,
    absorbGuestState,
  } = params;
  const paywallPosition = params.paywallPosition ?? getPaywallPosition();
  // Signup-mode funnel exits complete onboarding HERE in the action-gated
  // world; the profile row must say so from the first write, or a completion
  // failure would strand the profile at "trial" (= paywall decliner routing).
  const actionGatedFunnelExit =
    paywallPosition === "action_gated" && onboardingStep === "signup";

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
            onboarding_step: actionGatedFunnelExit ? "complete" : "trial",
            onboarding_complete: actionGatedFunnelExit,
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
    // absorbGuestState: the quiz gate's "Have an account? Sign in" (audit item
    // 9). The rider IS the device's guest (they just built the pending tune),
    // so a returning login there must migrate like a signup. A plain login
    // never absorbs device guest state (a different rider's tune).
    const shouldMigrateGuestState = mode === "signup" || isNewAccount || !!absorbGuestState;

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

    if (paywallPosition === "action_gated") {
      // Reveal first. Complete onboarding now (v1 auto-baseline, events);
      // the paywall waits for the first Pro action (lib/paywall.ts).
      const result = await completeOnboardingSequence({
        completeOnboarding: completeOnboarding ?? (() => setStep("complete")),
        onboardingStep,
        accountCreated: true,
        trialStarted: false,
        ageMinutesSinceLastStep,
        sourceRoute: "/signup",
        viaPaywall: false,
        returnTo: revealRoute,
        extraMeta: { signup_method: method, ...(completionMeta ?? {}) },
      });
      replace(result.target);
      return;
    }

    await setStep("trial");
    replace(
      revealRoute
        ? `/premium?returnTo=${encodeURIComponent(revealRoute)}`
        : "/premium"
    );
    return;
  }

  // ✅ go to paywall (or whatever returnTo is)
  replace(returnTo);
}
