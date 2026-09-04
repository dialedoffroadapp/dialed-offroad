// lib/proGate.ts
// The Pro gate: an imperative sheet shown BEFORE the paywall whenever a free
// rider attempts a Pro action. It names the action, shows the Pro set in the
// locked-row pattern, and ALWAYS offers the free alternative ("Update my
// baseline instead") when the rider has a bike with a baseline. Replaces the
// retired "Free tune already used" toast / card. Any screen calls
// showProGate(); components/v3/ProGateSheet.tsx renders it from the root
// layout. paywall_trigger_action flows into the paywall via paywallHref.
import { isEntitled, resolveEntitlement } from "./entitlement";
import { paywallHref, type PaywallTrigger } from "./paywall";
import { gateTriggerFor } from "./placements";

export type ProGateRequest = {
  trigger: PaywallTrigger;
  /** The bike in play (history, second setup, refine). Resolves the
   *  alternative; absent = the gate looks up any bike with a baseline. */
  bikeId?: string | null;
  /** Caller already knows whether a baseline exists (skips the lookup). */
  hasBaseline?: boolean;
  /** Called when the rider taps "Not now" (e.g. screens that must go back). */
  onDismiss?: () => void;
};

export type ProAction = { title: string; row: string; eyebrow: string };

/** Copy per trigger: the action being attempted, in the rider's words. */
export const PRO_ACTIONS: Partial<Record<PaywallTrigger, ProAction>> = {
  refine: { title: "Refine after ride", row: "Refine after ride", eyebrow: "Pro" },
  setup_history: { title: "Setup history", row: "Setup history", eyebrow: "Pro" },
  second_setup: { title: "A second setup", row: "Multiple setups per bike", eyebrow: "Pro" },
  second_bike: { title: "A second bike", row: "Multiple bikes", eyebrow: "Pro" },
  second_tune: { title: "Another baseline", row: "Unlimited baselines", eyebrow: "Pro" },
  save_preset: { title: "Save a preset", row: "Presets", eyebrow: "Pro" },
  save_baseline_limit: { title: "More saved baselines", row: "Unlimited history", eyebrow: "Pro" },
  save_refinement_limit: { title: "More saved setups", row: "Unlimited history", eyebrow: "Pro" },
  tune_tab_locked: { title: "Your tune", row: "Your tune", eyebrow: "Pro" },
};

/** The four Pro gates of the reveal-first model, in the order the sheet lists them. */
export const PRO_SET: { trigger: PaywallTrigger; label: string }[] = [
  { trigger: "refine", label: "Refine after ride" },
  { trigger: "setup_history", label: "Setup history" },
  { trigger: "second_setup", label: "A second setup" },
  { trigger: "second_bike", label: "A second bike" },
];

export function proActionFor(trigger: PaywallTrigger): ProAction {
  return PRO_ACTIONS[trigger] ?? { title: "That one's Pro", row: "Pro", eyebrow: "Pro" };
}

/** What stays free, stated plainly under the rows. */
export const FREE_LINE = "Free keeps your bike, one setup, its current numbers, and a fresh baseline whenever you want one.";

/** Gate helper: resolves entitlement (server, cached fallback) and shows
 *  the gate ONLY in the free state (playbook §2: the paywall fires at the
 *  first Pro tap, never during the trial). Returns true when the action may
 *  proceed. */
export async function gateIfLocked(req: ProGateRequest): Promise<boolean> {
  const e = await resolveEntitlement();
  if (isEntitled(e)) return true;
  showProGate(req);
  return false;
}

export function pricingHref(trigger: PaywallTrigger): string {
  return `/pricing?trigger=${encodeURIComponent(gateTriggerFor(trigger))}`;
}

export function regenerateHref(bikeId: string): string {
  return `/(tabs)/tune?bikeId=${encodeURIComponent(bikeId)}&regenerate=1`;
}

export function paywallHrefFor(req: ProGateRequest): string {
  return paywallHref(req.trigger, "back");
}

/* ---------------------------- imperative store --------------------------- */

type Listener = (req: ProGateRequest | null) => void;
const listeners = new Set<Listener>();
let current: ProGateRequest | null = null;

export function showProGate(req: ProGateRequest): void {
  current = req;
  listeners.forEach((l) => l(current));
}

export function hideProGate(): void {
  current = null;
  listeners.forEach((l) => l(null));
}

export function subscribeProGate(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => {
    listeners.delete(l);
  };
}

export function currentProGate(): ProGateRequest | null {
  return current;
}
