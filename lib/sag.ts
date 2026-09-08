// lib/sag.ts
// Sag page per bike (River, 2026-09-07). The KTM three-measurement method:
// A wheel hanging (bike on a stand), B on its wheels unloaded, C rider
// seated in full gear; static = A minus B, riding = A minus C. Riding sag is
// compared with the catalog target and window (lib/sagBounds), static with
// the catalog's stock_static_sag_mm. Every save is a sag_measurements row
// (history) and a stamp on the active setup version (migration
// 20260907190000). A failed write throws for the screen to show (rule a).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { readHistory } from "./rideDay";
import type { SagBounds } from "./sagBounds";
import { supabase } from "./supabase";
import { logEvent } from "./usage";
import { isUuid } from "./uuid";

export type SagInputs = { a: number | null; b: number | null; c: number | null };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** static = A minus B, riding = A minus C; null until both numbers exist. */
export function sagMath(i: SagInputs): { staticMm: number | null; ridingMm: number | null } {
  const staticMm = isNum(i.a) && isNum(i.b) ? Math.round(i.a - i.b) : null;
  const ridingMm = isNum(i.a) && isNum(i.c) ? Math.round(i.a - i.c) : null;
  return { staticMm, ridingMm };
}

export type SagVerdict = "in_range" | "low" | "high" | "unknown";

/** Riding sag against the window. "low" = less sag than the window (the
 *  bike sits high, preload too much); "high" = more sag (sits low). */
export function ridingVerdict(ridingMm: number | null, bounds: SagBounds): SagVerdict {
  if (!isNum(ridingMm)) return "unknown";
  if (ridingMm < bounds.min) return "low";
  if (ridingMm > bounds.max) return "high";
  return "in_range";
}

/** Static sag against the catalog's static target, plus or minus 5 mm. */
export function staticVerdict(staticMm: number | null, target: number | null | undefined): SagVerdict {
  if (!isNum(staticMm) || !isNum(target)) return "unknown";
  if (staticMm < target - 5) return "low";
  if (staticMm > target + 5) return "high";
  return "in_range";
}

/** "factory range" when the catalog row is sourced, "typical range" otherwise. */
export function rangeLabel(verified: boolean | null | undefined): "factory range" | "typical range" {
  return verified === true ? "factory range" : "typical range";
}

export type SagSourceKind = "model" | "platform" | "default";
export const SAG_SOURCE_LABEL: Record<SagSourceKind, string> = {
  model: "Target from this model's catalog row.",
  platform: "Target from the platform's manual; this exact model has no row yet.",
  default: "Target is the app default; no manual value for this bike yet.",
};

export const SPRING_RULE_LINE = "Static in range but riding sag out of range means the spring is wrong for your weight. Change the spring, not the preload.";

/** The spring rule fires when static is in range and riding is not. */
export function springRuleApplies(staticV: SagVerdict, ridingV: SagVerdict): boolean {
  return staticV === "in_range" && (ridingV === "low" || ridingV === "high");
}

export function verdictLine(kind: "riding" | "static", v: SagVerdict, bounds?: SagBounds, target?: number | null): string {
  if (v === "unknown") return kind === "riding" ? "Enter A and C for riding sag." : "Enter A and B for static sag.";
  if (kind === "riding" && bounds) {
    if (v === "in_range") return `In the window, ${bounds.min} to ${bounds.max} mm, target ${bounds.target}.`;
    if (v === "low") return `Under the window (${bounds.min} to ${bounds.max} mm): the bike sits high. Back the preload off.`;
    return `Over the window (${bounds.min} to ${bounds.max} mm): the bike sits low. Add preload.`;
  }
  if (isNum(target)) {
    if (v === "in_range") return `Close to the ${target} mm static target.`;
    if (v === "low") return `Under the ${target} mm static target.`;
    return `Over the ${target} mm static target.`;
  }
  return "";
}

export type SagMeasurement = {
  id: string;
  bike_id: string | null;
  version_id: string | null;
  a_mm: number;
  b_mm: number;
  c_mm: number;
  riding_mm: number;
  static_mm: number;
  measured_at: string;
};

/** Insert the measurement, stamp the active version, log the event. Throws
 *  on any failed write so the screen can show it. */
