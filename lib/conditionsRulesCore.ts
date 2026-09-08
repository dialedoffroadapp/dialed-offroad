// lib/conditionsRulesCore.ts
// The DETERMINISTIC conditions rule base with NO imports, so the ai-tune
// edge function's Deno parity test (tests/conditions_parity_test.ts) can load
// it without pulling the app's module graph. lib/conditionsRules.ts wraps it
// with the app's types. Contract v3 (2026-09-05): the engine's conditions
// stage (conditionsRuleDeltas in supabase/functions/ai-tune/index.ts) is a
// rule-for-rule port of these two functions and is held equal to them by
// that test. Change a rule here and there together.
//
// Clicks out from closed: + = softer/faster, - = firmer/slower.
//   drying hardpack + choppy → 1-2 clicks softer comp and/or faster rebound
//   sand / loam, deep        → 1-2 clicks stiffer comp, 1 click slower rebound
//   second-moto bumps        → 1-2 clicks stiffer fork comp, rebound unchanged
//   mud                      → suggest only; bigger change, compression up
//   heat                     → thins oil, raises air pressure

export type CoreCircuit = "fork_comp" | "fork_reb" | "fork_air" | "shock_lsc" | "shock_hsc" | "shock_reb" | "shock_sag";
export type CoreSnapshot = Partial<Record<CoreCircuit, number | null>>;
export type CoreConditions = {
  surfaces?: readonly string[] | null;
  /** Pre-multi-select sessions stored one surface. */
  surface?: string | null;
  state?: string | null;
  temp?: string | null;
  watered?: boolean | null;
};

export type CoreRuleDelta = { circuit: CoreCircuit; delta: number; reason: string };
export type CoreRuleResult = {
  deltas: CoreRuleDelta[];
  /** Tire pressure change (psi, both ends): a bike attribute, not a version circuit. */
  tirePsiDelta: number;
  summary: string;
  note: string | null;
};

const CAP = 2;

function has(v: CoreSnapshot, k: CoreCircuit): boolean {
  return typeof v[k] === "number";
}

function tweakWord(n: number): string {
  return ["no tweaks", "one tweak", "two tweaks"][Math.min(n, 2)];
}

export function corePrimarySurface(c: CoreConditions | null | undefined): string | null {
  if (!c) return null;
  if (Array.isArray(c.surfaces)) return (c.surfaces.find((x) => typeof x === "string") as string | undefined) ?? null;
  return c.surface ?? null;
}

/** Morning rules: conditions vs the running setup's values. */
export function coreTodaysSetupRules(c: CoreConditions, base: CoreSnapshot, setupName: string, hasAirFork: boolean): CoreRuleResult {
  const surface = corePrimarySurface(c);
  const deltas: CoreRuleDelta[] = [];
  const themes: string[] = [];
  const push = (d: CoreRuleDelta) => {
    if (deltas.length < CAP && has(base, d.circuit) && !deltas.some((x) => x.circuit === d.circuit)) deltas.push(d);
  };

  // Surface + state
  if (surface === "hardpack" && c.state === "choppy") {
    push({ circuit: "fork_comp", delta: +1, reason: "Choppy hardpack: a click softer keeps the fork moving over the chop." });
    themes.push("dirt");
  } else if (surface === "hardpack" && c.state === "rutted") {
    // Second report (2026-09-07, sub-task 4a): supported, no change. Tally:
    // faster rebound 4 (Keefer Inc, PulpMX, MXA, Vital MX) to slower plus
    // more LSC 2 (Teknik, MXA rut-hold-up note).
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

export type CoreRetuneTile = "watered" | "roughed" | "heating";

/** Mid-day rules against the CURRENT effective values. `priorTweaks` lets
 *  "just watered" reverse an earlier choppy softening (mockup 07: 14 → 13). */
/** Ride context the two flipped retune rules read (second report, 2026-09-07). */
export type CoreRetuneContext = {
  state?: "fresh" | "choppy" | "rutted" | null;
  /** The rider logged bottoming this session. */
  bottoming?: boolean | null;
  skill?: "beginner" | "intermediate" | "pro" | null;
  discipline?: "mx" | "offroad" | null;
};

export function coreRetuneRules(
  tile: CoreRetuneTile,
  effective: CoreSnapshot,
  hasAirFork: boolean,
  priorTweaks: { circuit: CoreCircuit; delta: number }[],
  ctx: CoreRetuneContext = {}
): CoreRuleResult {
  const deltas: CoreRuleDelta[] = [];
  let tirePsiDelta = 0;
  let title = "";
  let note: string | null = null;
  if (tile === "watered") {
    // Second report (2026-09-07, sub-task 4b, adopted): hold compression soft
    // (no take-back); if choppy, fork rebound +1 out and shock LSC +1 out;
    // firm compression only when the rider reported bottoming. priorTweaks
    // stays on the signature for the wire; it no longer drives a move.
    void priorTweaks;
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
    // Second report (2026-09-07, sub-task 4c, flipped): MX softens fork
    // compression a click as the track roughs up; the old firmer click stays
    // only off-road, after logged bottoming, or for an A/pro rider. Tally:
    // soften 4 (Vital MX, Keefer Inc, PulpMX, Click Suspension) to firm 3
    // (Teknik, MXA, Troll Training), the closest of the three.
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
