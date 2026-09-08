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
import tireTable from "./generated/tireDefaults.json";
import { tirePlan, type TireDiscipline, type TirePlanOutput, type TireSystem, type TireTable } from "./tirePlanCore";

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
// saved value when present, else Dunlop's starting point per PRIMARY surface
// and discipline. Since 2026-09-07 tire pressure is an ENGINE output: the
// rule base is lib/tirePlanCore.ts over the server's table (single source of
// truth, supabase/functions/ai-tune/tire_defaults.json; lib/generated/
// tireDefaults.json is its generated copy) and this module is the offline
// fallback with the same numbers. The watered-track half psi is in the table.
export const TIRE_TABLE = tireTable as TireTable;
export const TIRE_PRESSURE_SOURCE = TIRE_TABLE.source;
/** Per discipline and surface, for display and the older callers. */
export const TIRE_DEFAULT_PSI = TIRE_TABLE.defaults;
export type { TireDiscipline };

export type TirePlan = {
  front: number | null;
  rear: number | null;
  /** True when the row should render as changed (default applied, or a rule delta). */
  changed: boolean;
  reason: string | null;
  source: "saved" | "default" | "none";
  /** The engine-shaped plan behind the row (systems, tire_source); absent for "none". */
  plan?: TirePlanOutput;
};

/** The engine's tire fields (or the offline core's output) in the row shape
 *  Today's setup renders: changed when it differs from what the bike has. */
export function planToTirePlan(plan: TirePlanOutput, saved: { front: number | null; rear: number | null }): TirePlan {
  const anySaved = typeof saved.front === "number" || typeof saved.rear === "number";
  const changed = plan.front !== saved.front || plan.rear !== saved.rear;
  return { front: plan.front, rear: plan.rear, changed, reason: plan.reason, source: anySaved ? "saved" : "default", plan };
}

export function tirePressureForToday(
  c: RideConditions,
  saved: { front: number | null; rear: number | null },
  psiDelta: number,
  discipline: TireDiscipline | null = "mx",
  systems?: { front?: TireSystem | null; rear?: TireSystem | null } | null
): TirePlan {
  const hasSaved = typeof saved.front === "number" || typeof saved.rear === "number";
  const surface = primarySurface(c);
  if (!surface && !hasSaved) return { front: null, rear: null, changed: false, reason: null, source: "none" };
  const plan = tirePlan(TIRE_TABLE, {
    discipline,
    surface,
    psiDelta,
    systemFront: systems?.front ?? null,
    systemRear: systems?.rear ?? null,
    savedFront: saved.front,
    savedRear: saved.rear,
  });
  if (hasSaved) {
    // The saved value is the rider's; the row changes only when a delta moved it.
    return { front: plan.front, rear: plan.rear, changed: psiDelta !== 0 || plan.front !== saved.front || plan.rear !== saved.rear, reason: psiDelta !== 0 || plan.source === "mousse_none" || plan.systemFront === "mousse" || plan.systemRear === "mousse" || plan.systemFront === "tubliss" || plan.systemRear === "tubliss" ? plan.reason : null, source: "saved", plan };
  }
  return { front: plan.front, rear: plan.rear, changed: true, reason: plan.reason, source: "default", plan };
}
