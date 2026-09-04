// lib/onboardingCompletion.ts
// The ONE "onboarding is done" sequence, extracted from app/premium.tsx's
// handleOnboardingSuccess so both paywall positions (lib/paywallPosition.ts)
// complete identically:
//   interstitial  → runs on paywall success (viaPaywall: true, as shipped)
//   action_gated  → runs right after signup (viaPaywall: false), before the
//                   reveal; the paywall comes later, on the first Pro action
// Order (unchanged from the pre-extraction code): trial-started event +
// decliner-conversion check (paywall path only) → completeOnboarding →
// profile upsert → auto-baseline v1 from the pending tune → ride reminder →
// onboarding_completed → funnel id cleared (unless the funnel continues on a
// quiz screen, which clears it itself at "Set it on the bike").
import { autoCreateBaselineFromPendingTune, type AutoBaselineResult } from "./autoBaseline";
import { readPendingTune, type OnboardingStep } from "./onboarding";
import { shouldLogDeclinerConversion } from "./paywallDecliner";
import { scheduleRideReminder } from "./rideReminder";
import { supabase } from "./supabase";
import { clearFunnelId, getOrCreateFunnelId, logEvent } from "./usage";

export type CompletionParams = {
  /** OnboardingProvider's completeOnboarding (dual-writes local + profile). */
  completeOnboarding: () => Promise<unknown>;
  onboardingStep: OnboardingStep;
  accountCreated: boolean;
  trialStarted: boolean;
  ageMinutesSinceLastStep: number;
  sourceRoute: string;
  /** True on the paywall-success path: logs onboarding_trial_started and the
   *  decliner-conversion metric exactly as the shipped interstitial did. */
  viaPaywall: boolean;
  /** Post-completion destination when a pending tune exists. Default keeps
   *  the shipped "/tune-results". */
  returnTo?: string;
  /** Extra meta for the completion events (paywall trigger, quiz markers). */
  extraMeta?: Record<string, unknown>;
};

export type CompletionResult = {
  target: string;
  pendingExists: boolean;
  autoBaseline: AutoBaselineResult | null;
};

export async function completeOnboardingSequence(
  p: CompletionParams
): Promise<CompletionResult> {
  const funnelId = await getOrCreateFunnelId();
  const extra = p.extraMeta ?? {};
  const resume = p.ageMinutesSinceLastStep >= 5;

  if (p.viaPaywall) {
    await logEvent("onboarding_trial_started", {
      funnel_id: funnelId,
      onboarding_step: p.onboardingStep,
      signed_in: true,
      account_created: p.accountCreated,
      trial_started: true,
      onboarding_complete: false,
      pending_tune_exists: !!(await readPendingTune()).tune,
      resume,
      age_minutes_since_last_step: p.ageMinutesSinceLastStep,
      source_route: p.sourceRoute,
      ...extra,
    });

    // Recovery-funnel metric. EVERY interstitial purchase passes through the
    // trial step (signup sets it minutes before the day-0 paywall), so
    // "prior state was trial" alone would count normal funnel conversions
    // too — the >=5min resume gate inside shouldLogDeclinerConversion
    // separates a decliner who came back from a straight-through purchase.
    if (shouldLogDeclinerConversion(p.onboardingStep, p.ageMinutesSinceLastStep)) {
      void logEvent("decliner_converted", {
        funnel_id: funnelId,
        age_minutes_since_last_step: p.ageMinutesSinceLastStep,
        ...extra,
      });
    }
  }

  await p.completeOnboarding();
  const { data: authData } = await supabase.auth.getUser();
  if (authData?.user?.id) {
    await supabase.from("profiles").upsert(
      {
        user_id: authData.user.id,
        onboarding_complete: true,
        onboarding_step: "complete",
      },
      { onConflict: "user_id" }
    );
  }
  const { tune: pending } = await readPendingTune();

  // Auto-save the onboarding tune as v1 so Home's ActiveSetupCard, the tune
  // tab's RunningSetupRow, and Bike Home all render real state on Day 1
  // without the rider having to tap "Save Setup". Returns null on any
  // failure/skip — never blocks completion. The manual Save button stays
  // idempotent against this row (tune-results.tsx).
  const autoBaseline = await autoCreateBaselineFromPendingTune();
  if (autoBaseline) {
    // No-op unless notification permission is already granted — for a
    // brand-new user the inline ask on the results screen grants and
    // schedules instead.
    void scheduleRideReminder({
      versionId: autoBaseline.version.id,
      versionNumber: autoBaseline.version.version_number,
      bikeName: autoBaseline.bikeTitle,
    });
  }

  await logEvent("onboarding_completed", {
    funnel_id: funnelId,
    onboarding_step: "complete",
    signed_in: true,
    account_created: true,
    trial_started: p.viaPaywall,
    onboarding_complete: true,
    pending_tune_exists: !!pending,
    resume,
    age_minutes_since_last_step: p.ageMinutesSinceLastStep,
    source_route: p.sourceRoute,
    ...extra,
  });

  const target = pending ? p.returnTo ?? "/tune-results" : "/(tabs)";
  // A quiz destination keeps the funnel alive for quiz_reveal_viewed; the
  // reveal's CTA clears the id (app/quiz/reveal.tsx). Everything else ends
  // the funnel here, exactly as shipped.
  if (!target.startsWith("/quiz")) await clearFunnelId();

  return { target, pendingExists: !!pending, autoBaseline };
}
