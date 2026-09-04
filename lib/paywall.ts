// lib/paywall.ts
// One way to open the trial paywall. Every entry carries the Pro action that
// summoned it (paywall_trigger_action in every paywall event) so the
// action-gated world can be compared with the shipped interstitial one from
// day one. Position itself is stamped centrally (lib/usage.ts).
/** Set the first time ANY paywall presents on this device. In the
 *  action-gated world the cold-start TrialPromptModal waits for it, so the
 *  first paywall a rider sees is always summoned by a Pro action. */
export const PAYWALL_SEEN_KEY = "dialed_paywall_seen_v1";

export type PaywallTrigger =
  | "onboarding_interstitial" // the funnel's auto-present (/premium at step "trial")
  | "refine" // Tune Two submit (refine after ride)
  | "setup_history"
  | "second_bike"
  | "second_setup"
  | "second_tune" // free baseline credit used, another tune requested
  | "save_baseline_limit"
  | "save_refinement_limit"
  | "save_preset"
  | "sessions_tab"
  | "home_decliner_banner"
  | "trial_prompt_modal"
  | "trial_moment_card"
  | "winback_fallback"
  | "tune_tab_locked"
  | "quiz_reveal_locked" // interstitial world: reveal declined, CTA re-opens
  // Conversion model gate placements (lib/placements.ts): the ride-day loop
  // and tire pressure. "history" aliases setup_history for the placement id.
  | "log_moto"
  | "adjust"
  | "tire_pressure"
  | "history"
  | "unspecified";

/** "/premium?trigger=…[&returnTo=…]". returnTo "back" pops the paywall
 *  screen instead of replacing to a route (action-gated triggers return to
 *  the screen that summoned them). */
export function paywallHref(trigger: PaywallTrigger, returnTo?: string): string {
  const q = new URLSearchParams();
  q.set("trigger", trigger);
  if (returnTo) q.set("returnTo", returnTo);
  return `/premium?${q.toString()}`;
}

export function parsePaywallTrigger(v: unknown): PaywallTrigger {
  const known: PaywallTrigger[] = [
    "onboarding_interstitial",
    "refine",
    "setup_history",
    "second_bike",
    "second_setup",
    "second_tune",
    "save_baseline_limit",
    "save_refinement_limit",
    "save_preset",
    "sessions_tab",
    "home_decliner_banner",
    "trial_prompt_modal",
    "trial_moment_card",
    "winback_fallback",
    "tune_tab_locked",
    "quiz_reveal_locked",
    "log_moto",
    "adjust",
    "tire_pressure",
    "history",
  ];
  return typeof v === "string" && (known as string[]).includes(v)
    ? (v as PaywallTrigger)
    : "unspecified";
}
