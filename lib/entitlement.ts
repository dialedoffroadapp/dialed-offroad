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
import { getCustomerInfo, hasPurchasedThisSession, isPro as isProInfo } from "./purchases";
import { deriveIsPro } from "./proUtils";
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
  /** True when this answer came from the server RPC on this call; false for
   *  the cache and for the offline fallbacks (profile flags, RC cache). The
   *  launch-trial latch and any "burn once" logic must key on this. */
  fromServer?: boolean;
};

const CACHE_KEY = "dialed_entitlement_v1";
/** Cache is PER USER (audit item 4): a device-global cache handed one
 *  account's state to the next account on the same phone. */
function cacheKeyFor(uid: string): string {
  return `${CACHE_KEY}:${uid}`;
}
let currentUid: string | null = null;

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Forget the in-memory state (sign-out, account switch). The on-disk cache
 *  is per user, so it needs no wipe. */
export function clearEntitlementCache(): void {
  current = null;
  currentUid = null;
}

try {
  const auth: any = (supabase as any)?.auth;
  if (typeof auth?.onAuthStateChange === "function") {
    auth.onAuthStateChange((event: string, session: any) => {
      const uid = session?.user?.id ?? null;
      if (event === "SIGNED_OUT" || (uid && currentUid && uid !== currentUid)) clearEntitlementCache();
    });
  }
} catch {
  // tests and web: no listener
}

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
  const uid = await currentUserId();
  if (!uid) return FREE_ENTITLEMENT;
  if (current && currentUid === uid) return current;
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(uid));
    if (raw) {
      const parsed = { ...FREE_ENTITLEMENT, ...(JSON.parse(raw) as Partial<Entitlement>), justEnded: false, fromServer: false };
      current = parsed;
      currentUid = uid;
      return parsed;
    }
  } catch {
    // fall through
  }
  return FREE_ENTITLEMENT;
}

async function persist(uid: string, e: Entitlement): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKeyFor(uid), JSON.stringify(e));
  } catch {
    // ignore
  }
  currentUid = uid;
  emit(e);
}

/** When the RPC is unavailable (staged migration not on this project, no
 *  signal, transient error), a PAYING rider must still pass the gates:
 *  profiles.is_pro / pro_until (what the RC webhook writes) first, then the
 *  RevenueCat SDK's cached customer info, which works offline. Neither can
 *  start or count a trial; they only answer "is this rider Pro". */
async function proFallback(uid: string): Promise<{ pro: boolean; proUntil: string | null }> {
  try {
    const { data } = await supabase.from("profiles").select("is_pro, pro_until").eq("user_id", uid).maybeSingle();
    if (deriveIsPro(data as any)) return { pro: true, proUntil: (data as any)?.pro_until ?? null };
  } catch {
    // fall through
  }
  try {
    const info = await getCustomerInfo();
    if (isProInfo(info)) return { pro: true, proUntil: null };
  } catch {
    // fall through
  }
  return { pro: false, proUntil: null };
}

/** Server resolve (applies transitions) with cache fallback. Logs the
 *  trial_ended / downgraded pair when the server just flipped the state. */
export async function resolveEntitlement(): Promise<Entitlement> {
  const prev = await readCachedEntitlement();
  let uid: string | null = null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    uid = auth?.user?.id ?? null;
    if (!uid) return prev;
    const { data, error } = await supabase.rpc("resolve_entitlement").single();
    if (error || !data) throw error ?? new Error("resolve_entitlement: no data");
    const next: Entitlement = { ...fromRpc(data, prev), fromServer: true };
    if (next.justEnded) {
      void logEvent("trial_ended", { reason: next.trialEndReason, ride_days: next.trialRideDays });
      void logEvent("downgraded", { from: "trial_active" });
    }
    await persist(uid, { ...next, justEnded: false });
    return next;
  } catch {
    if (!uid) return prev;
    const fb = await proFallback(uid);
    if (fb.pro && prev.state !== "pro") {
      const next: Entitlement = { ...prev, state: "pro", proUntil: fb.proUntil ?? prev.proUntil, justEnded: false, resolvedAt: new Date().toISOString(), fromServer: false };
      await persist(uid, next);
      return next;
    }
    return { ...prev, fromServer: false };
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
    // Latch ONLY on a server answer (audit item 4): a cache or fallback
    // answer must not burn the one-time launch promise for an offline or
    // pre-migration first open.
    if (!e.fromServer) return null;
    // Decision 8 (2026-09-04): no launch trial for any account that ever
    // paid. The server refuses too (20260905130000); this is the fast path.
    const everPaid = e.state === "pro" || !!e.proUntil;
    if (e.state === "free" && !e.trialStartedAt && !everPaid) {
      const started = await startReverseTrial("launch_3_0");
      if (!started.fromServer) return null;
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
