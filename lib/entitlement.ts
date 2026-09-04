// lib/entitlement.ts
// Client side of the entitlement state machine (migration 20260904150000):
//   trial_active → free → pro, with pro (RevenueCat, via the webhook into
//   profiles.is_pro / pro_until) layered on top and always winning.
// Server is the source of truth (resolve_entitlement RPC, which also applies
// the trial → free transition); the client caches the last answer so gates
// work offline and on the very first render. Reverse trial per the
// conversion playbook (§4, Details): usage-anchored, no card, downgrade not
// lockout. Nothing here touches RevenueCat entitlement logic.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hasPurchasedThisSession } from "./purchases";
import { getConfigNumber } from "./remoteConfig";
import { supabase } from "./supabase";
import { logEvent } from "./usage";

export type EntitlementState = "trial_active" | "free" | "pro";

export type Entitlement = {
  state: EntitlementState;
  /** Ride days counted so far toward the trial limit. */
  trialRideDays: number;
  trialRideDayLimit: number;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialEndReason: "ride_days" | "clock" | "purchase" | null;
  downgradedAt: string | null;
  proUntil: string | null;
  /** The resolver flipped trial → free on this call. */
  justEnded: boolean;
  resolvedAt: string;
};

const CACHE_KEY = "dialed_entitlement_v1";

export const FREE_ENTITLEMENT: Entitlement = {
  state: "free",
  trialRideDays: 0,
  trialRideDayLimit: 3,
  trialStartedAt: null,
  trialEndsAt: null,
  trialEndReason: null,
  downgradedAt: null,
  proUntil: null,
  justEnded: false,
  resolvedAt: new Date(0).toISOString(),
};

let current: Entitlement | null = null;
const listeners = new Set<(e: Entitlement) => void>();

export function subscribeEntitlement(l: (e: Entitlement) => void): () => void {
  listeners.add(l);
  if (current) l(current);
  return () => {
    listeners.delete(l);
  };
}

function emit(e: Entitlement) {
  current = e;
  listeners.forEach((l) => l(e));
}

function fromRpc(raw: any, prev: Entitlement | null): Entitlement {
  const state: EntitlementState = raw?.state === "trial_active" || raw?.state === "pro" ? raw.state : "free";
  return {
    state,
    trialRideDays: typeof raw?.trial_ride_days === "number" ? raw.trial_ride_days : prev?.trialRideDays ?? 0,
    trialRideDayLimit: typeof raw?.trial_ride_day_limit === "number" ? raw.trial_ride_day_limit : prev?.trialRideDayLimit ?? getConfigNumber("trial_ride_days"),
    trialStartedAt: raw?.trial_started_at ?? prev?.trialStartedAt ?? null,
    trialEndsAt: raw?.trial_ends_at ?? prev?.trialEndsAt ?? null,
    trialEndReason: raw?.trial_end_reason ?? prev?.trialEndReason ?? null,
    downgradedAt: raw?.downgraded_at ?? prev?.downgradedAt ?? null,
    proUntil: raw?.pro_until ?? null,
    justEnded: !!raw?.just_ended,
    resolvedAt: new Date().toISOString(),
  };
}

export async function readCachedEntitlement(): Promise<Entitlement> {
  if (current) return current;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = { ...FREE_ENTITLEMENT, ...(JSON.parse(raw) as Partial<Entitlement>), justEnded: false };
      current = parsed;
      return parsed;
    }
  } catch {
    // fall through
  }
  return FREE_ENTITLEMENT;
}

/** Server resolve (applies transitions) with cache fallback. Logs the
 *  trial_ended / downgraded pair when the server just flipped the state. */
export async function resolveEntitlement(): Promise<Entitlement> {
  const prev = await readCachedEntitlement();
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return prev;
    const { data, error } = await supabase.rpc("resolve_entitlement").single();
    if (error || !data) return prev;
    const next = fromRpc(data, prev);
    if (next.justEnded) {
      void logEvent("trial_ended", { reason: next.trialEndReason, ride_days: next.trialRideDays });
      void logEvent("downgraded", { from: "trial_active" });
    }
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    emit(next);
    return next;
  } catch {
    return prev;
  }
}

/** Start the reverse trial (idempotent server-side). reason: "reveal" for a
 *  new account at the tune reveal, "launch_3_0" for an existing free account
 *  on its first open after launch. */
export async function startReverseTrial(reason: "reveal" | "launch_3_0" | "manual"): Promise<Entitlement> {
  const prev = await readCachedEntitlement();
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return prev;
    const { data, error } = await supabase.rpc("start_reverse_trial", { p_reason: reason }).single();
    if (error || !data) return prev;
    const raw = data as any;
    if (raw.started) {
      void logEvent("trial_started", { reason, ride_day_limit: raw.trial_ride_day_limit, ends_at: raw.trial_ends_at });
    }
    return resolveEntitlement();
  } catch {
    return prev;
  }
}

/** Gates: trial_active and pro both pass; a purchase this session passes
 *  before the webhook/profile catch up. */
export function isEntitled(e: Entitlement | null | undefined): boolean {
  if (hasPurchasedThisSession()) return true;
  return e?.state === "trial_active" || e?.state === "pro";
}

export function trialRidesLeft(e: Entitlement): number {
  return Math.max(0, e.trialRideDayLimit - e.trialRideDays);
}

export function trialDaysLeft(e: Entitlement, now = Date.now()): number | null {
  if (!e.trialEndsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(e.trialEndsAt) - now) / 86400000));
}

/** "Near the end": last trial ride or ≤ 3 days (playbook §5: convert at real
 *  ride moments; loss-framed near trial end). */
export function trialNearEnd(e: Entitlement, now = Date.now()): boolean {
  if (e.state !== "trial_active") return false;
  const days = trialDaysLeft(e, now);
  return trialRidesLeft(e) <= 1 || (days !== null && days <= 3);
}

/** Home's trial line: "Pro on for your next N rides, or D days" (D shown
 *  only inside the last week). null outside the trial. */
export function trialLine(e: Entitlement, now = Date.now()): string | null {
  if (e.state !== "trial_active") return null;
  const rides = trialRidesLeft(e);
  const days = trialDaysLeft(e, now);
  const ridePart = rides === 1 ? "your next ride" : `your next ${rides} rides`;
  return days !== null && days <= 7 ? `Pro on for ${ridePart}, or ${days} ${days === 1 ? "day" : "days"}` : `Pro on for ${ridePart}`;
}

/** Existing free accounts enter the trial once on first open after launch
 *  (River: "Pro is on for your next 3 rides"). Latched per account locally;
 *  the RPC is idempotent anyway. */
const LAUNCH_LATCH = "dialed_launch_3_0_trial_v1";
export async function maybeStartLaunchTrial(userId: string): Promise<Entitlement | null> {
  try {
    const key = `${LAUNCH_LATCH}:${userId}`;
    if (await AsyncStorage.getItem(key)) return null;
    const e = await resolveEntitlement();
    if (e.state === "free" && !e.trialStartedAt) {
      const started = await startReverseTrial("launch_3_0");
      await AsyncStorage.setItem(key, "1");
      return started;
    }
    await AsyncStorage.setItem(key, "1");
    return null;
  } catch {
    return null;
  }
}

/** Tests only. */
export function __setEntitlementForTests(e: Entitlement | null): void {
  current = e;
}
