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
// saved value when present, else a starting point per PRIMARY surface and
// discipline. The defaults are Dunlop's published guidance (research
// 2026-09-07, TIRE_PRESSURE_SOURCE); the watered-track half psi is our own
// rule. Front / rear psi. Dunlop's desert and rock range (14 to 16) has no
// surface of its own here; the off-road hardpack copy names it.
export const TIRE_PRESSURE_SOURCE =
  "Dunlop Motorcycle Tires, Geomax off-road tire pressure guidance (MX hardpack and intermediate 12 front / 12.5 rear, four-stroke front 13 to 14; soft 12 / 12; sand 11 to 12; mud 12 / 10; off-road 13 / 14; desert and rocks 14 to 16), read 2026-09-07";
export type TireDiscipline = "mx" | "offroad";
export const TIRE_DEFAULT_PSI: Record<TireDiscipline, Record<Surface, { front: number; rear: number; reason: string }>> = {
  mx: {
    hardpack: { front: 12, rear: 12.5, reason: "No tire pressure saved. Dunlop starting point for hardpack and intermediate MX: 12 front, 12.5 rear. Four-strokes often run 13 to 14 up front." },
    loam: { front: 12, rear: 12, reason: "No tire pressure saved. Dunlop starting point for soft MX terrain: 12 front, 12 rear. A touch of give for bite in the top layer." },
    sand: { front: 12, rear: 11.5, reason: "No tire pressure saved. Dunlop's sand range is 11 to 12. We start at 12 front, 11.5 rear so the tire floats and hooks up." },
    mud: { front: 12, rear: 10, reason: "No tire pressure saved. Dunlop starting point for mud: 12 front, 10 rear. The low rear opens the knobs for grip." },
  },
  offroad: {
    hardpack: { front: 13, rear: 14, reason: "No tire pressure saved. Dunlop starting point for off-road: 13 front, 14 rear. Rocks and desert run 14 to 16 to protect the tube." },
    loam: { front: 13, rear: 14, reason: "No tire pressure saved. Dunlop starting point for off-road: 13 front, 14 rear. Drop a psi where the ground is soft and the rocks are gone." },
    sand: { front: 12, rear: 12, reason: "No tire pressure saved. Dunlop's sand range is 11 to 12. We start at 12 front, 12 rear with a tube in mind." },
    mud: { front: 12, rear: 10, reason: "No tire pressure saved. Dunlop starting point for mud: 12 front, 10 rear. The low rear opens the knobs for grip." },
  },
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
  psiDelta: number,
  discipline: TireDiscipline | null = "mx"
): TirePlan {
  const hasSaved = typeof saved.front === "number" || typeof saved.rear === "number";
  if (hasSaved) {
    const front = typeof saved.front === "number" ? saved.front + psiDelta : null;
    const rear = typeof saved.rear === "number" ? saved.rear + psiDelta : null;
    return { front, rear, changed: psiDelta !== 0, reason: psiDelta !== 0 ? "Watered track: half a psi out front and rear for grip." : null, source: "saved" };
  }
  const surface = primarySurface(c);
  if (!surface) return { front: null, rear: null, changed: false, reason: null, source: "none" };
  const d = TIRE_DEFAULT_PSI[discipline ?? "mx"][surface];
  return { front: d.front + psiDelta, rear: d.rear + psiDelta, changed: true, reason: d.reason, source: "default" };
}