export async function saveSagMeasurement(p: { bikeId: string; versionId: string | null; a: number; b: number; c: number; bounds: SagBounds; fromRecheck?: boolean }): Promise<SagMeasurement> {
  const { staticMm, ridingMm } = sagMath({ a: p.a, b: p.b, c: p.c });
  if (staticMm === null || ridingMm === null) throw new Error("Enter all three measurements.");
  if (ridingMm <= 0 || staticMm < 0 || ridingMm > 200 || staticMm > 100) throw new Error("Those numbers do not add up. A is the longest, then B, then C.");
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Sign in to save a measurement.");
  const row = {
    user_id: userId,
    bike_id: isUuid(p.bikeId) ? p.bikeId : null,
    version_id: p.versionId && isUuid(p.versionId) ? p.versionId : null,
    a_mm: Math.round(p.a),
    b_mm: Math.round(p.b),
    c_mm: Math.round(p.c),
    riding_mm: ridingMm,
    static_mm: staticMm,
  };
  const { data, error } = await supabase.from("sag_measurements").insert(row).select("*").single();
  if (error) throw new Error(`Couldn't save the measurement: ${error.message}`);
  const saved = data as unknown as SagMeasurement;
  if (row.version_id) {
    const { error: vErr } = await supabase
      .from("setup_versions")
      .update({ sag_measured: true, sag_riding_measured_mm: ridingMm, sag_static_measured_mm: staticMm, sag_measured_at: saved.measured_at })
      .eq("id", row.version_id);
    if (vErr) throw new Error(`Saved the measurement, but the setup did not take it: ${vErr.message}`);
  }
  const inRange = ridingVerdict(ridingMm, p.bounds) === "in_range";
  void logEvent("sag_measured_saved", { bike_id: p.bikeId, version_id: row.version_id, riding_mm: ridingMm, static_mm: staticMm, in_range: inRange });
  if (p.fromRecheck) void logEvent("sag_recheck_completed", { bike_id: p.bikeId });
  return saved;
}

/** Last ten measurements for the bike, newest first. Empty offline. */
export async function readSagHistory(bikeId: string, limit = 10): Promise<SagMeasurement[]> {
  if (!isUuid(bikeId)) return [];
  try {
    const { data, error } = await supabase.from("sag_measurements").select("*").eq("bike_id", bikeId).order("measured_at", { ascending: false }).limit(limit);
    if (error || !data) return [];
    return data as unknown as SagMeasurement[];
  } catch {
    return [];
  }
}

export async function lastSagMeasuredAt(bikeId: string): Promise<string | null> {
  const rows = await readSagHistory(bikeId, 1);
  return rows[0]?.measured_at ?? null;
}

/** Due when never measured, or when at least `threshold` ride days have
 *  happened since the last measurement. */
export function sagRecheckDue(p: { lastMeasuredAt: string | null; rideDaysSince: number; threshold: number }): boolean {
  if (!p.lastMeasuredAt) return true;
  if (!Number.isFinite(p.threshold) || p.threshold <= 0) return false;
  return p.rideDaysSince >= p.threshold;
}

/** Ride days on this bike since an instant: the server's ride_days rows,
 *  else the device's ride history (quick refines are not ride days). */
export async function rideDaysSince(bikeId: string, sinceIso: string | null): Promise<number> {
  if (!sinceIso) return 0;
  if (isUuid(bikeId)) {
    try {
      const { count, error } = await supabase.from("ride_days").select("id", { count: "exact", head: true }).eq("bike_id", bikeId).gt("started_at", sinceIso);
      if (!error && typeof count === "number") return count;
    } catch {
      // fall through to the device
    }
  }
  try {
    const history = await readHistory();
    return history.filter((s) => s.bike.id === bikeId && !s.quick && s.startedAt > sinceIso).length;
  } catch {
    return 0;
  }
}

const dismissKey = (bikeId: string) => `sag_recheck_dismissed_v1:${bikeId}`;

/** "Not now" hides the card for the rest of the day. */
export async function dismissSagRecheck(bikeId: string, now = new Date()): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissKey(bikeId), now.toISOString().slice(0, 10));
  } catch {
    // device only
  }
}

export async function sagRecheckDismissedToday(bikeId: string, now = new Date()): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(dismissKey(bikeId))) === now.toISOString().slice(0, 10);
  } catch {
    return false;
  }
}
