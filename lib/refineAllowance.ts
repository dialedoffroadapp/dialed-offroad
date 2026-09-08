// lib/refineAllowance.ts
// One free refinement before the paywall (River, 2026-09-07). The refine
// gate fires on the SECOND refinement of a bike, never the first. The server
// (ai-tune, server_refine_allowance) is the authority; this module only
// decides where a refine CTA routes:
//   entitled (trial_active or pro) → proceed, never gated;
//   allowance known and zero      → the Pro gate (trigger "refine");
//   allowance positive or unknown → proceed (the server still enforces).
// The allowance comes from the last refine response's
// refine_allowance_remaining (cached per bike), else the refine_allowance
// RPC, else unknown.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isEntitled, resolveEntitlement } from "./entitlement";
import { showProGate } from "./proGate";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

const key = (bikeId: string) => `refine_allowance_v1:${bikeId}`;

/** The one line under the numbers after the free refinement. */
export const FREE_REFINE_USED_LINE = "That was your free refinement. Keep refining, track history, and tune every bike with Pro.";

/** Remember the server's answer from a refine response. */
export async function noteRefineAllowance(bikeId: string, remaining: unknown): Promise<void> {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return;
  try {
    await AsyncStorage.setItem(key(bikeId), String(Math.max(0, Math.round(remaining))));
  } catch {
    // device cache only
  }
}

/** Free refinements left on this bike: the last refine response first, the
 *  RPC as the fallback, null when neither answers (offline, guest bike). */
export async function readRefineAllowance(bikeId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key(bikeId));
    if (raw !== null && Number.isFinite(Number(raw))) return Number(raw);
  } catch {
    // fall through to the RPC
  }
  if (!isUuid(bikeId)) return null;
  try {
    const { data, error } = await supabase.rpc("refine_allowance", { p_bike_id: bikeId });
    if (error || typeof data !== "number") return null;
    void noteRefineAllowance(bikeId, data);
    return data;
  } catch {
    return null;
  }
}

/** Pure routing rule. */
export function shouldGateRefine(input: { entitled: boolean; allowance: number | null }): boolean {
  if (input.entitled) return false;
  return input.allowance === 0;
}

/** Resolve entitlement, then the allowance; show the Pro gate only when the
 *  free refinement is used up. Returns true when the refine may proceed. */
export async function gateRefine(bikeId: string | null | undefined): Promise<boolean> {
  const e = await resolveEntitlement();
  if (isEntitled(e)) return true;
  const allowance = bikeId ? await readRefineAllowance(bikeId) : null;
  if (!shouldGateRefine({ entitled: false, allowance })) return true;
  showProGate({ trigger: "refine", bikeId: bikeId ?? null });
  return false;
}
