// lib/paywallDecliner.ts
// Pure derivations for the paywall-decliner recovery flow, extracted from
// app/(tabs)/index.tsx and app/premium.tsx for unit testing. Extraction only
// — behavior is identical to the inline versions.

import type { OnboardingStep } from "./onboarding";

/**
 * Paywall decliner: finished the funnel (signup, bike, generated tune) but
 * dismissed the paywall — persisted onboarding state parked at "trial".
 * Must be reactive to conversion, never cached for the session: callers pass
 * live provider state, focus-refreshed pro status, and the session purchase
 * flag so the banner disappears the moment any of them flips.
 */
export function deriveIsPaywallDecliner(args: {
  hydrated: boolean;
  onboardingStep: OnboardingStep;
  onboardingComplete: boolean;
  isPro: boolean;
  purchasedThisSession: boolean;
}): boolean {
  return (
    args.hydrated &&
    args.onboardingStep === "trial" &&
    !args.onboardingComplete &&
    !args.isPro &&
    !args.purchasedThisSession
  );
}

export const DECLINER_RESUME_MIN_MINUTES = 5;

/**
 * decliner_converted gate. EVERY purchase passes through the trial step
 * (signup sets it minutes before the day-0 paywall), so "prior state was
 * trial" alone would count normal funnel conversions too. The codebase's
 * established >=5-minute resume heuristic separates a decliner who came back
 * from a straight-through day-0 purchase.
 */
export function shouldLogDeclinerConversion(
  onboardingStep: OnboardingStep | string,
  ageMinutesSinceLastStep: number
): boolean {
  return (
    onboardingStep === "trial" &&
    ageMinutesSinceLastStep >= DECLINER_RESUME_MIN_MINUTES
  );
}
