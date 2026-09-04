// lib/featureFlags.ts
// Build-time feature flags. EXPO_PUBLIC_* values are inlined by Metro at
// bundle time, so flipping one needs a metro restart (dev) or a new build
// (store). Keep every flag default-OFF so an unset env reproduces the
// shipped behavior.

/**
 * Quiz onboarding (the 3.0 first-run experience, feat/quiz-onboarding).
 * ON: the intro's "Get Started" and cold-start resumes at the garage_locked /
 * tune steps route into /quiz instead of the garage sheet + Tune tab. The
 * underlying onboarding state machine is unchanged either way.
 * OFF (default): the shipped garage → tune → locked-results flow.
 */
export const QUIZ_ONBOARDING_ENABLED =
  process.env.EXPO_PUBLIC_QUIZ_ONBOARDING === "1";
