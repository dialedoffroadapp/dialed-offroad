// lib/pricing.ts
// Pricing page math (playbook §7): monthly shown first as the anchor, annual
// pre-selected with the discount vs monthly and the per-ride-day framing,
// three tiers (center-stage), lifetime shown late (3+ logged ride days) at a
// config price (currently 129, expected to change; §4 says test higher).
import { getConfigNumber } from "./remoteConfig";

export type Tier = "monthly" | "annual" | "lifetime";

export const DEFAULT_PRICES = { monthly: 7.99, annual: 59.99 } as const;

/** Whole-percent discount of annual vs 12 × monthly. */
export function annualDiscountPct(monthly: number, annual: number): number {
  if (!(monthly > 0) || !(annual > 0)) return 0;
  return Math.max(0, Math.round((1 - annual / (monthly * 12)) * 100));
}

/** "about $1 per ride day" for a ~50-ride-day season (§7). */
export function perRideDayLine(annual: number, rideDaysPerSeason = 50): string {
  const per = annual / rideDaysPerSeason;
  if (per <= 1.25) return "about $1 per ride day";
  return `about $${per.toFixed(2)} per ride day`;
}

/** "$5 a month" monthly-equivalent framing (Mojo +30% trial starts, §7). */
export function monthlyEquivalentLine(annual: number): string {
  return `$${(annual / 12).toFixed(2)} a month, billed once`;
}

export function lifetimeVisible(loggedRideDays: number): boolean {
  return loggedRideDays >= getConfigNumber("lifetime_min_ride_days");
}

export function lifetimeFallbackPrice(): number {
  return getConfigNumber("lifetime_price_usd");
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}
