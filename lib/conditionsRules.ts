// lib/conditionsRules.ts
// The DETERMINISTIC client-side rule base for conditions (plan 4.1 step 4 +
// 4.6: "ships as written in v1"). Conditions → at most two small tweaks with
// a one-line reason. This is NOT the symptom engine: symptom changes after a
// moto come from ai-tune's Tune Two (app/ride/adjust.tsx). Clicks out from
// closed: + = softer/faster, − = firmer/slower. Pure and tested.
//
// v1 rule text (dialed-ride-day-build-plan.md §4.5):
//   drying hardpack + choppy → 1-2 clicks softer comp and/or faster rebound
//   sand / loam, deep        → 1-2 clicks stiffer comp, 1 click slower rebound
//   second-moto bumps        → 1-2 clicks stiffer fork comp, rebound unchanged
//   mud                      → suggest only; bigger change, compression up
//   heat                     → thins oil, raises air pressure (mockup 04 copy)
//   always                   → one change at a time, re-test, ask again
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

const CAP = 2;

function has(v: SettingsSnapshot, k: CircuitKey): boolean {
  return typeof v[k] === "number";
}

function tweakWord(n: number): string {
  return ["no tweaks", "one tweak", "two tweaks"][Math.min(n, 2)];
}

/** Morning rules: conditions vs the running setup's values. */
export function todaysSetupRules(c: RideConditions, base: SettingsSnapshot, setupName: string, hasAirFork: boolean): RuleResult {
  const surface = primarySurface(c);
  const deltas: RuleDelta[] = [];
  const themes: string[] = [];
  const push = (d: RuleDelta) => {
    if (deltas.length < CAP && has(base, d.circuit) && !deltas.some((x) => x.circuit === d.circuit)) deltas.push(d);
  };

  // Surface + state
  if (surface === "hardpack" && c.state === "choppy") {
    push({ circuit: "fork_comp", delta: +1, reason: "Choppy hardpack: a click softer keeps the fork moving over the chop." });
    themes.push("dirt");
  } else if (surface === "hardpack" && c.state === "rutted") {
    // Second report (2026-09-07, sub-task 4a): the research SUPPORTS this rule; no change.
    push({ circuit: "fork_reb", delta: +1, reason: "Rutted hardpack: a click faster rebound so the front recovers between ruts." });
    themes.push("dirt");
  } else if (surface === "sand" || (surface === "loam" && c.state !== "fresh")) {
    push({ circuit: "fork_comp", delta: -1, reason: `${surface === "sand" ? "Sand" : "Deep loam"} loads the fork: a click firmer holds it up.` });
    push({ circuit: "fork_reb", delta: -1, reason: "A click slower rebound keeps the front planted in the soft stuff." });
    themes.push("dirt");
  } else if (surface === "mud") {
    push({ circuit: "fork_comp", delta: -2, reason: "Mud: two clicks firmer. Bigger change on purpose; back it off once it dries." });
    themes.push("mud");
  }

  // Temperature
  if (c.temp === "hot") {
    if (hasAirFork && has(base, "fork_air")) push({ circuit: "fork_air", delta: -0.2, reason: "Heat raises air pressure as the fork warms. Start 0.2 bar lower." });
    else push({ circuit: "shock_lsc", delta: -1, reason: "Heat thins the oil and drops damping. A click firmer on the shock makes up for it." });
    themes.push("heat");
  } else if (c.temp === "cold") {
    if (hasAirFork && has(base, "fork_air")) push({ circuit: "fork_air", delta: +0.1, reason: "Cold air reads low. Start 0.1 bar higher so the fork holds up." });
    themes.push("cold");
  }

  const tirePsiDelta = c.watered ? -0.5 : 0;
  if (c.watered) themes.push("water");

  const n = deltas.length + (tirePsiDelta ? 1 : 0);
  const what = themes.length ? ` for today's ${themes.slice(0, 2).join(" and ")}` : "";
  const summary = n === 0 ? `Your ${setupName}, as it stands. Nothing today's dirt asks to change.` : `Your ${setupName}, ${tweakWord(n)}${what}.`;
  return { deltas, tirePsiDelta, summary, note: deltas[0]?.reason ?? null };
}

export type RetuneTile = "watered" | "roughed" | "heating" | "new_track";

/** Mid-day rules against the CURRENT effective values. `priorTweaks` lets
 *  "just watered" reverse an earlier choppy softening (mockup 07: 14 → 13). */
/** Ride context the two flipped retune rules read (second report, 2026-09-07, sub-task 4). */
export type RetuneContext = {
  state?: "fresh" | "choppy" | "rutted" | null;
  /** The rider logged bottoming this session. */
  bottoming?: boolean | null;
  skill?: "beginner" | "intermediate" | "pro" | null;
  discipline?: "mx" | "offroad" | null;
};

/** Mid-day rules against the CURRENT effective values. Second report
 *  (2026-09-07): "watered" holds compression soft (no take-back of the
 *  morning's softening; if choppy, fork rebound and shock LSC a click out;
 *  firmer only after logged bottoming); "roughed" softens fork compression
 *  for MX, and keeps the old firmer click only off-road, after bottoming, or
 *  for an A/pro rider. priorTweaks stays on the signature; it no longer
 *  drives a move. */
export function retuneRules(
  tile: RetuneTile,
  effective: SettingsSnapshot,
  hasAirFork: boolean,
  priorTweaks: { circuit: CircuitKey; delta: number }[],
  ctx: RetuneContext = {}
): RuleResult {
  void priorTweaks;
  const deltas: RuleDelta[] = [];
  let tirePsiDelta = 0;
  let title = "";
  let note: string | null = null;
  if (tile === "watered") {
    title = "Retuned for wet dirt";
    if (ctx.bottoming === true) {
      if (has(effective, "fork_comp")) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Wet dirt but it bottomed: a click firmer fork comp. Compression stays soft otherwise." });
    } else if (ctx.state === "choppy") {
      if (has(effective, "fork_reb")) deltas.push({ circuit: "fork_reb", delta: 1, reason: "Wet and choppy: a click faster fork rebound so the front recovers between hits. Compression stays soft." });
      if (has(effective, "shock_lsc")) deltas.push({ circuit: "shock_lsc", delta: 1, reason: "A click softer shock LSC for grip on the wet chop." });
    }
    tirePsiDelta = -0.5;
    note = "Fresh water means grip. Hold compression soft.";
  } else if (tile === "roughed") {
    title = "Retuned for a rough track";
    const firmer = ctx.discipline === "offroad" || ctx.bottoming === true || ctx.skill === "pro";
    if (has(effective, "fork_comp")) {
      if (firmer) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Braking and acceleration bumps forming: a click firmer fork comp holds it up. Rebound stays." });
      else deltas.push({ circuit: "fork_comp", delta: 1, reason: "Braking and acceleration bumps forming: a click softer fork comp keeps the wheel on the ground. Rebound stays." });
    }
    note = firmer ? "Second-moto bumps. Hold the front up, leave rebound alone." : "Second-moto bumps. Let the front follow them, leave rebound alone.";
  } else if (tile === "heating") {
    title = "Retuned for the heat";
    if (hasAirFork && has(effective, "fork_air")) deltas.push({ circuit: "fork_air", delta: -0.1, reason: "Fork's warming up and pressure climbs with it. Bleed 0.1 bar." });
    else if (has(effective, "fork_comp")) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Hot oil damps less. A click firmer makes up the difference." });
    note = "Heat thins the oil. Small step firmer, re-test.";
  }
  return { deltas, tirePsiDelta, summary: title, note };
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
