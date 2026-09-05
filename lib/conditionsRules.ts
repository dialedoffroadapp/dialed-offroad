// lib/conditionsRules.ts
// The DETERMINISTIC client-side rule base for conditions (plan 4.1 step 4 +
// 4.6: "ships as written in v1"). Conditions → at most two small tweaks with
// a one-line reason. This is NOT the symptom engine: symptom changes after a
// moto come from ai-tune's Tune Two (app/ride/adjust.tsx). Clicks out from
// closed: + = softer/faster, − = firmer/slower. Pure and tested.
//
// Contract v3 (2026-09-05): the rules themselves live in
// lib/conditionsRulesCore.ts and are mirrored server-side in ai-tune's
// conditions stage; the Deno parity test keeps the two equal.
//
// v1 rule text (dialed-ride-day-build-plan.md §4.5):
//   drying hardpack + choppy → 1-2 clicks softer comp and/or faster rebound
//   sand / loam, deep        → 1-2 clicks stiffer comp, 1 click slower rebound
//   second-moto bumps        → 1-2 clicks stiffer fork comp, rebound unchanged
//   mud                      → suggest only; bigger change, compression up
//   heat                     → thins oil, raises air pressure (mockup 04 copy)
//   always                   → one change at a time, re-test, ask again
import { coreRetuneRules, coreTodaysSetupRules } from "./conditionsRulesCore";
import type { CircuitKey } from "./currentSetup";
import { primarySurface, type RideConditions, type Surface } from "./rideConditions";
import type { SettingsSnapshot } from "./setupVersions";

export type RuleDelta = { circuit: CircuitKey; delta: number; reason: string };

export type RuleResult = {
  deltas: RuleDelta[];
  /** Tire pressure change (psi, both ends) — a bike attribute, not a version circuit. */
  tirePsiDelta: number;
  /** "Your MX setup, two tweaks for today's dirt and heat." */
  summary: string;
  /** One line for the retune callout. */
  note: string | null;
};

/** Morning rules: conditions vs the running setup's values. The rule base
 *  lives in lib/conditionsRulesCore.ts (no imports) so the edge's parity test
 *  can hold the server port equal to it. */
export function todaysSetupRules(c: RideConditions, base: SettingsSnapshot, setupName: string, hasAirFork: boolean): RuleResult {
  return coreTodaysSetupRules(c, base, setupName, hasAirFork) as RuleResult;
}

export type RetuneTile = "watered" | "roughed" | "heating" | "new_track";

/** Mid-day rules against the CURRENT effective values. `priorTweaks` lets
 *  "just watered" reverse an earlier choppy softening (mockup 07: 14 → 13). */
export function retuneRules(
  tile: Exclude<RetuneTile, "new_track">,
  effective: SettingsSnapshot,
  hasAirFork: boolean,
  priorTweaks: { circuit: CircuitKey; delta: number }[]
): RuleResult {
  return coreRetuneRules(tile, effective, hasAirFork, priorTweaks) as RuleResult;
}

export const RETUNE_TILES: { id: RetuneTile; label: string; icon: string }[] = [
  { id: "watered", label: "Just watered", icon: "water-outline" },
  { id: "roughed", label: "Roughed up", icon: "pulse-outline" },
  { id: "heating", label: "Heating up", icon: "sunny-outline" },
  { id: "new_track", label: "New track", icon: "location-outline" },
];

/** Value + delta, clamped/rounded the way the store will apply it. */
export function previewValue(v: number | null, delta: number, decimals: number): number | null {
  if (typeof v !== "number") return null;
  const f = Math.pow(10, decimals);
  return Math.round((v + delta) * f) / f;
}

/* ------------------------- Tire pressure (today) ------------------------- */
// Today's setup ALWAYS produces a tire pressure (2026-09-04): the rider's
// saved value when present, else a rule-base starting point per PRIMARY
// surface. DRAFT defaults for River's review; front / rear psi.
export const TIRE_DEFAULT_PSI: Record<Surface, { front: number; rear: number; reason: string }> = {
  hardpack: { front: 13.5, rear: 13, reason: "No tire pressure saved. Hardpack starting point: 13.5 front, 13 rear. Firm enough to keep the carcass from folding on slick corners." },
  loam: { front: 13, rear: 12.5, reason: "No tire pressure saved. Loam starting point: 13 front, 12.5 rear. A touch lower for bite in the soft top layer." },
  sand: { front: 12.5, rear: 12, reason: "No tire pressure saved. Sand starting point: 12.5 front, 12 rear. Lower pressure floats and hooks up." },
  mud: { front: 12.5, rear: 12, reason: "No tire pressure saved. Mud starting point: 12.5 front, 12 rear. Lower pressure opens the knobs for grip." },
};

export type TirePlan = {
  front: number | null;
  rear: number | null;
  /** True when the row should render as changed (default applied, or a rule delta). */
  changed: boolean;
  reason: string | null;
  source: "saved" | "default" | "none";
};

export function tirePressureForToday(
  c: RideConditions,
  saved: { front: number | null; rear: number | null },
  psiDelta: number
): TirePlan {
  const hasSaved = typeof saved.front === "number" || typeof saved.rear === "number";
  if (hasSaved) {
    const front = typeof saved.front === "number" ? saved.front + psiDelta : null;
    const rear = typeof saved.rear === "number" ? saved.rear + psiDelta : null;
    return { front, rear, changed: psiDelta !== 0, reason: psiDelta !== 0 ? "Watered track: half a psi out front and rear for grip." : null, source: "saved" };
  }
  const surface = primarySurface(c);
  if (!surface) return { front: null, rear: null, changed: false, reason: null, source: "none" };
  const d = TIRE_DEFAULT_PSI[surface];
  return { front: d.front + psiDelta, rear: d.rear + psiDelta, changed: true, reason: d.reason, source: "default" };
}
