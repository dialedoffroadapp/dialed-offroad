// lib/paywallPosition.ts
// WHERE the trial paywall sits — a remote-switchable config flag (River,
// 2026-09-02): "interstitial" is the shipped ordering (signup → /premium →
// reveal), "action_gated" completes onboarding at signup, reveals the tune
// immediately, and presents the paywall the first time a Pro action is
// attempted (refine, setup history, second bike/setup).
//
// Resolution order (highest wins):
//   1. prod `app_config` row key "paywall_position" (migration
//      20260902110000) — editable in the dashboard, no store release
//   2. the last remote value cached on this device (AsyncStorage)
//   3. build default: EXPO_PUBLIC_PAYWALL_POSITION, else "action_gated"
// Synchronous readers (event stamping, routing) see the cached/default value
// until the remote refresh lands; the refresh is fire-and-forget with a
// timeout so a blackholed network can never stall boot.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

export type PaywallPosition = "interstitial" | "action_gated";

export const PAYWALL_POSITION_CONFIG_KEY = "paywall_position";
const CACHE_KEY = "dialed_paywall_position_v1";
const REMOTE_TIMEOUT_MS = 4000;

export function parsePaywallPosition(v: unknown): PaywallPosition | null {
  return v === "interstitial" || v === "action_gated" ? v : null;
}

const BUILD_DEFAULT: PaywallPosition =
  parsePaywallPosition(process.env.EXPO_PUBLIC_PAYWALL_POSITION) ?? "action_gated";

let current: PaywallPosition = BUILD_DEFAULT;
let cacheHydrated = false;

/** Synchronous read — cached/default until hydration + refresh land. */
export function getPaywallPosition(): PaywallPosition {
  return current;
}

export function isActionGatedPaywall(): boolean {
  return current === "action_gated";
}

/** Fast, awaitable: apply the device-cached remote value (if any). */
export async function hydratePaywallPositionFromCache(): Promise<PaywallPosition> {
  if (cacheHydrated) return current;
  try {
    const cached = parsePaywallPosition(await AsyncStorage.getItem(CACHE_KEY));
    if (cached) current = cached;
  } catch {
    // keep the build default
  }
  cacheHydrated = true;
  return current;
}

/** Best-effort remote refresh: never throws, never blocks longer than the
 *  timeout. A row that fails to parse leaves the current value untouched. */
export async function refreshPaywallPositionFromRemote(): Promise<PaywallPosition> {
  try {
    const query = supabase
      .from("app_config")
      .select("value")
      .eq("key", PAYWALL_POSITION_CONFIG_KEY)
      .maybeSingle();
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), REMOTE_TIMEOUT_MS));
    const res = await Promise.race([query, timeout]);
    const remote = parsePaywallPosition((res as any)?.data?.value);
    if (remote) {
      current = remote;
      try {
        await AsyncStorage.setItem(CACHE_KEY, remote);
      } catch {
        // cache miss is fine — the build default covers the next cold start
      }
    }
  } catch {
    // offline / table not yet migrated — build default + cache stand
  }
  return current;
}

/** Boot helper: cache first (awaited), remote in the background. */
export async function hydratePaywallPosition(): Promise<PaywallPosition> {
  const fromCache = await hydratePaywallPositionFromCache();
  void refreshPaywallPositionFromRemote();
  return fromCache;
}

/** Tests only. */
export function __setPaywallPositionForTests(p: PaywallPosition | null): void {
  current = p ?? BUILD_DEFAULT;
  cacheHydrated = false;
}
