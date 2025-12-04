// lib/baseline.ts
// Deterministic baseline tuner for Dialed Offroad.
// Uses the same ZeroTuneInput / ZeroTuneResult types as lib/ai.ts,
// but does NOT call any AI. Safe, MX/Enduro-aware defaults.

import type { ZeroTuneInput, ZeroTuneResult } from "./ai";

export type Discipline = "mx" | "enduro" | "mixed";

/* ---------------------- Basic helpers ---------------------- */

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function clampFloat(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// If rider weight missing, assume a reasonable “reference rider”
export function getWeight(input: ZeroTuneInput): number {
  const w = input.rider.weight_lbs;
  if (!w || w < 90) return 185;
  return Math.min(w, 260);
}

// Relative to a 185 lb reference rider (every 10 lb = +1 “step”)
export function weightFactor(input: ZeroTuneInput): number {
  const w = getWeight(input);
  return (w - 185) / 10;
}

// How aggressive the riding is (skill + style)
export function intensityFactor(input: ZeroTuneInput): number {
  let f = 0;

  if (input.rider.skill === "pro") f += 1.0;
  if (input.rider.skill === "beginner") f -= 0.5;

  if (input.rider.style === "short_motos") f += 0.5;
  if (input.rider.style === "long_enduro") f -= 0.2;

  return clampFloat(f, -1.5, 1.5);
}

/* ---------------------- MX vs Enduro detection ---------------------- */

export function inferDiscipline(input: ZeroTuneInput): Discipline {
  const terrain = (input.terrain || "").toLowerCase();
  const track = (input.track || "").toLowerCase();
  const issues = (input.rider.issues || "").toLowerCase();

  const mxHits = [
    "mx",
    "track",
    "motocross",
    "whoops",
    "sand whoops",
    "sx",
    "supercross",
    "jump",
    "table",
    "double",
    "triple",
    "rhythm",
  ];
  const enduroHits = [
    "enduro",
    "woods",
    "singletrack",
    "gnarly",
    "hard enduro",
    "roots",
    "rocks",
    "rocky",
    "technical",
    "tight",
    "chop",
  ];

  let mxScore = 0;
  let enduroScore = 0;

  for (const k of mxHits) {
    if (terrain.includes(k) || track.includes(k) || issues.includes(k)) mxScore++;
  }
  for (const k of enduroHits) {
    if (terrain.includes(k) || track.includes(k) || issues.includes(k)) enduroScore++;
  }

  // Style hint
  if (input.rider.style === "short_motos") mxScore++;
  if (input.rider.style === "long_enduro") enduroScore++;

  if (mxScore === 0 && enduroScore === 0) return "mixed";
  if (mxScore >= enduroScore + 1) return "mx";
  if (enduroScore >= mxScore + 1) return "enduro";
  return "mixed";
}

/* ---------------------- Air fork baseline ---------------------- */

export function baselineAirBar(
  input: ZeroTuneInput,
  discipline: Discipline
): number | undefined {
  // only compute if rider cares about air fork
  if (!input.wants_air_fork) return undefined;

  const wf = weightFactor(input);
  const intensity = intensityFactor(input);

  // Reference for 185 lb “neutral” rider
  const base =
    discipline === "mx"
      ? 10.4 // MX: more support
      : discipline === "enduro"
      ? 10.0 // Enduro: more compliance
      : 10.2; // Mixed

  // +0.20 bar per 10 lb delta, plus small bump for intensity
  let bar = base + wf * 0.2 + intensity * 0.1;

  // Safe clamp (roughly 9.4–11.6 bar)
  bar = clampFloat(bar, 9.4, 11.6);

  // round to 0.05 bar – feels pro
  return Number(bar.toFixed(2));
}

/* ---------------------- Sag baseline ---------------------- */

export function baselineSagMm(input: ZeroTuneInput, discipline: Discipline): number {
  const wf = weightFactor(input);
  const intensity = intensityFactor(input);

  let base =
    discipline === "mx"
      ? 102 // MX typical 98–105
      : discipline === "enduro"
      ? 108 // Enduro typical 105–112
      : 105; // Mixed

  // Heavier + more intense → a bit more sag for stability
  base += wf * 0.5 + intensity * 0.5;

  // small bias for long enduro days
  if (input.rider.style === "long_enduro") base += 2;

  // Global clamp
  const sag = clampInt(base, 98, 112);
  return sag;
}

/* ---------------------- Fork clickers ---------------------- */

export function baselineForkClicks(input: ZeroTuneInput, discipline: Discipline) {
  const wf = weightFactor(input);
  const intensity = intensityFactor(input);

  // midpoints from ZERO (fully closed)
  let compBase =
    discipline === "mx"
      ? 14 // more support
      : discipline === "enduro"
      ? 16 // softer
      : 15;

  let rebBase =
    discipline === "mx"
      ? 12 // more rebound control
      : discipline === "enduro"
      ? 14 // a touch freer
      : 13;

  // heavier + more intense → stiffer + more rebound control (fewer clicks out)
  compBase -= wf * 0.4 + intensity * 0.6;
  rebBase -= wf * 0.3 + intensity * 0.5;

  const comp_clicks = clampInt(compBase, 6, 24);
  const reb_clicks = clampInt(rebBase, 6, 24);

  return { comp_clicks, reb_clicks };
}

/* ---------------------- Shock clickers ---------------------- */

export function baselineShock(input: ZeroTuneInput, discipline: Discipline) {
  const wf = weightFactor(input);
  const intensity = intensityFactor(input);

  let lscBase =
    discipline === "mx"
      ? 12
      : discipline === "enduro"
      ? 14
      : 13;

  let rebBase =
    discipline === "mx"
      ? 14
      : discipline === "enduro"
      ? 16
      : 15;

  let hscBaseTurns =
    discipline === "mx"
      ? 1.4
      : discipline === "enduro"
      ? 1.6
      : 1.5;

  // scale: heavier + more intense → more control
  lscBase -= wf * 0.3 + intensity * 0.4;
  rebBase -= wf * 0.4 + intensity * 0.6;
  hscBaseTurns -= wf * 0.03 + intensity * 0.05;

  const lsc_clicks = clampInt(lscBase, 6, 20);
  const reb_clicks = clampInt(rebBase, 8, 22);
  const hsc_turns = Number(
    clampFloat(hscBaseTurns, 0.75, 2.0).toFixed(2)
  );

  return { lsc_clicks, reb_clicks, hsc_turns };
}

/* ---------------------- Full baseline tune ---------------------- */

export function computeBaseline(input: ZeroTuneInput): ZeroTuneResult {
  const discipline = inferDiscipline(input);

  const fork = baselineForkClicks(input, discipline);
  const shock = baselineShock(input, discipline);
  const sag_mm = baselineSagMm(input, discipline);
  const air_pressure_bar = baselineAirBar(input, discipline);

  return {
    fork: {
      comp_clicks: fork.comp_clicks,
      reb_clicks: fork.reb_clicks,
      air_pressure_bar,
    },
    shock: {
      lsc_clicks: shock.lsc_clicks,
      hsc_turns: shock.hsc_turns,
      reb_clicks: shock.reb_clicks,
      sag_mm,
    },
    detected: {
      has_air_fork: !!air_pressure_bar || !!input.wants_air_fork,
      fork_family: undefined,
    },
    notes: [],
  };
}
