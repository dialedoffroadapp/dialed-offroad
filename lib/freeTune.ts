// lib/freeTune.ts
// The free baseline credit, client side of migration 20260904140000:
// one baseline per bike, regenerable (not consumed). Pro gates are second
// setup, refine after ride, history, second bike. Accounting is server-side
// (claim_free_tune); this wraps the RPC, maps "regenerate" to "nothing
// consumed" so no refund is ever issued for it, and answers "does this bike
// already have a baseline?" for the gate's free alternative.
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export type ClaimReason = "pro" | "trial" | "first_baseline" | "regenerate" | "no_trial" | "rate_limited" | "error" | "unknown";

export type ClaimResult = {
  ok: boolean;
  reason: ClaimReason;
  /** A credit was consumed by THIS claim (refund on generation failure). */
  consumed: boolean;
  trialTunesUsed: number;
  /** Server-side Pro (vs a trial/first credit). */
  isPro: boolean;
};

export function mapClaim(raw: unknown): ClaimResult {
  const r = (raw ?? {}) as any;
  const reason: ClaimReason =
    r.reason === "pro" || r.reason === "trial" || r.reason === "first_baseline" || r.reason === "regenerate" || r.reason === "no_trial" || r.reason === "rate_limited"
      ? r.reason
      : r.ok
        ? "unknown"
        : "error";
  return {
    ok: !!r.ok,
    reason,
    consumed: !!r.ok && (reason === "trial" || reason === "first_baseline"),
    trialTunesUsed: typeof r.trial_tunes_used === "number" ? r.trial_tunes_used : 0,
    isPro: reason === "pro",
  };
}

/** Claim before generating. Pass the bike so the per-bike rule applies;
 *  a non-uuid (guest/local) id falls back to the legacy single credit. */
export async function claimBaselineCredit(bikeId: string | null | undefined): Promise<ClaimResult> {
  const args = bikeId && isUuid(bikeId) ? { p_bike_id: bikeId } : {};
  const { data, error } = await supabase.rpc("claim_free_tune", args).single();
  if (error) return { ok: false, reason: "error", consumed: false, trialTunesUsed: 0, isPro: false };
  return mapClaim(data);
}

/** Give back a consumed credit after a failed generation. No-op for
 *  claims that consumed nothing (regenerate / pro). */
export async function refundBaselineCredit(claim: ClaimResult | null | undefined): Promise<void> {
  if (!claim?.consumed) return;
  try {
    const { error } = await supabase.rpc("refund_free_tune").single();
    if (error) console.error("refund_free_tune failed", error);
  } catch (e) {
    console.error("refund_free_tune threw", e);
  }
}

/** True when the bike already has a baseline (so "Update my baseline
 *  instead" is a real alternative). Fail-open false. */
export async function hasBaselineForBike(bikeId: string | null | undefined): Promise<boolean> {
  if (!bikeId || !isUuid(bikeId)) return false;
  try {
    const { data } = await supabase.from("setup_versions").select("id").eq("bike_id", bikeId).limit(1).maybeSingle();
    return !!(data as any)?.id;
  } catch {
    return false;
  }
}

/** The rider's bike with a baseline, for gates that don't know the bike
 *  (Home story, add-bike): primary first. Fail-open null. */
export async function anyBikeWithBaseline(): Promise<string | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const { data } = await supabase
      .from("setup_versions")
      .select("bike_id, created_at")
      .eq("user_id", uid)
      .not("bike_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const id = (data as any)?.bike_id;
    return typeof id === "string" && isUuid(id) ? id : null;
  } catch {
    return null;
  }
}
