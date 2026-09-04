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
import type { RideConditions } from "./rideConditions";
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

const CAP = 2;

function has(v: SettingsSnapshot, k: CircuitKey): boolean {
  return typeof v[k] === "number";
}

function tweakWord(n: number): string {
  return ["no tweaks", "one tweak", "two tweaks"][Math.min(n, 2)];
}

/** Morning rules: conditions vs the running setup's values. */
export function todaysSetupRules(c: RideConditions, base: SettingsSnapshot, setupName: string, hasAirFork: boolean): RuleResult {
  const deltas: RuleDelta[] = [];
  const themes: string[] = [];
  const push = (d: RuleDelta) => {
    if (deltas.length < CAP && has(base, d.circuit) && !deltas.some((x) => x.circuit === d.circuit)) deltas.push(d);
  };

  // Surface + state
  if (c.surface === "hardpack" && c.state === "choppy") {
    push({ circuit: "fork_comp", delta: +1, reason: "Choppy hardpack: a click softer keeps the fork moving over the chop." });
    themes.push("dirt");
  } else if (c.surface === "hardpack" && c.state === "rutted") {
    push({ circuit: "fork_reb", delta: +1, reason: "Rutted hardpack: a click faster rebound so the front recovers between ruts." });
    themes.push("dirt");
  } else if (c.surface === "sand" || (c.surface === "loam" && c.state !== "fresh")) {
    push({ circuit: "fork_comp", delta: -1, reason: `${c.surface === "sand" ? "Sand" : "Deep loam"} loads the fork: a click firmer holds it up.` });
    push({ circuit: "fork_reb", delta: -1, reason: "A click slower rebound keeps the front planted in the soft stuff." });
    themes.push("dirt");
  } else if (c.surface === "mud") {
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
export function retuneRules(
  tile: Exclude<RetuneTile, "new_track">,
  effective: SettingsSnapshot,
  hasAirFork: boolean,
  priorTweaks: { circuit: CircuitKey; delta: number }[]
): RuleResult {
  const deltas: RuleDelta[] = [];
  let tirePsiDelta = 0;
  let title = "";
  let note: string | null = null;
  if (tile === "watered") {
    title = "Retuned for wet dirt";
    const softened = priorTweaks.find((t) => t.circuit === "fork_comp" && t.delta > 0);
    if (softened && has(effective, "fork_comp")) deltas.push({ circuit: "fork_comp", delta: -softened.delta, reason: "Fresh water means grip. Take back the morning's chop softening." });
    tirePsiDelta = -0.5;
    note = "Fresh water means grip. Give the front some plushness back.";
  } else if (tile === "roughed") {
    title = "Retuned for a rough track";
    if (has(effective, "fork_comp")) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Braking and acceleration bumps forming: a click firmer fork comp holds it up. Rebound stays." });
    note = "Second-moto bumps. Hold the front up, leave rebound alone.";
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
