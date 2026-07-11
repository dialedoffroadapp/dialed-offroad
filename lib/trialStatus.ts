// lib/trialStatus.ts
// Client-side trial awareness from RevenueCat: is the user inside their free
// trial, and how many days remain? Until now trial expiry was invisible —
// day 6 looked exactly like day 1.
//
// Source of truth: the active `pro` entitlement's periodType ("TRIAL" during
// an intro trial) + expirationDate. willRenew distinguishes users on track to
// auto-convert (leave them alone) from those who disabled auto-renew (the
// 48.8% bail cohort the trial reminder targets).

import { getCustomerInfo, isWeb } from "./purchases";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Product trial length — used only as a sanity clamp for sandbox/clock skew. */
export const TRIAL_LENGTH_DAYS = 7;

export type TrialStatus = {
  isInTrial: boolean;
  /** Whole days until expiry (ceil), only meaningful while isInTrial. */
  daysRemaining: number | null;
  /** ISO string; null when there is no dated entitlement (incl. lifetime). */
  expirationDate: string | null;
  /** Auto-renew state from RevenueCat; null when unknown / no entitlement. */
  willRenew: boolean | null;
};

export const NOT_IN_TRIAL: TrialStatus = {
  isInTrial: false,
  daysRemaining: null,
  expirationDate: null,
  willRenew: null,
};

type EntitlementLike = {
  periodType?: string | null;
  expirationDate?: string | null;
  willRenew?: boolean | null;
} | null | undefined;

/**
 * Pure core (unit-tested): derive trial status from an entitlement snapshot.
 * Handles: no entitlement, lifetime pro (null expiration → never a trial),
 * expired trials, unparseable dates, and sandbox weirdness (sandbox trials
 * are minutes long → ceil gives 1 day; anything beyond the product's trial
 * length is clock skew and clamps down).
 */
export function deriveTrialStatus(
  ent: EntitlementLike,
  nowMs: number
): TrialStatus {
  if (!ent) return NOT_IN_TRIAL;

  const expirationDate = ent.expirationDate ?? null;
  const willRenew = typeof ent.willRenew === "boolean" ? ent.willRenew : null;

  if (ent.periodType !== "TRIAL" || !expirationDate) {
    return { isInTrial: false, daysRemaining: null, expirationDate, willRenew };
  }

  const expMs = new Date(expirationDate).getTime();
  if (!Number.isFinite(expMs)) {
    return { isInTrial: false, daysRemaining: null, expirationDate: null, willRenew };
  }

  const msLeft = expMs - nowMs;
  if (msLeft <= 0) {
    // Expired trial entitlement still in the cache — treat as not in trial.
    return { isInTrial: false, daysRemaining: 0, expirationDate, willRenew };
  }

  let daysRemaining = Math.ceil(msLeft / MS_PER_DAY);
  if (daysRemaining > TRIAL_LENGTH_DAYS) daysRemaining = TRIAL_LENGTH_DAYS;

  return { isInTrial: true, daysRemaining, expirationDate, willRenew };
}

/**
 * Which trial-moment card (if any) should Home render? Countdown always
 * beats the day-2 value card; the two must never show together.
 */
export type TrialCardKind = "countdown" | "value" | null;

export function pickTrialCard(args: {
  isInTrial: boolean;
  daysRemaining: number | null;
  /** Whole days since account creation; null when unknown. */
  accountAgeDays: number | null;
  /** They have at least one generated tune (setup version). */
  hasTune: boolean;
  valueCardDismissed: boolean;
}): TrialCardKind {
  if (!args.isInTrial) return null;
  if (args.daysRemaining !== null && args.daysRemaining <= 2) return "countdown";
  if (
    !args.valueCardDismissed &&
    args.hasTune &&
    args.accountAgeDays !== null &&
    args.accountAgeDays >= 1 &&
    args.accountAgeDays <= 3
  ) {
    return "value";
  }
  return null;
}

// ── Session cache with focus refresh ──
let cached: TrialStatus | null = null;

export async function getTrialStatus(opts?: {
  /** Bypass the session cache (focus refresh). */
  refresh?: boolean;
}): Promise<TrialStatus> {
  if (isWeb) return NOT_IN_TRIAL;
  if (cached && !opts?.refresh) return cached;
  try {
    const info = await getCustomerInfo();
    const ent: any = info?.entitlements?.active?.pro ?? null;
    cached = deriveTrialStatus(ent, Date.now());
  } catch {
    cached = cached ?? NOT_IN_TRIAL;
  }
  return cached;
}
