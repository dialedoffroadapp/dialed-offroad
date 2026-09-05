// supabase/functions/ai-tune/index.ts
// Zero-based MX/Enduro tuning Edge Function — engine v2
// - Mode "zero_baseline_v1": build initial tune (baseline + optional AI refinement)
// - Mode "tune2_v1": refine an existing tune based on rider feedback
//   v2 pipeline: auth+ratelimit → free-text parse → merge → symptom switch with
//   where-context modifiers → per-circuit conflict resolution → protect pass →
//   adaptive step from last outcome → total clamps → safeShape
// - Enforces guardrails and returns deterministic JSON for the app UI

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/* ----------------------------- Shared types ----------------------------- */

type ZeroInput = {
  mode?: "zero_baseline_v1" | "tune2_v1";
  // Pre-auth attribution (Workstream C): a client-minted random uuid sent
  // only by signed-out baseline callers. Stamped onto the anon tune_calls
  // row so claim_anon_tune_calls can attribute it after signup. Ignored for
  // authenticated callers (their user_id is already correct).
  anon_id?: string;
  input: {
    // baseline context
    make?: string;
    model?: string;
    year?: number;
    // Matched bike_models row id when the client resolved one (v2.4.0 data
    // capture). Stamped onto tune_calls.bike_model_id; never used for math —
    // guardrails stay the resolved-values contract.
    model_id?: string;
    // The garage bike this baseline is for (decision 3, 2026-09-05): drives
    // the server-side per-bike rule and is stored in tune_calls.input so
    // regenerates can be counted per bike. uuid-gated; absent for guests.
    bike_id?: string;
    // Coarse client fix (v2.4.0 data capture, ~110 m rounding). Persisted in
    // tune_calls.input verbatim; NOT used by generation. sanitizeLocation
    // strips the key when malformed.
    location?: { lat?: number; lng?: number; accuracy_m?: number | null };
    terrain?: string;
    track?: string;
    temp_f?: number;
    elev_ft?: number;
    rider: {
      weight_lbs?: number;
      skill: "beginner" | "intermediate" | "pro";
      style: "short_motos" | "long_enduro";
      goals: string[];
      issues?: string;
    };
    has_zeroed_clickers: boolean;

    // pass-through from app (air fork toggle)
    wants_air_fork?: boolean;

    guardrails?: {
      clicks_min: number;
      clicks_max: number;
      hsc_turns_min: number;
      hsc_turns_max: number;
      sag_min_mm: number;
      sag_max_mm: number;
      sag_target_mm?: number; // per-model sag target (lib/sagBounds); optional
      has_air_fork?: boolean; // spec-verified fork type — authoritative over toggle/heuristic when present
      aer_pressure_bar_default?: number;
      aer_pressure_bar_per_10lb?: number;
      // Fork air clamp (contract v3, decision 1): 7 to 14 bar unless sent.
      air_min_bar?: number;
      air_max_bar?: number;
    };

    // ----------------- Tune Two specific fields (optional) -----------------
    // When mode === "tune2_v1", the client should also send:
    previous?: PreviousTune; // previous tune, sparse where the setup never recorded a circuit
    feedback?: Tune2Feedback;
    last_outcome?: Tune2LastOutcome; // adaptive step input (optional)
    // Contract v3 (2026-09-05): the ride day's conditions and the setup
    // lineage this refinement belongs to (stored verbatim; the client scopes
    // last_outcome to it).
    conditions?: Tune2Conditions;
    setup_id?: string;
  };
};

type CircuitValue = number | null;

/** Who decided the numbers (contract v3, 2026-09-05). Baseline: "llm" (the
 *  model's JSON merged over the formula), "fallback_parse" (the model's text
 *  was not JSON; formula values shipped), "fallback_error" (the call threw),
 *  "formula" (no API key). Refinement: always "deterministic". */
type EngineSource = "llm" | "fallback_parse" | "fallback_error" | "formula" | "deterministic";

type ZeroResult = {
  fork: { comp_clicks: number; reb_clicks: number; air_pressure_bar?: number };
  shock: {
    lsc_clicks: number;
    hsc_turns: number;
    reb_clicks: number;
    sag_mm: number;
  };
  detected?: { has_air_fork?: boolean; fork_family?: string };
  notes: string[];
  // Client-computed spring-rate check (lib/modelSpecs). The server never sets it,
  // but safeShape passes it through if present so it's never silently dropped.
  spring_check?: unknown;
  engine_source?: EngineSource;
  /** Tire pressure change from the conditions stage (psi, both ends). */
  tire_psi_delta?: number;
};

/** A refinement's previous tune may be SPARSE (contract v3, honest previous
 *  values): a circuit the running setup never recorded is null, never
 *  invented, and the engine leaves it null in its answer. */
type PreviousTune = {
  fork: { comp_clicks: CircuitValue; reb_clicks: CircuitValue; air_pressure_bar?: CircuitValue };
  shock: { lsc_clicks: CircuitValue; hsc_turns: CircuitValue; reb_clicks: CircuitValue; sag_mm: CircuitValue };
  detected?: ZeroResult["detected"];
  notes?: string[];
};

/** Tune Two's answer: the previous tune's shape, sparse where it was sparse. */
type Tune2Result = {
  fork: PreviousTune["fork"];
  shock: PreviousTune["shock"];
  detected?: ZeroResult["detected"];
  notes: string[];
  spring_check?: unknown;
  engine_source?: EngineSource;
  tire_psi_delta?: number;
};

type Discipline = "mx" | "enduro" | "mixed";

/* ---------------------- Tune Two (feedback) types ---------------------- */

/** The 11 ids the v1/v2 engine shipped with. Still accepted and still routed
 *  to their original table rows, so the v1 regression stays byte-identical.
 *  LEGACY_TO_V3 (below) says which v3 id each one reads as for display and
 *  for the parse vocabulary. */
type LegacySymptomId =
  | "harsh_braking_bumps"
  | "deflects_in_chop"
  | "rear_kicks_accel"
  | "bottoms_landings"
  | "front_knifes"
  | "dead_feel"
  | "unstable_whoops"
  | "packs_whoops"
  | "harsh_square_edge"
  | "headshake"
  | "general_harsh";

/** The 14-id taxonomy (plan 4.3, adopted 2026-09-05; headshake is shared). */
type V3SymptomId =
  | "harsh_small_bumps"
  | "bottoming"
  | "rear_kicks"
  | "front_pushes"
  | "packs_in_chop"
  | "wallows_dives"
  | "headshake"
  | "rear_swaps"
  | "deflects"
  | "rear_squats"
  | "too_stiff"
  | "too_soft"
  | "arm_pump"
  | "chatters";

type SymptomId = LegacySymptomId | V3SymptomId;

/** Location / qualifier tags: the four v2 tags plus the plan's mandatory
 *  qualifiers (harsh: small_chop / under_braking / big_hits; rear kicks:
 *  jump_face / braking_bumps / logs_ledges; packs: whoops / rocks). */
type WhereTag =
  | "braking"
  | "corners"
  | "whoops"
  | "landings"
  | "small_chop"
  | "under_braking"
  | "big_hits"
  | "jump_face"
  | "braking_bumps"
  | "logs_ledges"
  | "rocks";
type ProtectArea = "rear_traction" | "front_planted" | "landings" | "cornering";

type Tune2Symptom = {
  id: SymptomId;
  severity: number; // 1–10
  where?: WhereTag; // optional location / qualifier context
  source?: "explicit" | "parsed"; // provenance (v2, set by merge stage)
};

type Tune2Feedback = {
  overall_rating?: number; // 1–10
  ride_duration_min?: number;
  terrain_tags?: string[];
  symptoms: Tune2Symptom[];
  free_text?: string; // raw rider note (v2, parsed server-side)
  protected?: { area: string }[]; // "don't touch" areas (v2)
  /** Which surface produced this call (contract v3). A conditions ask has
   *  no symptoms of its own and never runs the adaptive step. */
  source?: "debrief" | "ride_log" | "conditions";
};

/** The ride day's rider-tapped conditions (contract v3, decision 6). The
 *  engine applies the same rule base the client runs offline
 *  (lib/conditionsRules.ts, parity-tested) as a contributions stage that runs
 *  before the symptom table and through the same conflict and protect logic. */
type Tune2Conditions = {
  surfaces?: string[];
  state?: "fresh" | "choppy" | "rutted" | null;
  temp_band?: "cold" | "mild" | "hot" | null;
  watered?: boolean | null;
  /** Mid-day retune tile; prior_tweaks lets "watered" reverse a morning softening. */
  retune?: {
    tile: "watered" | "roughed" | "heating";
    prior_tweaks?: { circuit: string; delta: number }[];
  } | null;
};

type Tune2LastOutcome = {
  outcome: "improved" | "same" | "worse";
  symptoms: SymptomId[]; // symptom ids the previous refinement addressed
  deltas: Partial<Record<ClickCircuit, number>>; // per-circuit deltas it applied
};

type Circuit =
  | "fork_comp"
  | "fork_reb"
  | "shock_lsc"
  | "shock_reb"
  | "shock_hsc"
  | "fork_air";
type ClickCircuit = Exclude<Circuit, "fork_air">;

type Contribution = { symptomId: SymptomId | "conditions"; delta: number; severity: number };

type Tune2Input = {
  make?: string;
  model?: string;
  year?: number;
  terrain?: string;
  track?: string;
  rider?: {
    weight_lbs?: number;
    skill?: "beginner" | "intermediate" | "pro";
    style?: "short_motos" | "long_enduro";
    goals?: string[];
  };
  previous: PreviousTune;
  feedback: Tune2Feedback;
  guardrails?: ZeroInput["input"]["guardrails"];
  // v2 additions (populated by the handler after parse+merge):
  protectedAreas?: ProtectArea[];
  lastOutcome?: Tune2LastOutcome;
  parsedAddedIds?: SymptomId[];
  // contract v3
  conditions?: Tune2Conditions;
  setupId?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function clampInt(n: number, lo: number, hi: number): number {
  return clamp(Math.round(n), lo, hi);
}

function clampFloat(n: number, lo: number, hi: number): number {
  return clamp(n, lo, hi);
}

/** Fork type (decision 1, 2026-09-05): the verified catalog flag when the
 *  client sent one, else the rider's explicit toggle. No name guessing: the
 *  retired heuristic called every KTM/Husqvarna/GasGas with SX, FC or MC in
 *  its name an air fork, minis included, and shipped 1.5-bar tunes on 50s
 *  and 85s. Unmatched bikes are coil unless the rider says otherwise. */
export function resolveAirFork(z: ZeroInput["input"]): boolean {
  const spec = z.guardrails?.has_air_fork;
  if (typeof spec === "boolean") return spec;
  return z.wants_air_fork === true;
}

/* ---------------------- Baseline helpers (discipline/weight/etc.) ---------------------- */

// If rider weight missing, assume a reasonable “reference rider”
function getWeight(z: ZeroInput["input"]): number {
  const w = z.rider.weight_lbs;
  if (!w || w < 90) return 185;
  return Math.min(w, 260);
}

// Relative to a 185 lb reference rider (every 10 lb = +1 “step”)
function weightFactor(z: ZeroInput["input"]): number {
  const w = getWeight(z);
  return (w - 185) / 10;
}

// How aggressive the riding is (skill + style)
function intensityFactor(z: ZeroInput["input"]): number {
  let f = 0;

  if (z.rider.skill === "pro") f += 1.0;
  if (z.rider.skill === "beginner") f -= 0.5;

  if (z.rider.style === "short_motos") f += 0.5;
  if (z.rider.style === "long_enduro") f -= 0.2;

  return clampFloat(f, -1.5, 1.5);
}

// MX vs Enduro vs Mixed, inferred from terrain/track/issues/style
function inferDiscipline(z: ZeroInput["input"]): Discipline {
  const terrain = (z.terrain || "").toLowerCase();
  const track = (z.track || "").toLowerCase();
  const issues = (z.rider.issues || "").toLowerCase();

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
    if (terrain.includes(k) || track.includes(k) || issues.includes(k))
      enduroScore++;
  }

  // Style hint
  if (z.rider.style === "short_motos") mxScore++;
  if (z.rider.style === "long_enduro") enduroScore++;

  if (mxScore === 0 && enduroScore === 0) return "mixed";
  if (mxScore >= enduroScore + 1) return "mx";
  if (enduroScore >= mxScore + 1) return "enduro";
  return "mixed";
}

// Air fork baseline (AER / XACT style) with discipline + goals/issue bias
function baselineAirBar(
  z: ZeroInput["input"],
  discipline: Discipline,
  hasAirFork: boolean
): number | undefined {
  if (!hasAirFork) return undefined;

  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  // Discipline-specific defaults and slopes
  let baseDefault: number;
  let per10lbDefault: number;
  let clampLo: number;
  let clampHi: number;

  switch (discipline) {
    case "mx":
      baseDefault = 10.6; // more mid-stroke support
      per10lbDefault = 0.22;
      clampLo = 9.8;
      clampHi = 11.8;
      break;
    case "enduro":
      baseDefault = 10.0; // more small-bump compliance
      per10lbDefault = 0.18;
      clampLo = 9.0;
      clampHi = 11.2;
      break;
    default:
      baseDefault = 10.2;
      per10lbDefault = 0.2;
      clampLo = 9.4;
      clampHi = 11.5;
      break;
  }

  // Allow guardrails to override absolute baseline if you ever want to tune globally
  const base = z.guardrails?.aer_pressure_bar_default ?? baseDefault;
  const per10lb = z.guardrails?.aer_pressure_bar_per_10lb ?? per10lbDefault;

  // Core weight-based scaling
  let bar = base + wf * per10lb;

  // Intensity bias → MX gets stronger mid-stroke support, enduro gets softer nudge
  const intensityBias =
    discipline === "mx" ? 0.12 : discipline === "enduro" ? 0.06 : 0.08;
  bar += intensity * intensityBias;

  // Goals / issues bias: comfort vs support
  const goalsLower = (z.rider.goals || []).map((g) => g.toLowerCase());
  const issues = (z.rider.issues || "").toLowerCase();

  const wantsComfort =
    goalsLower.some((g) =>
      ["comfort", "plush", "traction", "grip", "compliance"].some((k) =>
        g.includes(k)
      )
    ) ||
    ["harsh", "chatter", "chop", "spiky"].some((k) => issues.includes(k));

  const wantsSupport =
    goalsLower.some((g) =>
      ["stability", "jumps", "big hits", "g-out", "bottom"].some((k) =>
        g.includes(k)
      )
    ) ||
    ["bottom", "case", "slam"].some((k) => issues.includes(k));

  if (wantsComfort && !wantsSupport) {
    // bias a touch softer
    bar -= 0.1;
  } else if (wantsSupport && !wantsComfort) {
    // bias a touch firmer
    bar += 0.1;
  }

  // Safe clamp per discipline
  bar = clampFloat(bar, clampLo, clampHi);

  // round to 0.05 bar – feels pro
  return Number(bar.toFixed(2));
}

// Sag baseline
function baselineSagMm(z: ZeroInput["input"], discipline: Discipline): number {
  const g = z.guardrails;
  // Per-model path: when the client sends a resolved target (from a verified
  // bike_models row via lib/sagBounds), honor it + the model's bounds. The
  // model's stock sag is authoritative — sag is preload-set for the rider's
  // weight to hit it — so no discipline literals or rider adjustment here.
  if (g && typeof g.sag_target_mm === "number") {
    const lo = typeof g.sag_min_mm === "number" ? g.sag_min_mm : 95;
    const hi = typeof g.sag_max_mm === "number" ? g.sag_max_mm : 112;
    return clampInt(g.sag_target_mm, lo, hi);
  }

  // v1 fallback — UNCHANGED, preserves the byte-identical regression. Only hit
  // by clients that don't send sag_target_mm (pre-consolidation clients / tests).
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  let base =
    discipline === "mx"
      ? 102 // MX typical 98–105
      : discipline === "enduro"
      ? 108 // Enduro typical 105–112
      : 105; // Mixed

  // Heavier + more intense → a bit more sag for stability
  base += wf * 0.5 + intensity * 0.5;

  // Small bias for long enduro days
  if (z.rider.style === "long_enduro") base += 2;

  // Global clamp
  const sag = clampInt(base, 98, 112);
  return sag;
}

// Fork clickers baseline
function baselineForkClicks(z: ZeroInput["input"], discipline: Discipline) {
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

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

// Shock clickers baseline
function baselineShock(z: ZeroInput["input"], discipline: Discipline) {
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  let lscBase = discipline === "mx" ? 12 : discipline === "enduro" ? 14 : 13;

  let rebBase = discipline === "mx" ? 14 : discipline === "enduro" ? 16 : 15;

  let hscBaseTurns =
    discipline === "mx"
      ? 1.4
      : discipline === "enduro"
      ? 1.6
      : 1.5;

  // Scale: heavier + more intense → more control
  lscBase -= wf * 0.3 + intensity * 0.4;
  rebBase -= wf * 0.4 + intensity * 0.6;
  hscBaseTurns -= wf * 0.03 + intensity * 0.05;

  const lsc_clicks = clampInt(lscBase, 6, 20);
  const reb_clicks = clampInt(rebBase, 8, 22);
  const hsc_turns = Number(clampFloat(hscBaseTurns, 0.75, 2.0).toFixed(2));

  return { lsc_clicks, reb_clicks, hsc_turns };
}

/* ------------------------- Guardrail shaping ------------------------- */

/** Quarter-turn quantization for HSC (decision 4, 2026-09-05): the hardware
 *  steps HSC by quarter turns; the old one-decimal rounding produced 1.3 for
 *  1.25 and disagreed with the app's stepper and display. */
export function quarterTurns(n: number): number {
  return Math.round(n * 4) / 4;
}

const AIR_MIN_BAR_DEFAULT = 7;
const AIR_MAX_BAR_DEFAULT = 14;

/** A finite number, else null (a string from the model, NaN, undefined all
 *  read as "not a value"; contract v3 NaN guard). */
function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type ShapeOpts = { allowNull?: boolean };

/** The one shaping pass for both modes. Baselines (allowNull false) fill a
 *  missing circuit with the historical default, exactly as v1 did; a
 *  refinement (allowNull true) keeps a null circuit null instead of
 *  inventing it (honest previous values). */
function shapeCircuits(
  partial: { fork?: any; shock?: any },
  g: ZeroInput["input"]["guardrails"] | undefined,
  opts: ShapeOpts
): { fork: PreviousTune["fork"]; shock: PreviousTune["shock"] } {
  const clicksMin = g?.clicks_min ?? 0;
  const clicksMax = g?.clicks_max ?? 30;
  const hscMin = g?.hsc_turns_min ?? 0;
  const hscMax = g?.hsc_turns_max ?? 3;
  const sagMin = g?.sag_min_mm ?? 95;
  const sagMax = g?.sag_max_mm ?? 112;
  const airMin = g?.air_min_bar ?? AIR_MIN_BAR_DEFAULT;
  const airMax = g?.air_max_bar ?? AIR_MAX_BAR_DEFAULT;
  const allowNull = !!opts.allowNull;

  const clicks = (v: unknown, def: number): CircuitValue => {
    const n = finiteOrNull(v);
    if (n === null) return allowNull ? null : clamp(Math.round(def), clicksMin, clicksMax);
    return clamp(Math.round(n), clicksMin, clicksMax);
  };
  // Baselines emit HSC in quarter turns. A refinement (allowNull) must not
  // snap a value it did not move (1.4 stays 1.4); buildTuneTwo snaps the
  // ones it moves.
  const hsc = (v: unknown, def: number): CircuitValue => {
    const n = finiteOrNull(v);
    if (n === null) return allowNull ? null : quarterTurns(clamp(def, hscMin, hscMax));
    const clamped = clamp(n, hscMin, hscMax);
    return allowNull ? Number(clamped.toFixed(2)) : quarterTurns(clamped);
  };
  const sag = (v: unknown, def: number): CircuitValue => {
    const n = finiteOrNull(v);
    if (n === null) return allowNull ? null : clamp(Math.round(def), sagMin, sagMax);
    return clamp(Math.round(n), sagMin, sagMax);
  };

  const out: { fork: PreviousTune["fork"]; shock: PreviousTune["shock"] } = {
    fork: {
      comp_clicks: clicks(partial.fork?.comp_clicks, 12),
      reb_clicks: clicks(partial.fork?.reb_clicks, 12),
    },
    shock: {
      lsc_clicks: clicks(partial.shock?.lsc_clicks, 12),
      hsc_turns: hsc(partial.shock?.hsc_turns, 1.5),
      reb_clicks: clicks(partial.shock?.reb_clicks, 14),
      sag_mm: sag(partial.shock?.sag_mm, g?.sag_target_mm ?? 105),
    },
  };
  // Fork air: present only as a finite number, clamped to the air window
  // (the old shape passed 1.5 bar straight through). A null air on an
  // air-fork previous stays absent: nothing to move.
  const air = finiteOrNull(partial.fork?.air_pressure_bar);
  if (air !== null) out.fork.air_pressure_bar = Number(clamp(air, airMin, airMax).toFixed(2));
  return out;
}

function applyForkTypeRule(
  out: { fork: { air_pressure_bar?: CircuitValue }; detected?: ZeroResult["detected"] },
  g: ZeroInput["input"]["guardrails"] | undefined
) {
  // Spec-verified fork type is authoritative: an AI-guessed air fork can never
  // survive on a confirmed-coil bike (and a confirmed air fork is flagged even
  // if the model forgot to).
  if (g?.has_air_fork === false) {
    delete out.fork.air_pressure_bar;
    if (out.detected) out.detected.has_air_fork = false;
  } else if (g?.has_air_fork === true && out.detected) {
    out.detected.has_air_fork = true;
  }
}

export function safeShape(
  partial: Partial<ZeroResult> | Partial<Tune2Result>,
  g: ZeroInput["input"]["guardrails"] | undefined
): ZeroResult {
  const shaped = shapeCircuits(partial, g, { allowNull: false });
  const out: ZeroResult = {
    fork: shaped.fork as ZeroResult["fork"],
    shock: shaped.shock as ZeroResult["shock"],
    detected: {
      has_air_fork: !!partial.detected?.has_air_fork,
      fork_family: partial.detected?.fork_family,
    },
    notes: Array.isArray(partial.notes) ? partial.notes.filter((n) => typeof n === "string").slice(0, 12) : [],
  };
  applyForkTypeRule(out, g);
  // Pass through a client-computed spring_check if one ever rides in (whitelist
  // reconstruction otherwise drops unknown fields).
  if (partial.spring_check !== undefined) out.spring_check = partial.spring_check;
  if (partial.engine_source) out.engine_source = partial.engine_source;
  if (typeof partial.tire_psi_delta === "number") out.tire_psi_delta = partial.tire_psi_delta;
  return out;
}

/** The refinement shape: sparse where the previous tune was sparse. */
export function safeShapeSparse(
  partial: Partial<Tune2Result>,
  g: ZeroInput["input"]["guardrails"] | undefined
): Tune2Result {
  const shaped = shapeCircuits(partial, g, { allowNull: true });
  const out: Tune2Result = {
    fork: shaped.fork,
    shock: shaped.shock,
    detected: {
      has_air_fork: !!partial.detected?.has_air_fork,
      fork_family: partial.detected?.fork_family,
    },
    notes: Array.isArray(partial.notes) ? partial.notes.filter((n) => typeof n === "string").slice(0, 12) : [],
    engine_source: "deterministic",
  };
  applyForkTypeRule(out, g);
  if (partial.spring_check !== undefined) out.spring_check = partial.spring_check;
  if (typeof partial.tire_psi_delta === "number") out.tire_psi_delta = partial.tire_psi_delta;
  return out;
}

/* ------------------------- Prompt construction (baseline AI) ------------------------- */

function buildSystemPrompt(z: ZeroInput["input"]): string {
  const clicksMin = z.guardrails?.clicks_min ?? 0;
  const clicksMax = z.guardrails?.clicks_max ?? 30;
  const hscMin = z.guardrails?.hsc_turns_min ?? 0;
  const hscMax = z.guardrails?.hsc_turns_max ?? 3;
  const sagMin = z.guardrails?.sag_min_mm ?? 95;
  const sagMax = z.guardrails?.sag_max_mm ?? 112;
  const sagTarget = z.guardrails?.sag_target_mm;
  const airSpec = z.guardrails?.has_air_fork;

  const lines = [
    "You are a world-class off-road suspension tuner for modern MX and enduro bikes.",
    "",
    "Your job:",
    "- Use ALL provided context (bike, terrain, temp, elevation, rider weight/skill/style, goals, issues, and zero-based flag).",
    "- Output a realistic, safe zero-based tune suitable for a normal rider.",
    "",
    "Definitions:",
    "- Zero-based means the rider starts with all clickers fully closed (0).",
    "- You must output absolute clicks OUT from zero.",
    "",
    "Output format:",
    "- You must return ONLY a single valid JSON object with this exact shape:",
    "  {",
    '    "fork": { "comp_clicks": number, "reb_clicks": number, "air_pressure_bar"?: number },',
    '    "shock": { "lsc_clicks": number, "hsc_turns": number, "reb_clicks": number, "sag_mm": number },',
    '    "detected"?: { "has_air_fork"?: boolean, "fork_family"?: string },',
    '    "notes": string[]',
    "  }",
    "- Do NOT include any markdown, explanations, or extra text outside the JSON.",
    "",
    "Constraints (guardrails):",
    `- Clamp all clickers between ${clicksMin} and ${clicksMax} clicks out.`,
    `- Clamp shock high-speed compression (hsc_turns) between ${hscMin} and ${hscMax} turns out.`,
    `- Clamp sag between ${sagMin} and ${sagMax} mm unless goals clearly require being slightly stiffer/softer.`,
    // Per-model target (verified bike_models row). Without an explicit target
    // the model tends to echo the generic 105 from the example output.
    ...(typeof sagTarget === "number"
      ? [
          `- Target riding sag for THIS bike is ${sagTarget} mm. Set shock.sag_mm to ${sagTarget} unless the rider's goals/issues clearly justify a small deviation within the clamp range.`,
        ]
      : []),
    "",
    "Bike & fork rules:",
    ...(typeof airSpec === "boolean"
      ? [
          airSpec
            ? "- This bike is confirmed to have a WP AER/XACT-style air fork — include fork.air_pressure_bar and set detected.has_air_fork to true."
            : "- This bike is confirmed to have a COIL fork — do NOT include fork.air_pressure_bar and do not mark it as an air fork.",
        ]
      : z.wants_air_fork === true
        ? [
            "- The rider states this bike runs an air fork: include fork.air_pressure_bar and set detected.has_air_fork to true.",
          ]
        : [
            "- Treat this bike as a COIL fork: do NOT include fork.air_pressure_bar and do not mark it as an air fork. Never guess an air fork from the model name.",
          ]),
    "- Never suggest internal revalving, oil changes, or hardware modifications; only clicker changes, sag target, and (if applicable) air pressure guidance.",
    "",
    "Tuning priorities:",
    "- Always react to the rider's weight, skill, and style.",
    "- Use terrain, elevation, and temperature to bias towards traction vs hold-up.",
    "- Respect the rider's goals (e.g., stability, comfort, playfulness, grip, jump support).",
    "- If issues are provided (harsh on braking bumps, packs on whoops, kicks on square-edge, etc.), explicitly address them in the tune.",
    "",
    "Notes field:",
    "- Provide 3–8 short, track-side style notes as a test plan (e.g., 'If harsh on square-edge → +2 fork comp', 'If rear kicks on chop → +2 shock rebound').",
    "- Reference the rider's goals and issues in the notes.",
  ];

  return lines.join("\n");
}

function buildUserPrompt(z: ZeroInput["input"]): string {
  const bikeLine =
    [z.year, z.make, z.model].filter(Boolean).join(" ") || "Unknown bike";

  const weight = z.rider.weight_lbs
    ? `${z.rider.weight_lbs} lb`
    : "not specified (assume 180–190 lb adult, but do NOT say this)";

  const goals =
    (z.rider.goals || []).length > 0
      ? z.rider.goals.join(", ")
      : "No specific goals given";

  const tempStr =
    typeof z.temp_f === "number" ? `${z.temp_f} °F` : "not specified";
  const elevStr =
    typeof z.elev_ft === "number" ? `${z.elev_ft} ft` : "not specified";

  const wantsAir =
    z.wants_air_fork === true
      ? "Rider explicitly indicated an air fork (AER) is in use or desired."
      : "Rider did not explicitly request an air fork.";

  const lines = [
    `Bike: ${bikeLine}`,
    `Terrain: ${z.terrain ?? ""}${z.track ? ` @ ${z.track}` : ""}`,
    `Environment: Temp ${tempStr}, Elevation ${elevStr}`,
    `Rider: ${weight}, skill=${z.rider.skill}, style=${z.rider.style}`,
    `Goals: ${goals}`,
    `Issues: ${z.rider.issues || "None described"}`,
    `Zero-based clickers: ${
      z.has_zeroed_clickers
        ? "true"
        : "false (still output absolute clicks from zero)"
    }`,
    `Air fork: ${wantsAir}`,
    "",
    "Now compute a safe, realistic zero-based tune and respond ONLY with the JSON object.",
  ];

  return lines.join("\n");
}

/* ---------------------------- OpenAI call (baseline refinement only) ---------------------------- */

async function callOpenAI(
  z: ZeroInput["input"]
): Promise<Partial<ZeroResult>> {
  const system = buildSystemPrompt(z);
  const user = buildUserPrompt(z);

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            user +
            "\n\nReturn only valid JSON. Example shape:\n" +
            JSON.stringify(
              {
                fork: {
                  comp_clicks: 12,
                  reb_clicks: 12,
                  air_pressure_bar: 10.6,
                },
                shock: {
                  lsc_clicks: 12,
                  hsc_turns: 1.5,
                  reb_clicks: 14,
                  sag_mm: 105,
                },
                detected: {
                  has_air_fork: true,
                  fork_family: "WP XACT AER 48",
                },
                notes: [
                  "Do X",
                  "If Y then +2 fork reb",
                  "If harsh on square-edge → +2 fork comp",
                ],
              },
              null,
              0
            ),
        },
      ],
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const content: string =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.message ??
    "{}";

  // Try to parse strict JSON; also strip code fences if present
  const trimmed = String(content)
    .trim()
    .replace(/^```json/i, "")
    .replace(/```$/i, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    // last resort minimal suggestion
    return {};
  }
}

/* ----------------------- Baseline personal notes helper ----------------------- */

function buildPersonalBaselineNotes(
  z: ZeroInput["input"],
  discipline: Discipline,
  hasAER: boolean,
  air_pressure_bar?: number,
  sag_mm?: number
): string[] {
  const bikeStr =
    [z.year, z.make, z.model].filter(Boolean).join(" ") || "your bike";

  const terrain =
    z.terrain && z.terrain.trim().length
      ? z.terrain
      : "mixed off-road terrain";

  const weightStr = z.rider.weight_lbs
    ? `${z.rider.weight_lbs} lb rider`
    : "average adult rider";

  const goalsArr = z.rider.goals || [];
  const goalsStr = goalsArr.length ? goalsArr.join(", ") : "";
  const issuesStr = (z.rider.issues || "").trim();

  const disciplineLabel =
    discipline === "mx"
      ? "MX track"
      : discipline === "enduro"
      ? "enduro / singletrack"
      : "mixed MX / off-road";

  const notes: string[] = [];

  notes.push(
    `Baseline zero-based tune for ${bikeStr} on ${terrain} (${disciplineLabel}).`
  );

  notes.push(
    `This setup assumes a ${weightStr} with ${z.rider.skill} skill and ${z.rider.style.replace(
      "_",
      " "
    )} riding.`
  );

  if (goalsStr) {
    notes.push(`Primary goals: ${goalsStr}.`);
  }

  if (issuesStr) {
    notes.push(`We biased the tune to help with: ${issuesStr}.`);
  }

  if (typeof sag_mm === "number") {
    notes.push(
      `Start by setting rear sag close to ${sag_mm} mm with full gear on, standing in attack position.`
    );
  }

  if (hasAER && typeof air_pressure_bar === "number") {
    notes.push(
      `Set fork air (AER) to about ${air_pressure_bar.toFixed(
        2
      )} bar with the fork bled to ambient, then recheck once the bike is warm.`
    );
  }

  notes.push(
    "Ride a 5–7 minute loop that includes braking bumps, some chop, and at least one faster straight so you can feel stability."
  );

  notes.push(
    "If the front feels harsh or deflects on square-edge hits → add 1–2 clicks of fork compression (softer) and consider dropping ~0.1 bar AER."
  );

  notes.push(
    "If the rear kicks on acceleration chop → add 1–2 clicks of shock rebound (slower) to calm it down."
  );

  notes.push(
    "If it blows through and bottoms hard on landings or G-outs → go 1–2 clicks firmer on shock low-speed compression and 0.1–0.2 turns stiffer on HSC."
  );

  return notes.slice(0, 10);
}

/* --------------------------- Baseline / fallback (mode: zero_baseline_v1) --------------------------- */

function buildFallback(z: ZeroInput["input"]): Partial<ZeroResult> {
  const discipline = inferDiscipline(z);

  // Catalog flag, else the rider's toggle. Never the model name.
  const specAER = z.guardrails?.has_air_fork;
  const hasAER = resolveAirFork(z);

  const forkClicks = baselineForkClicks(z, discipline);
  const shockClicks = baselineShock(z, discipline);
  const sag_mm = baselineSagMm(z, discipline);
  const air_pressure_bar = baselineAirBar(z, discipline, hasAER);

  const base: Partial<ZeroResult> = {
    fork: {
      comp_clicks: forkClicks.comp_clicks,
      reb_clicks: forkClicks.reb_clicks,
      air_pressure_bar,
    },
    shock: {
      lsc_clicks: shockClicks.lsc_clicks,
      hsc_turns: shockClicks.hsc_turns,
      reb_clicks: shockClicks.reb_clicks,
      sag_mm,
    },
    detected: {
      has_air_fork: hasAER,
      fork_family: hasAER ? (typeof specAER === "boolean" ? "Air fork (catalog)" : "Air fork (rider-set)") : undefined,
    },
    notes: [],
  };

  // Always build rider-specific baseline notes, even if AI is off
  base.notes = buildPersonalBaselineNotes(
    z,
    discipline,
    hasAER,
    air_pressure_bar,
    sag_mm
  );

  return base;
}

/* ---------------- Tune Two symptom labels for tailored notes ---------------- */

const SYMPTOM_LABELS: Record<SymptomId | "conditions", string> = {
  // legacy ids (v1/v2), still accepted
  harsh_braking_bumps: "harsh on braking bumps",
  deflects_in_chop: "front deflects in chop",
  rear_kicks_accel: "rear kicks under acceleration",
  bottoms_landings: "bottoming on landings / G-outs",
  front_knifes: "front knifing in corners",
  dead_feel: "dead / no pop feel",
  unstable_whoops: "unstable in whoops",
  packs_whoops: "packing in whoops",
  harsh_square_edge: "harsh on square-edge",
  headshake: "high-speed headshake",
  general_harsh: "general harsh feel",
  // v3 taxonomy (plan 4.3)
  harsh_small_bumps: "harsh on small bumps",
  bottoming: "bottoming",
  rear_kicks: "rear kicks",
  front_pushes: "front pushes",
  packs_in_chop: "packing in chop",
  wallows_dives: "wallowing / diving",
  rear_swaps: "rear swaps",
  deflects: "deflection",
  rear_squats: "rear squats",
  too_stiff: "too stiff",
  too_soft: "too soft",
  arm_pump: "arm pump",
  chatters: "chatter",
  conditions: "today's conditions",
};

/* ------------------- v2/v3 vocabularies + validation helpers ------------------- */

const LEGACY_SYMPTOM_IDS: readonly LegacySymptomId[] = [
  "harsh_braking_bumps",
  "deflects_in_chop",
  "rear_kicks_accel",
  "bottoms_landings",
  "front_knifes",
  "dead_feel",
  "unstable_whoops",
  "packs_whoops",
  "harsh_square_edge",
  "headshake",
  "general_harsh",
];

export const V3_SYMPTOM_IDS: readonly V3SymptomId[] = [
  "harsh_small_bumps",
  "bottoming",
  "rear_kicks",
  "front_pushes",
  "packs_in_chop",
  "wallows_dives",
  "headshake",
  "rear_swaps",
  "deflects",
  "rear_squats",
  "too_stiff",
  "too_soft",
  "arm_pump",
  "chatters",
];

/** Legacy id → the v3 id it reads as (display, analytics, the parse
 *  vocabulary). Three legacy ids have no clean v3 equivalent and stay
 *  first-class: dead_feel, unstable_whoops, harsh_square_edge. The engine
 *  never translates at input: legacy ids keep their original table rows, so
 *  the v1 regression stays byte-identical. */
export const LEGACY_TO_V3: Record<LegacySymptomId, { id: SymptomId; where?: WhereTag }> = {
  harsh_braking_bumps: { id: "harsh_small_bumps", where: "under_braking" },
  deflects_in_chop: { id: "deflects" },
  rear_kicks_accel: { id: "rear_kicks" },
  bottoms_landings: { id: "bottoming" },
  front_knifes: { id: "front_pushes" },
  dead_feel: { id: "dead_feel" },
  unstable_whoops: { id: "unstable_whoops" },
  packs_whoops: { id: "packs_in_chop", where: "whoops" },
  harsh_square_edge: { id: "harsh_square_edge" },
  headshake: { id: "headshake" },
  general_harsh: { id: "too_stiff" },
};

const KNOWN_SYMPTOM_IDS = new Set<SymptomId>([...LEGACY_SYMPTOM_IDS, ...V3_SYMPTOM_IDS]);

export const WHERE_TAGS: readonly WhereTag[] = [
  "braking",
  "corners",
  "whoops",
  "landings",
  "small_chop",
  "under_braking",
  "big_hits",
  "jump_face",
  "braking_bumps",
  "logs_ledges",
  "rocks",
];
const KNOWN_WHERES = new Set<WhereTag>(WHERE_TAGS);

const KNOWN_AREAS = new Set<ProtectArea>([
  "rear_traction",
  "front_planted",
  "landings",
  "cornering",
]);

const AREA_LABELS: Record<ProtectArea, string> = {
  rear_traction: "rear traction",
  front_planted: "front-end feel",
  landings: "landings",
  cornering: "cornering",
};

// Which circuits each protected area covers (Change 6)
const PROTECT_MAP: Record<ProtectArea, ClickCircuit[]> = {
  rear_traction: ["shock_lsc", "shock_reb"],
  front_planted: ["fork_comp", "fork_reb"],
  landings: ["shock_hsc", "shock_lsc"],
  cornering: ["fork_comp", "fork_reb"],
};

// One adjustment unit per circuit for the conflict / protect / adaptive
// math. HSC is a quarter turn (decision 4, 2026-09-05; was 0.15).
const CIRCUIT_META: Record<Circuit, { label: string; unit: number }> = {
  fork_comp: { label: "fork compression", unit: 1 },
  fork_reb: { label: "fork rebound", unit: 1 },
  shock_lsc: { label: "shock low-speed compression", unit: 1 },
  shock_reb: { label: "shock rebound", unit: 1 },
  shock_hsc: { label: "shock high-speed compression", unit: 0.25 },
  fork_air: { label: "fork air pressure", unit: 0.05 },
};

function normalizeWhere(v: unknown): WhereTag | undefined {
  if (typeof v !== "string") return undefined;
  const w = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return KNOWN_WHERES.has(w as WhereTag) ? (w as WhereTag) : undefined;
}

function normalizeArea(v: unknown): ProtectArea | undefined {
  if (typeof v !== "string") return undefined;
  const a = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return KNOWN_AREAS.has(a as ProtectArea) ? (a as ProtectArea) : undefined;
}

function fmtDelta(n: number): string {
  const body = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return n > 0 ? `+${body}` : body;
}

/* --------------------- v2 free-text parsing (Change 2) --------------------- */
// Vocabulary = the v3 taxonomy (contract v3); legacy ids are still accepted
// by sanitizeParsedFeedback if the model emits one.

const PARSE_SYSTEM_PROMPT = [
  "You extract structured dirt-bike suspension feedback from a rider's free-text ride note.",
  'Return ONLY strict JSON with this exact shape: {"symptoms":[{"id":"...","severity":5,"where":"..."}],"protected":[{"area":"..."}]}',
  "Rules:",
  `- "id" MUST be one of: ${V3_SYMPTOM_IDS.join(", ")}.`,
  '- "severity" is an integer 1-10 for how bad it sounds; use 5 when unclear.',
  `- "where" is optional and MUST be one of: ${WHERE_TAGS.join(", ")}. Omit it when the note does not say where.`,
  '- "protected" entries are ONLY for things the rider says are working well and should not change; "area" MUST be one of: rear_traction, front_planted, landings, cornering.',
  "- If a statement does not map cleanly onto these vocabularies, OMIT it. Never invent symptoms, severities, wheres, or areas.",
  "- Empty arrays are valid. Return no other keys and no prose.",
].join("\n");

/**
 * callParseFeedback — extract structured feedback from a rider's free-text note.
 * Fail-open by design: any timeout, HTTP error, or unparseable response returns
 * null and the pipeline continues on explicit input only.
 */
export async function callParseFeedback(
  freeText: string,
  fetcher: typeof fetch = fetch
): Promise<unknown | null> {
  if (!OPENAI_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: PARSE_SYSTEM_PROMPT },
          { role: "user", content: freeText.slice(0, 1000) },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 120)}`);
    }

    const json = await resp.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(String(content));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("free-text parse skipped (fail-open):", msg.slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * sanitizeParsedFeedback — server-side validation of whatever the parse model
 * returned. Everything is whitelisted/clamped regardless of what came back.
 */
export function sanitizeParsedFeedback(raw: unknown): {
  symptoms: Tune2Symptom[];
  protectedAreas: ProtectArea[];
} {
  const out: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } = {
    symptoms: [],
    protectedAreas: [],
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as any;

  if (Array.isArray(r.symptoms)) {
    for (const s of r.symptoms) {
      if (!s || typeof s !== "object") continue;
      const id = typeof s.id === "string" ? s.id.trim() : "";
      if (!KNOWN_SYMPTOM_IDS.has(id as SymptomId)) continue; // unknown ids dropped
      const severity = clampInt(Number(s.severity) || 5, 1, 10);
      const where = normalizeWhere(s.where);
      out.symptoms.push({
        id: id as SymptomId,
        severity,
        ...(where ? { where } : {}),
        source: "parsed",
      });
    }
  }

  if (Array.isArray(r.protected)) {
    for (const p of r.protected) {
      const area = normalizeArea(p?.area);
      if (area && !out.protectedAreas.includes(area)) {
        out.protectedAreas.push(area);
      }
    }
  }

  return out;
}

/* --------------------------- v2 merge stage (Change 3) --------------------------- */

/**
 * mergeFeedback — combine explicit chip feedback with parsed free-text feedback.
 * Per symptom id, explicit chips win on conflict (severity AND where); parsed
 * symptoms only add ids the rider didn't chip. Same rule for protected areas
 * (union — same vocabulary, no per-area payload to conflict on).
 */
export function mergeFeedback(
  explicit: Tune2Feedback | undefined,
  parsed: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } | null
): {
  symptoms: Tune2Symptom[];
  protectedAreas: ProtectArea[];
  parsedAddedIds: SymptomId[];
} {
  const symptoms: Tune2Symptom[] = [];
  const seen = new Set<SymptomId>();

  for (const s of explicit?.symptoms ?? []) {
    if (!s || !KNOWN_SYMPTOM_IDS.has(s.id as SymptomId)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const where = normalizeWhere(s.where);
    symptoms.push({
      id: s.id,
      severity: s.severity,
      ...(where ? { where } : {}),
      source: "explicit",
    });
  }

  const parsedAddedIds: SymptomId[] = [];
  for (const s of parsed?.symptoms ?? []) {
    if (seen.has(s.id)) continue; // explicit chip wins
    seen.add(s.id);
    symptoms.push(s);
    parsedAddedIds.push(s.id);
  }

  const protectedAreas: ProtectArea[] = [];
  for (const p of explicit?.protected ?? []) {
    const area = normalizeArea(p?.area);
    if (area && !protectedAreas.includes(area)) protectedAreas.push(area);
  }
  for (const area of parsed?.protectedAreas ?? []) {
    if (!protectedAreas.includes(area)) protectedAreas.push(area);
  }

  return { symptoms, protectedAreas, parsedAddedIds };
}

/** sanitizePrevious — the previous tune with every circuit either a finite
 *  number or null (contract v3, honest previous values). Nothing is invented
 *  here or downstream. */
export function sanitizePrevious(raw: unknown): PreviousTune {
  const r = (raw ?? {}) as any;
  const air = finiteOrNull(r.fork?.air_pressure_bar);
  return {
    fork: {
      comp_clicks: finiteOrNull(r.fork?.comp_clicks),
      reb_clicks: finiteOrNull(r.fork?.reb_clicks),
      ...(air !== null ? { air_pressure_bar: air } : {}),
    },
    shock: {
      lsc_clicks: finiteOrNull(r.shock?.lsc_clicks),
      hsc_turns: finiteOrNull(r.shock?.hsc_turns),
      reb_clicks: finiteOrNull(r.shock?.reb_clicks),
      sag_mm: finiteOrNull(r.shock?.sag_mm),
    },
    detected: r.detected && typeof r.detected === "object" ? { has_air_fork: !!r.detected.has_air_fork, fork_family: typeof r.detected.fork_family === "string" ? r.detected.fork_family : undefined } : undefined,
  };
}

/** sanitizeConditions — whitelist the conditions input; undefined when absent
 *  or empty, so a legacy caller never reaches the conditions stage. */
export function sanitizeConditions(raw: unknown): Tune2Conditions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as any;
  const SURFACES = new Set(["hardpack", "loam", "sand", "mud"]);
  const surfaces = Array.isArray(r.surfaces) ? r.surfaces.filter((x: unknown) => typeof x === "string" && SURFACES.has(x)) : [];
  const state = ["fresh", "choppy", "rutted"].includes(r.state) ? r.state : null;
  const temp_band = ["cold", "mild", "hot"].includes(r.temp_band) ? r.temp_band : null;
  const watered = typeof r.watered === "boolean" ? r.watered : null;
  let retune: Tune2Conditions["retune"] = null;
  if (r.retune && typeof r.retune === "object" && ["watered", "roughed", "heating"].includes(r.retune.tile)) {
    const prior = Array.isArray(r.retune.prior_tweaks)
      ? r.retune.prior_tweaks
          .filter((t: any) => t && typeof t.circuit === "string" && Number.isFinite(Number(t.delta)))
          .map((t: any) => ({ circuit: t.circuit, delta: Number(t.delta) }))
      : [];
    retune = { tile: r.retune.tile, prior_tweaks: prior };
  }
  if (!surfaces.length && !state && !temp_band && watered === null && !retune) return undefined;
  return { surfaces, state, temp_band, watered, retune };
}

/** sanitizeLastOutcome — whitelist/clamp the optional adaptive-step input. */
export function sanitizeLastOutcome(raw: unknown): Tune2LastOutcome | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as any;
  if (!["improved", "same", "worse"].includes(r.outcome)) return undefined;

  const symptoms: SymptomId[] = Array.isArray(r.symptoms)
    ? r.symptoms.filter((id: unknown) =>
        KNOWN_SYMPTOM_IDS.has(id as SymptomId)
      )
    : [];

  const deltas: Tune2LastOutcome["deltas"] = {};
  if (r.deltas && typeof r.deltas === "object") {
    for (const key of ["fork_comp", "fork_reb", "shock_lsc", "shock_reb", "shock_hsc"] as ClickCircuit[]) {
      const v = Number(r.deltas[key]);
      if (Number.isFinite(v) && v !== 0) {
        deltas[key] = clampFloat(v, -10, 10);
      }
    }
  }

  if (!symptoms.length || !Object.keys(deltas).length) return undefined;
  return { outcome: r.outcome, symptoms, deltas };
}

/* --------------------------- Conditions stage (contract v3) --------------------------- */
// The ride day's conditions rule base, ported rule for rule from
// lib/conditionsRules.ts (todaysSetupRules + retuneRules) and parity-tested
// against it. Clicks out from closed: + = softer/faster, - = firmer/slower.

export type ConditionsDelta = { circuit: Circuit; delta: number; reason: string; label: string };

export function conditionsRuleDeltas(
  c: Tune2Conditions,
  effective: Record<Circuit, CircuitValue>,
  hasAirFork: boolean
): { deltas: ConditionsDelta[]; tirePsiDelta: number } {
  const has = (k: Circuit) => typeof effective[k] === "number";

  if (c.retune?.tile) {
    const deltas: ConditionsDelta[] = [];
    let tirePsiDelta = 0;
    const tile = c.retune.tile;
    const prior = Array.isArray(c.retune.prior_tweaks) ? c.retune.prior_tweaks : [];
    if (tile === "watered") {
      const softened = prior.find((t) => t.circuit === "fork_comp" && typeof t.delta === "number" && t.delta > 0);
      if (softened && has("fork_comp")) {
        deltas.push({ circuit: "fork_comp", delta: -softened.delta, reason: "Fresh water means grip. Take back the morning's chop softening.", label: "just watered" });
      }
      tirePsiDelta = -0.5;
    } else if (tile === "roughed") {
      if (has("fork_comp")) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Braking and acceleration bumps forming: a click firmer fork comp holds it up. Rebound stays.", label: "roughed up" });
    } else if (tile === "heating") {
      if (hasAirFork && has("fork_air")) deltas.push({ circuit: "fork_air", delta: -0.1, reason: "Fork's warming up and pressure climbs with it. Bleed 0.1 bar.", label: "heating up" });
      else if (has("fork_comp")) deltas.push({ circuit: "fork_comp", delta: -1, reason: "Hot oil damps less. A click firmer makes up the difference.", label: "heating up" });
    }
    return { deltas, tirePsiDelta };
  }

  const surface = Array.isArray(c.surfaces) ? c.surfaces[0] ?? null : null;
  const deltas: ConditionsDelta[] = [];
  const push = (d: ConditionsDelta) => {
    if (deltas.length < 2 && has(d.circuit) && !deltas.some((x) => x.circuit === d.circuit)) deltas.push(d);
  };
  if (surface === "hardpack" && c.state === "choppy") {
    push({ circuit: "fork_comp", delta: 1, reason: "Choppy hardpack: a click softer keeps the fork moving over the chop.", label: "choppy hardpack" });
  } else if (surface === "hardpack" && c.state === "rutted") {
    push({ circuit: "fork_reb", delta: 1, reason: "Rutted hardpack: a click faster rebound so the front recovers between ruts.", label: "rutted hardpack" });
  } else if (surface === "sand" || (surface === "loam" && c.state !== "fresh")) {
    const label = surface === "sand" ? "sand" : "deep loam";
    push({ circuit: "fork_comp", delta: -1, reason: `${surface === "sand" ? "Sand" : "Deep loam"} loads the fork: a click firmer holds it up.`, label });
    push({ circuit: "fork_reb", delta: -1, reason: "A click slower rebound keeps the front planted in the soft stuff.", label });
  } else if (surface === "mud") {
    push({ circuit: "fork_comp", delta: -2, reason: "Mud: two clicks firmer. Bigger change on purpose; back it off once it dries.", label: "mud" });
  }
  if (c.temp_band === "hot") {
    if (hasAirFork && has("fork_air")) push({ circuit: "fork_air", delta: -0.2, reason: "Heat raises air pressure as the fork warms. Start 0.2 bar lower.", label: "heat" });
    else push({ circuit: "shock_lsc", delta: -1, reason: "Heat thins the oil and drops damping. A click firmer on the shock makes up for it.", label: "heat" });
  } else if (c.temp_band === "cold") {
    if (hasAirFork && has("fork_air")) push({ circuit: "fork_air", delta: 0.1, reason: "Cold air reads low. Start 0.1 bar higher so the fork holds up.", label: "cold" });
  }
  const tirePsiDelta = c.watered ? -0.5 : 0;
  return { deltas, tirePsiDelta };
}

/* --------------------------- Tune Two engine (mode: tune2_v1) --------------------------- */

export function buildTuneTwo(input: Tune2Input): Partial<Tune2Result> {
  const prev = input.previous;

  // Start from the previous tune. A circuit the setup never recorded is null
  // and stays null (contract v3, honest previous values): nothing is invented
  // and no contribution can move it.
  const prevOf: Record<Circuit, CircuitValue> = {
    fork_comp: finiteOrNull(prev.fork?.comp_clicks),
    fork_reb: finiteOrNull(prev.fork?.reb_clicks),
    shock_lsc: finiteOrNull(prev.shock?.lsc_clicks),
    shock_reb: finiteOrNull(prev.shock?.reb_clicks),
    shock_hsc: finiteOrNull(prev.shock?.hsc_turns),
    fork_air: finiteOrNull(prev.fork?.air_pressure_bar),
  };
  const known = (c: Circuit) => prevOf[c] !== null;
  let air: number | undefined = prevOf.fork_air ?? undefined;
  const sag = finiteOrNull(prev.shock?.sag_mm); // keep sag constant in Tune Two (for now)

  const fb = input.feedback;
  const symptoms = fb?.symptoms ?? [];

  // ---- Scale aggressiveness based on overall rating ----
  const overall = clampInt(fb?.overall_rating ?? 6, 1, 10);

  let globalScale = 1;
  if (overall >= 9) globalScale = 0.4; // almost perfect → micro moves
  else if (overall >= 7) globalScale = 0.7;
  else if (overall >= 5) globalScale = 1.0;
  else if (overall >= 3) globalScale = 1.3;
  else globalScale = 1.5; // really bad → bigger moves (still safe)

  // ---- Contract v3: the conditions stage ----
  const cond = input.conditions ? conditionsRuleDeltas(input.conditions, prevOf, air !== undefined) : null;

  const echo = (notes: string[]): Partial<Tune2Result> => ({
    fork: { comp_clicks: prevOf.fork_comp, reb_clicks: prevOf.fork_reb, air_pressure_bar: air },
    shock: {
      lsc_clicks: prevOf.shock_lsc,
      hsc_turns: prevOf.shock_hsc,
      reb_clicks: prevOf.shock_reb,
      sag_mm: sag,
    },
    detected: prev.detected,
    notes,
    ...(cond ? { tire_psi_delta: cond.tirePsiDelta } : {}),
  });

  if (!symptoms.length && !(cond && cond.deltas.length)) {
    if (cond) {
      return echo([
        "Nothing in today's conditions asks for a clicker change, so your setup stands.",
        ...(cond.tirePsiDelta ? [`Tires: ${fmtDelta(cond.tirePsiDelta)} psi front and rear for the water.`] : []),
      ]);
    }
    // No feedback – just echo previous tune with a gentle note
    return echo([
      "No specific issues were selected, so this Tune Two keeps your last settings.",
      "Next moto: pick where it felt off (braking bumps, whoops, landings, etc.) so we can make targeted changes.",
    ]);
  }

  // v2: accumulate per-circuit CONTRIBUTIONS instead of running sums, so
  // opposing symptoms can be resolved explicitly (Change 5).
  const contribs: Record<Circuit, Contribution[]> = {
    fork_comp: [],
    fork_reb: [],
    shock_lsc: [],
    shock_reb: [],
    shock_hsc: [],
    fork_air: [],
  };
  const symptomNotes: string[] = [];
  const conditionNotes: string[] = [];
  const unknownCircuits = new Set<Circuit>();

  const add = (
    circuit: Circuit,
    symptomId: SymptomId | "conditions",
    delta: number,
    severity: number
  ) => {
    if (delta === 0) return;
    if (!known(circuit)) {
      unknownCircuits.add(circuit);
      return;
    }
    contribs[circuit].push({
      symptomId,
      delta,
      severity: clampInt(severity || 5, 1, 10),
    });
  };

  if (cond) {
    for (const d of cond.deltas) {
      add(d.circuit, "conditions", d.delta, 5);
      conditionNotes.push(`Conditions: ${d.label} → ${fmtDelta(d.delta)} ${CIRCUIT_META[d.circuit].label}. ${d.reason}`);
    }
    if (cond.tirePsiDelta) conditionNotes.push(`Tires: ${fmtDelta(cond.tirePsiDelta)} psi front and rear for the water.`);
  }

  if (input.parsedAddedIds?.length) {
    const labels = input.parsedAddedIds
      .map((id) => SYMPTOM_LABELS[id])
      .filter(Boolean)
      .join(", ");
    symptomNotes.push(`From your written note, I also picked up: ${labels}.`);
  }

  const clickDeltaForSeverity = (sev: number) => {
    const s = clampInt(sev || 5, 1, 10);
    let base = 1;
    if (s <= 3) base = 1;
    else if (s <= 7) base = 2;
    else if (s <= 9) base = 3;
    else base = 4;

    const scaled = Math.round(base * globalScale);
    return clampInt(scaled, 1, 4);
  };

  const airDeltaForSeverity = (sev: number) => {
    const s = clampInt(sev || 5, 1, 10);
    let base = 0.05;
    if (s <= 3) base = 0.05;
    else if (s <= 7) base = 0.1;
    else if (s <= 9) base = 0.2;
    else base = 0.25;

    const scaled = base * globalScale;
    return clampFloat(scaled, 0.03, 0.3);
  };

  // Where-suffix helper for symptom+where combos that have NO special modifier
  // (Change 4: "the where still appears in that symptom's note").
  const whereSuffix = (s: Tune2Symptom) =>
    s.where ? ` (reported in ${s.where.replace(/_/g, " ")})` : "";

  // Reusable case bodies so where-modifiers can route between them (Change 4).
  const applyBottomsLandings = (s: Tune2Symptom, routedFrom?: SymptomId) => {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);
    const dLSC = Math.max(1, scale - 1);
    // HSC moves in quarter turns (decision 4; was 0.15 / 0.30).
    const dHSC = 0.25 * (scale >= 3 ? 2 : 1);
    add("shock_lsc", s.id, -dLSC, s.severity);
    add("shock_hsc", s.id, -dHSC, s.severity);
    if (air !== undefined) add("fork_air", s.id, airScale * 0.7, s.severity);
    if (routedFrom) {
      symptomNotes.push(
        `Harshness on landings is a bottoming problem → -${dLSC} shock LSC clicks (firmer) and -${dHSC.toFixed(
          2
        )} HSC turns.`
      );
    } else {
      symptomNotes.push(
        `Bottoming on landings / G-outs → -${dLSC} shock LSC clicks (firmer) and -${dHSC.toFixed(
          2
        )} HSC turns.${routedFrom ? "" : whereSuffix(s) && s.where !== "whoops" ? whereSuffix(s) : ""}`
      );
    }
    if (air !== undefined) {
      symptomNotes.push(
        `Also +${(airScale * 0.7).toFixed(
          2
        )} bar fork AER for more mid-stroke support.`
      );
    }
    // bottoms_landings + whoops → also slow the shock for whoop faces (Change 4)
    if (!routedFrom && s.where === "whoops") {
      add("shock_reb", s.id, -1, s.severity);
      symptomNotes.push(
        "Since the bottoming is in whoops → also -1 shock rebound click (slower on whoop faces)."
      );
    }
  };

  const applyFrontKnifes = (s: Tune2Symptom, routedFrom?: SymptomId, label = "Front knifing in corners") => {
    const scale = clickDeltaForSeverity(s.severity);
    const dComp = Math.max(1, scale - 1);
    add("fork_comp", s.id, -dComp, s.severity);
    add("fork_reb", s.id, 1, s.severity);
    if (routedFrom === "unstable_whoops") {
      symptomNotes.push(
        `Instability in corners points at the front end → -${dComp} fork compression clicks (firmer) and +1 fork rebound click for support.`
      );
    } else {
      symptomNotes.push(
        `${label} → -${dComp} fork compression clicks (firmer) and +1 fork rebound click for a touch more pop.`
      );
    }
  };

  const applyHarsh = (s: Tune2Symptom, label: string, routedAs: SymptomId) => {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);
    if (s.where === "landings" || s.where === "big_hits") {
      // Change 4: it's a bottoming complaint — route to bottoms logic.
      applyBottomsLandings(s, routedAs);
      return;
    }
    // Front is too stiff / spiky on small chop → soften comp, tiny air tweak
    add("fork_comp", s.id, scale, s.severity); // more clicks out = softer
    if (s.where === "corners") {
      // Change 4: weight softening toward fork comp only, skip the air tweak.
      symptomNotes.push(
        `Harsh into corners → +${scale} fork compression clicks (softer), leaving air pressure alone.`
      );
      return;
    }
    if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
    symptomNotes.push(
      `${label} → +${scale} fork compression clicks (softer).${
        air !== undefined
          ? ` Optionally -${airScale.toFixed(2)} bar AER.`
          : ""
      }${s.where === "whoops" ? "" : whereSuffix(s)}`
    );
    if (s.where === "whoops") {
      // Change 4: harshness in whoops → also soften the shock a touch.
      add("shock_lsc", s.id, 1, s.severity);
      symptomNotes.push(
        "Since it's harsh in the whoops → also +1 shock LSC click (softer)."
      );
    }
  };

  for (const s of symptoms) {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);

    switch (s.id) {
      /* ------------------------------ legacy ids ------------------------------ */
      case "harsh_braking_bumps": {
        applyHarsh(s, "Harsh on braking bumps", "harsh_braking_bumps");
        break;
      }
      case "deflects_in_chop": {
        // Front hunts side to side → rebound too fast → slower rebound
        add("fork_reb", s.id, -scale, s.severity); // fewer clicks = slower
        symptomNotes.push(
          `Front deflects in chop → -${scale} fork rebound clicks (slower to keep the tire planted).${whereSuffix(s)}`
        );
        break;
      }
      case "rear_kicks_accel": {
        // Rear kicking on throttle → rebound too fast
        add("shock_reb", s.id, -scale, s.severity);
        symptomNotes.push(
          `Rear kicks on acceleration chop → -${scale} shock rebound clicks (slower to stop kicking).${whereSuffix(s)}`
        );
        break;
      }
      case "bottoms_landings": {
        applyBottomsLandings(s);
        break;
      }
      case "front_knifes": {
        applyFrontKnifes(s);
        break;
      }
      case "dead_feel": {
        if (s.where === "corners") {
          // Change 4: fork-only version — skip the shock rebound change.
          add("fork_reb", s.id, scale, s.severity);
          add("fork_comp", s.id, -1, s.severity);
          symptomNotes.push(
            `Dead feel in corners → +${scale} fork rebound clicks (livelier front) with -1 fork comp click for support, leaving the shock alone.`
          );
          break;
        }
        // Bike feels glued / no pop → more rebound speed, a bit more support
        add("fork_reb", s.id, scale, s.severity);
        add("shock_reb", s.id, Math.max(1, scale - 1), s.severity);
        add("fork_comp", s.id, -1, s.severity);
        symptomNotes.push(
          `Bike feels dead / no pop → +${scale} fork rebound clicks and +${Math.max(
            1,
            scale - 1
          )} shock rebound clicks (faster), with -1 fork comp click for a bit more support.${whereSuffix(s)}`
        );
        break;
      }
      case "unstable_whoops": {
        if (s.where === "corners") {
          // Change 4: instability in corners → treat as front_knifes instead.
          applyFrontKnifes(s, "unstable_whoops");
          break;
        }
        // Unstable in whoops → more control (slower rebound)
        add("fork_reb", s.id, -scale, s.severity);
        add("shock_reb", s.id, -scale, s.severity);
        if (air !== undefined) add("fork_air", s.id, airScale * 0.4, s.severity);
        symptomNotes.push(
          `Unstable in whoops → -${scale} fork rebound clicks and -${scale} shock rebound clicks (slower for stability).${whereSuffix(s)}`
        );
        if (air !== undefined) {
          symptomNotes.push(
            `Slight +${(airScale * 0.4).toFixed(
              2
            )} bar AER to hold up in whoops.`
          );
        }
        break;
      }
      case "packs_whoops": {
        // Packing in whoops → rebound too slow → speed it up
        add("fork_reb", s.id, scale, s.severity);
        add("shock_reb", s.id, scale, s.severity);
        symptomNotes.push(
          `Packing in whoops → +${scale} fork rebound clicks and +${scale} shock rebound clicks (faster to avoid packing).${whereSuffix(s)}`
        );
        break;
      }
      case "harsh_square_edge": {
        // Sharp square-edge → comp too stiff
        const dLSC = Math.max(1, scale - 1);
        add("fork_comp", s.id, scale, s.severity);
        add("shock_lsc", s.id, dLSC, s.severity);
        symptomNotes.push(
          `Harsh on square-edge → +${scale} fork compression clicks (softer) and +${dLSC} shock LSC clicks for traction.${
            s.where === "corners" ? "" : whereSuffix(s)
          }`
        );
        if (s.where === "corners") {
          // Change 4: square-edge harshness in corners → add the front_knifes pop move.
          add("fork_reb", s.id, 1, s.severity);
          symptomNotes.push(
            "Since it's in corners → also +1 fork rebound click for a touch more front-end pop."
          );
        }
        break;
      }
      case "headshake": {
        // High-speed headshake → calm chassis (small clicks only)
        add("shock_reb", s.id, -1, s.severity);
        add("fork_reb", s.id, -1, s.severity);
        symptomNotes.push(
          "High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability."
        );
        break;
      }
      case "general_harsh": {
        // General harshness → small global softening
        const dComp = Math.max(1, scale - 1);
        add("fork_comp", s.id, dComp, s.severity);
        add("shock_lsc", s.id, 1, s.severity);
        if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
        symptomNotes.push(
          `General harshness → +${dComp} fork compression clicks (softer) and +1 shock LSC click.${whereSuffix(s)}`
        );
        if (air !== undefined) {
          symptomNotes.push(
            `Also -${(airScale * 0.5).toFixed(
              2
            )} bar AER for a touch more comfort.`
          );
        }
        break;
      }

      /* ------------------------------ v3 taxonomy ------------------------------ */
      // Rows marked SIGN-OFF are tuning authorship (2026-09-05) awaiting
      // River's per-row confirmation; the direction follows the legacy row
      // closest in meaning.
      case "harsh_small_bumps": {
        applyHarsh(s, "Harsh on small bumps", "harsh_small_bumps");
        break;
      }
      case "bottoming": {
        applyBottomsLandings(s);
        break;
      }
      case "front_pushes": {
        applyFrontKnifes(s, undefined, "Front pushes in corners");
        break;
      }
      case "deflects": {
        add("fork_reb", s.id, -scale, s.severity);
        symptomNotes.push(
          `Front deflects → -${scale} fork rebound clicks (slower to keep the tire planted).${whereSuffix(s)}`
        );
        break;
      }
      case "rear_kicks": {
        add("shock_reb", s.id, -scale, s.severity);
        const special = s.where === "jump_face" || s.where === "logs_ledges" || s.where === "braking_bumps";
        symptomNotes.push(
          `Rear kicks → -${scale} shock rebound clicks (slower to stop kicking).${special ? "" : whereSuffix(s)}`
        );
        if (s.where === "jump_face") {
          add("shock_hsc", s.id, -0.25, s.severity);
          symptomNotes.push("Since it kicks on jump faces → also -0.25 HSC turns to hold the rear up on the face.");
        } else if (s.where === "logs_ledges") {
          add("shock_lsc", s.id, 1, s.severity);
          symptomNotes.push("Since it kicks on logs and ledges → also +1 shock LSC click (softer) so the rear can absorb the edge.");
        } else if (s.where === "braking_bumps") {
          add("fork_reb", s.id, -1, s.severity);
          symptomNotes.push("Since it kicks in the braking bumps → also -1 fork rebound click to keep the front settled under braking.");
        }
        break;
      }
      case "packs_in_chop": {
        add("fork_reb", s.id, scale, s.severity);
        add("shock_reb", s.id, scale, s.severity);
        symptomNotes.push(
          `Packing in chop → +${scale} fork rebound clicks and +${scale} shock rebound clicks (faster to avoid packing).${
            s.where === "rocks" ? "" : whereSuffix(s)
          }`
        );
        if (s.where === "rocks") {
          add("fork_comp", s.id, 1, s.severity);
          symptomNotes.push("Since it packs in the rocks → also +1 fork compression click (softer) for the sharp hits.");
        }
        break;
      }
      case "wallows_dives": {
        // SIGN-OFF: under-damped compression → firmer front, a click firmer LSC.
        const dComp = Math.max(1, scale - 1);
        add("fork_comp", s.id, -dComp, s.severity);
        add("shock_lsc", s.id, -1, s.severity);
        symptomNotes.push(
          `Wallowing / diving → -${dComp} fork compression clicks (firmer) and -1 shock LSC click for hold-up.${whereSuffix(s)}`
        );
        break;
      }
      case "rear_swaps": {
        // SIGN-OFF: the rear steps out → softer LSC for traction, a click slower rebound.
        add("shock_lsc", s.id, scale, s.severity);
        add("shock_reb", s.id, -1, s.severity);
        symptomNotes.push(
          `Rear swaps → +${scale} shock LSC clicks (softer for traction) and -1 shock rebound click to settle it.${whereSuffix(s)}`
        );
        break;
      }
      case "rear_squats": {
        // SIGN-OFF: squats on the gas → firmer LSC, a quarter turn of HSC when it is bad.
        const dLSC = Math.max(1, scale - 1);
        add("shock_lsc", s.id, -dLSC, s.severity);
        if (scale >= 3) add("shock_hsc", s.id, -0.25, s.severity);
        symptomNotes.push(
          `Rear squats on the gas → -${dLSC} shock LSC clicks (firmer)${scale >= 3 ? " and -0.25 HSC turns" : ""}.${whereSuffix(s)}`
        );
        break;
      }
      case "too_stiff": {
        // Mirrors general_harsh.
        const dComp = Math.max(1, scale - 1);
        add("fork_comp", s.id, dComp, s.severity);
        add("shock_lsc", s.id, 1, s.severity);
        if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
        symptomNotes.push(
          `Too stiff → +${dComp} fork compression clicks (softer) and +1 shock LSC click.${whereSuffix(s)}`
        );
        if (air !== undefined) symptomNotes.push(`Also -${(airScale * 0.5).toFixed(2)} bar AER for a touch more comfort.`);
        break;
      }
      case "too_soft": {
        // SIGN-OFF: the mirror of too_stiff.
        const dComp = Math.max(1, scale - 1);
        add("fork_comp", s.id, -dComp, s.severity);
        add("shock_lsc", s.id, -1, s.severity);
        if (air !== undefined) add("fork_air", s.id, airScale * 0.5, s.severity);
        symptomNotes.push(
          `Too soft → -${dComp} fork compression clicks (firmer) and -1 shock LSC click.${whereSuffix(s)}`
        );
        if (air !== undefined) symptomNotes.push(`Also +${(airScale * 0.5).toFixed(2)} bar AER for more hold-up.`);
        break;
      }
      case "arm_pump": {
        // SIGN-OFF: comfort first: softer comp, a click faster rebound, a touch less air.
        add("fork_comp", s.id, scale, s.severity);
        add("fork_reb", s.id, 1, s.severity);
        if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
        symptomNotes.push(
          `Arm pump → +${scale} fork compression clicks (softer) and +1 fork rebound click so the front stops hammering your hands.${whereSuffix(s)}`
        );
        if (air !== undefined) symptomNotes.push(`Also -${(airScale * 0.5).toFixed(2)} bar AER for comfort.`);
        break;
      }
      case "chatters": {
        // SIGN-OFF: chatter = rebound too fast plus a spiky front: slower rebound, a click softer comp.
        add("fork_reb", s.id, -scale, s.severity);
        add("fork_comp", s.id, 1, s.severity);
        symptomNotes.push(
          `Chatter → -${scale} fork rebound clicks (slower) and +1 fork compression click (softer) to settle the front.${whereSuffix(s)}`
        );
        break;
      }
    }
  }

  // ---- Change 5: per-circuit conflict resolution (replaces silent summing) ----
  const conflictNotes: string[] = [];
  const resolved: Record<Circuit, number> = {
    fork_comp: 0,
    fork_reb: 0,
    shock_lsc: 0,
    shock_reb: 0,
    shock_hsc: 0,
    fork_air: 0,
  };

  for (const circuit of Object.keys(contribs) as Circuit[]) {
    const list = contribs[circuit];
    if (!list.length) continue;

    const pos = list.filter((c) => c.delta > 0);
    const neg = list.filter((c) => c.delta < 0);

    if (!pos.length || !neg.length) {
      // All contributions agree in sign → sum as before.
      resolved[circuit] = list.reduce((acc, c) => acc + c.delta, 0);
      continue;
    }

    // Opposing signs: highest severity wins direction; magnitude shrinks by
    // the largest opposing pull, never below one adjustment unit.
    const winner = [...list].sort(
      (a, b) =>
        b.severity - a.severity || Math.abs(b.delta) - Math.abs(a.delta)
    )[0];
    const opposers = winner.delta > 0 ? neg : pos;
    const largestOpposer = [...opposers].sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
    )[0];

    const unit = CIRCUIT_META[circuit].unit;
    const magnitude = Math.max(
      unit,
      Math.abs(winner.delta) - Math.abs(largestOpposer.delta)
    );
    resolved[circuit] = Math.sign(winner.delta) * magnitude;

    conflictNotes.push(
      `You reported both ${SYMPTOM_LABELS[largestOpposer.symptomId]} and ${
        SYMPTOM_LABELS[winner.symptomId]
      }, which pull ${CIRCUIT_META[circuit].label} opposite ways — ${
        SYMPTOM_LABELS[winner.symptomId]
      } was worse, so I prioritized it with a smaller step.`
    );
  }

  // ---- Change 6a: protect pass ----
  const protectNotes: string[] = [];
  const protectedCircuits = new Set<Circuit>(); // fully zeroed OR capped — adaptive skips both
  const handledCircuits = new Set<Circuit>();

  for (const area of input.protectedAreas ?? []) {
    for (const circuit of PROTECT_MAP[area] ?? []) {
      if (handledCircuits.has(circuit)) continue;
      handledCircuits.add(circuit);
      protectedCircuits.add(circuit);

      const current = resolved[circuit];
      if (current === 0) continue; // nothing to zero → no note

      const circuitContribs = contribs[circuit];
      const topSeverity = Math.max(
        0,
        ...circuitContribs.map((c) => c.severity)
      );

      if (topSeverity >= 8) {
        // A severe symptom demands this circuit → cap at ±1 unit instead of zero.
        const unit = CIRCUIT_META[circuit].unit;
        const capped = Math.sign(current) * Math.min(Math.abs(current), unit);
        resolved[circuit] = capped;
        const demanding = circuitContribs
          .filter((c) => c.severity >= 8)
          .map((c) => SYMPTOM_LABELS[c.symptomId])[0];
        protectNotes.push(
          `You asked me to keep ${AREA_LABELS[area]} as-is, but ${demanding} really needs ${CIRCUIT_META[circuit].label} — capping that change at ${fmtDelta(capped)} instead of skipping it.`
        );
      } else {
        resolved[circuit] = 0;
        protectNotes.push(
          `Left ${CIRCUIT_META[circuit].label} alone — you said it was working.`
        );
      }
    }
  }

  // ---- Change 6b: adaptive step from last outcome ----
  const adaptiveNotes: string[] = [];
  const lo = input.lastOutcome;
  if (lo && lo.outcome !== "improved") {
    for (const key of Object.keys(lo.deltas) as ClickCircuit[]) {
      const lastDelta = lo.deltas[key];
      if (!lastDelta || !CIRCUIT_META[key]) continue;
      // Protection outranks history — never re-touch a protected circuit here.
      if (protectedCircuits.has(key)) continue;
      // Only when this feedback re-reports a symptom the last refinement addressed,
      // and that symptom pulls on this circuit this round.
      const reReported = contribs[key].some((c) =>
        c.symptomId !== "conditions" && lo.symptoms.includes(c.symptomId)
      );
      if (!reReported) continue;

      const label = CIRCUIT_META[key].label;
      if (lo.outcome === "worse") {
        resolved[key] = -lastDelta;
        adaptiveNotes.push(
          `Heads up: last time we moved ${label} by ${fmtDelta(
            lastDelta
          )} and it felt WORSE — reversing that this round (${fmtDelta(
            -lastDelta
          )}).`
        );
      } else if (lo.outcome === "same" && resolved[key] !== 0) {
        const unit = CIRCUIT_META[key].unit;
        resolved[key] += Math.sign(resolved[key]) * unit;
        adaptiveNotes.push(
          `${label[0].toUpperCase()}${label.slice(1)} didn't change the feel last time, so I'm taking a slightly bigger step this round.`
        );
      }
    }
  }

  // ---- Existing total clamps so we never go wild in one step ----
  const dForkComp = clampInt(resolved.fork_comp, -4, 4);
  const dForkReb = clampInt(resolved.fork_reb, -4, 4);
  const dShockLSC = clampInt(resolved.shock_lsc, -4, 4);
  const dShockReb = clampInt(resolved.shock_reb, -4, 4);
  const dShockHSC = clampFloat(resolved.shock_hsc, -0.5, 0.5);
  const dAir = clampFloat(resolved.fork_air, -0.3, 0.3);

  // Apply deltas (a null circuit stays null: nothing was contributed to it)
  const applied = (c: Circuit, d: number): CircuitValue => (known(c) ? (prevOf[c] as number) + d : null);
  const forkComp = applied("fork_comp", dForkComp);
  const forkReb = applied("fork_reb", dForkReb);
  const shockLSC = applied("shock_lsc", dShockLSC);
  const shockReb = applied("shock_reb", dShockReb);
  // HSC lands on a quarter turn when it moves (decision 4); untouched stays.
  const shockHSC = dShockHSC !== 0 && known("shock_hsc") ? quarterTurns((prevOf.shock_hsc as number) + dShockHSC) : applied("shock_hsc", dShockHSC);
  if (air !== undefined) {
    air += dAir;
  }

  // Tailored summary based on bike / terrain / selected issues / goals
  const humanSymptoms = Array.from(
    new Set(
      symptoms
        .map((s) => SYMPTOM_LABELS[s.id as SymptomId])
        .filter(Boolean)
    )
  );

  const bikeStr =
    [input.year, input.make, input.model].filter(Boolean).join(" ") ||
    "your bike";
  const terrainStr = input.terrain || "today's terrain";

  const goalsArr = input.rider?.goals ?? [];
  const goalsStr =
    goalsArr.length > 0 ? `Goals: ${goalsArr.join(", ")}.` : undefined;

  const issuesPart = humanSymptoms.length
    ? `small changes for ${humanSymptoms.join(", ")}${cond && cond.deltas.length ? " and today's conditions" : ""}.`
    : cond && cond.deltas.length
      ? "small changes for today's conditions."
      : "small changes based on your feedback.";

  const summary: string[] = [
    `Tune Two for ${bikeStr} on ${terrainStr}: ${issuesPart}`,
    "Re-test on the same section for 3–5 laps. If a symptom gets worse, go back 2 clicks in that direction.",
  ];
  if (goalsStr) summary.push(goalsStr);

  const unknownNotes = [...unknownCircuits].map((c) => {
    const label = CIRCUIT_META[c].label;
    return `${label[0].toUpperCase()}${label.slice(1)} has no saved value on this setup, so I left it. Set it once and I can move it next time.`;
  });

  // Notes priority when trimming to 12 (safeShape slices): summary first, then
  // adaptive/protect/conflict decisions, then conditions, then routine
  // per-symptom notes, then the circuits that could not be moved.
  const notes = [
    ...summary,
    ...adaptiveNotes,
    ...protectNotes,
    ...conflictNotes,
    ...conditionNotes,
    ...symptomNotes,
    ...unknownNotes,
  ];

  const out: Partial<Tune2Result> = {
    fork: {
      comp_clicks: forkComp,
      reb_clicks: forkReb,
      air_pressure_bar: air,
    },
    shock: {
      lsc_clicks: shockLSC,
      hsc_turns: shockHSC,
      reb_clicks: shockReb,
      sag_mm: sag,
    },
    detected: prev.detected,
    notes,
    ...(cond ? { tire_psi_delta: cond.tirePsiDelta } : {}),
  };

  return out;
}

/* ------------------- Auth + rate limiting (Change 1) ------------------- */

const RATE_LIMIT_USER_PER_HOUR = 20; // authenticated users, all modes
const RATE_LIMIT_ANON_PER_HOUR = 10; // anon-key callers, baseline only
const RATE_WINDOW_MS = 60 * 60 * 1000;

export type HandlerDeps = {
  /** Resolve the calling user's id from the request, or null for anon-key/invalid. */
  getUserId: (req: Request) => Promise<string | null>;
  /** Count this caller's ai-tune calls in the last hour. null = infra failure (fail-open). */
  countRecentCalls: (key: { userId?: string; ip?: string }) => Promise<number | null>;
  /** Record this call for future rate-limit windows. Must never throw.
   *  Returns the inserted tune_calls id so the output can be attached after
   *  generation (void-returning test fakes read as "no id"). */
  recordCall: (row: {
    userId: string | null;
    ip: string | null;
    mode: string;
    // Optional so pre-existing test fakes keep compiling; null for
    // authenticated callers and for anon callers that sent no/garbage id.
    anonId?: string | null;
    // v2.4.0 data capture — the full validated request input, the promoted
    // rider weight, and the matched bike_models id (all optional for the
    // same fake-compat reason).
    input?: unknown;
    riderWeightLbs?: number | null;
    bikeModelId?: string | null;
  }) => Promise<number | null | void>;
  /** Attach the generated tune to the tune_calls row after a successful
   *  generation. Optional (test fakes omit it); must never throw. */
  recordOutput?: (callId: number, output: unknown) => Promise<void>;
  /** Parse free-text feedback (Change 2). null = skip (fail-open). */
  parseFreeText: (text: string) => Promise<unknown | null>;
  /** Does this bike_models id exist? (decision 2, 2026-09-05). false =
   *  reject the request before any insert; null = lookup infra failure, the
   *  id is dropped (never stored) and the call proceeds. */
  modelExists: (modelId: string) => Promise<boolean | null>;
  /** The per-bike baseline rule (decision 3, 2026-09-05): server_claim_baseline.
   *  null = infra failure (fail-open with a loud log, the function's precedent). */
  claimBaseline: (userId: string, bikeId: string | null) => Promise<ClaimOutcome | null>;
  /** Exact inverse of a consumed server claim, after a generation throw. */
  refundClaim: (userId: string) => Promise<void>;
};

export type ClaimOutcome = {
  ok: boolean;
  reason: "pro" | "regenerate" | "regenerate_limit" | "first_baseline" | "client_claimed" | "claimed" | "no_trial" | string;
  /** This call consumed a credit (refund it if generation throws). */
  claimed?: boolean;
  regenerates_today?: number;
  limit?: number;
};

// deno-lint-ignore no-explicit-any
let _anonClient: any = null;
function getAnonClient() {
  if (!_anonClient) {
    _anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return _anonClient;
}

// deno-lint-ignore no-explicit-any
let _serviceClient: any = null;
function getServiceClient() {
  if (!_serviceClient) {
    _serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _serviceClient;
}

export const defaultDeps: HandlerDeps = {
  getUserId: async (req) => {
    try {
      const token = (req.headers.get("Authorization") ?? "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (!token) return null;
      // The anon key is itself a valid JWT but carries no user — getUser()
      // rejects it, which is exactly the "anon key alone doesn't count" rule.
      const { data, error } = await getAnonClient().auth.getUser(token);
      if (error || !data?.user?.id) return null;
      return data.user.id;
    } catch {
      return null;
    }
  },

  countRecentCalls: async ({ userId, ip }) => {
    try {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      let q = getServiceClient()
        .from("tune_calls")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since);
      q = userId ? q.eq("user_id", userId) : q.eq("ip", ip ?? "unknown");
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    } catch (e) {
      // Fail-open: a rate-limit infra hiccup must not take tuning down.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("rate-limit count failed (fail-open):", msg.slice(0, 160));
      return null;
    }
  },

  // Throws on failure (decision 2, 2026-09-05): a call whose row cannot be
  // written is NOT served. Swallowing the error used to leave the call
  // uncounted by the rate limit and uncaptured, and a caller could induce
  // the failure with a bad bike_model_id foreign key.
  recordCall: async ({ userId, ip, mode, anonId, input, riderWeightLbs, bikeModelId }) => {
    const { data, error } = await getServiceClient()
      .from("tune_calls")
      .insert({
        user_id: userId,
        ip,
        mode,
        anon_id: anonId ?? null,
        input: input ?? null,
        rider_weight_lbs: riderWeightLbs ?? null,
        bike_model_id: bikeModelId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return typeof data?.id === "number" ? data.id : null;
  },

  modelExists: async (modelId) => {
    try {
      const { data, error } = await getServiceClient()
        .from("bike_models")
        .select("id")
        .eq("id", modelId)
        .maybeSingle();
      if (error) throw error;
      return !!data?.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("bike_models lookup failed (id dropped):", msg.slice(0, 160));
      return null;
    }
  },

  claimBaseline: async (userId, bikeId) => {
    const { data, error } = await getServiceClient().rpc("server_claim_baseline", {
      p_user_id: userId,
      p_bike_id: bikeId,
    });
    if (error) {
      // Fail-open with a loud log (this runs as service role, so a caller
      // cannot induce the failure; blocking paying riders on an infra blip is
      // worse than one uncounted tune).
      console.error("server_claim_baseline failed (fail-open):", String(error.message ?? error).slice(0, 160));
      return null;
    }
    return (data ?? null) as ClaimOutcome | null;
  },

  refundClaim: async (userId) => {
    try {
      const { error } = await getServiceClient().rpc("server_refund_free_tune", { p_user_id: userId });
      if (error) console.error("server refund failed:", String(error.message ?? error).slice(0, 160));
    } catch (e) {
      console.error("server refund threw:", e instanceof Error ? e.message : String(e));
    }
  },

  recordOutput: async (callId, output) => {
    try {
      const { error } = await getServiceClient()
        .from("tune_calls")
        .update({ output })
        .eq("id", callId);
      if (error) throw error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("tune_calls output update failed:", msg.slice(0, 160));
    }
  },

  parseFreeText: (text) => callParseFeedback(text),
};

/* ---------------- Baseline gate: the per-bike rule (decision 3, 2026-09-05) ---------------- */
// Guests (anon-key, zero_baseline only) pass: guest onboarding depends on it,
// bounded by the per-IP hourly limit. tune2_v1 is authenticated-only and has
// no credit gate (refining a saved setup was never Pro-gated server-side).
// Signed-in baseline callers go through server_claim_baseline (migration
// 20260906110000), which decides pro / regenerate (capped per rolling day) /
// first_baseline / legacy credit, and absorbs the old client-claim grace
// window as its double-consume guard. The gate runs BEFORE the tune_calls
// insert so a rejected call is neither counted nor captured, and
// independently of the hourly abuse limit above it.

type CreditDecision =
  | { allow: true; serverClaimed: boolean }
  | { allow: false; status: number; error: string; reason: string };

function decideBaselineCredit(outcome: ClaimOutcome | null): CreditDecision {
  if (!outcome) return { allow: true, serverClaimed: false }; // infra fail-open (logged by the dep)
  if (outcome.ok) return { allow: true, serverClaimed: outcome.claimed === true };
  if (outcome.reason === "regenerate_limit") {
    const limit = outcome.limit ?? 5;
    return {
      allow: false,
      status: 429,
      reason: "regenerate_limit",
      error: `${limit} baseline updates a day is the cap for this bike. It resets tomorrow.`,
    };
  }
  return { allow: false, status: 402, reason: "no_trial", error: "no_trial" };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function callerIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// Strict uuid gate for the client-supplied anon_id — anything else (including
// the app's legacy "1783553470201_…" local ids) must never reach the uuid
// column.
const ANON_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function anonIdFrom(body: ZeroInput, userId: string | null): string | null {
  if (userId) return null; // authenticated rows are already attributed
  const raw = body.anon_id;
  return typeof raw === "string" && ANON_ID_RE.test(raw)
    ? raw.toLowerCase()
    : null;
}

/* ------------------ v2.4.0 data capture (tune_calls) ------------------ */

function riderWeightFrom(body: ZeroInput): number | null {
  const w = body.input?.rider?.weight_lbs;
  return typeof w === "number" && Number.isFinite(w) ? Math.round(w) : null;
}

// Strict uuid gate for the baseline's bike id (decision 3): the per-bike rule
// keys on it; guest/local ids never reach the RPC.
function bikeIdFrom(body: ZeroInput): string | null {
  const raw = (body.input as { bike_id?: unknown })?.bike_id;
  return typeof raw === "string" && ANON_ID_RE.test(raw) ? raw.toLowerCase() : null;
}

// Same strict uuid gate as anon_id: tune_calls.bike_model_id is a uuid FK,
// so anything else must never reach it.
function bikeModelIdFrom(body: ZeroInput): string | null {
  const raw = body.input?.model_id;
  return typeof raw === "string" && ANON_ID_RE.test(raw)
    ? raw.toLowerCase()
    : null;
}

// input.location is stored (tune_calls.input), never used by generation.
// Normalize in place: a well-formed fix is reduced to exactly
// {lat, lng, accuracy_m}; anything malformed loses the key entirely.
function sanitizeLocation(body: ZeroInput): void {
  const input = body.input as { location?: unknown };
  if (input.location === undefined) return;
  const loc = input.location as
    | { lat?: unknown; lng?: unknown; accuracy_m?: unknown }
    | null;
  const lat = loc?.lat;
  const lng = loc?.lng;
  const valid =
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!valid) {
    delete input.location;
    return;
  }
  const acc = loc?.accuracy_m;
  input.location = {
    lat,
    lng,
    accuracy_m:
      typeof acc === "number" && Number.isFinite(acc) ? acc : null,
  };
}

/* ------------------------------ Handler ------------------------------ */

export function makeHandler(deps: HandlerDeps = defaultDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    try {
      const body = (await req.json().catch(() => null)) as ZeroInput | null;
      if (!body || !body.input) {
        return jsonResponse({ error: "Bad request" }, 400);
      }
      // Before recordCall stores body.input: malformed location never lands.
      sanitizeLocation(body);

      const mode = body.mode ?? "zero_baseline_v1";

      // ---------------- Change 1: server-side auth ----------------
      // tune2_v1 requires a real authenticated user; zero_baseline_v1 permits
      // anon-key callers (guest onboarding depends on it).
      const userId = await deps.getUserId(req);
      if (mode === "tune2_v1" && !userId) {
        return jsonResponse({ error: "Sign in to refine your tune." }, 401);
      }

      // ---------------- Change 1: abuse rate limit ----------------
      const ip = callerIp(req);
      const limit = userId ? RATE_LIMIT_USER_PER_HOUR : RATE_LIMIT_ANON_PER_HOUR;
      const recent = await deps.countRecentCalls(
        userId ? { userId } : { ip }
      );
      if (recent !== null && recent >= limit) {
        return jsonResponse(
          {
            error:
              "You've hit the hourly tune limit — take a breather and try again in a bit.",
          },
          429
        );
      }
      // ---------------- baseline gate: the per-bike rule (decision 3) ----------------
      // Before the insert: a rejected call is not recorded and never counts
      // as a regenerate.
      let serverClaimedCredit = false;
      if (mode !== "tune2_v1" && userId) {
        const decision = decideBaselineCredit(await deps.claimBaseline(userId, bikeIdFrom(body)));
        if (!decision.allow) {
          return jsonResponse({ error: decision.error, reason: decision.reason }, decision.status);
        }
        serverClaimedCredit = decision.serverClaimed;
      }

      // ---------------- model_id: catalog existence (decision 2) ----------------
      // bike_model_id is a foreign key. An unknown id used to fail the insert,
      // which was swallowed, which left the call uncounted: a rate-limit bypass.
      // Validate first; reject unknown ids; drop the id on a lookup blip.
      let bikeModelId = bikeModelIdFrom(body);
      if (bikeModelId) {
        const exists = await deps.modelExists(bikeModelId);
        if (exists === false) {
          return jsonResponse({ error: "invalid_model_id" }, 400);
        }
        if (exists === null) bikeModelId = null;
      }

      // The insert stays HERE (before generation) so rate-limit counting is
      // unchanged; the generated tune is attached to the row afterwards via
      // recordOutput. `input` is body.input verbatim — top-level mode/anon_id
      // are excluded (already dedicated columns) and ip never enters the body.
      // A failed insert ABORTS the call (never swallowed): an unrecorded call
      // would be invisible to the rate limit and to capture.
      let callId: number | null = null;
      try {
        const recordedId = await deps.recordCall({
          userId: userId ?? null,
          ip: userId ? null : ip,
          mode,
          anonId: anonIdFrom(body, userId),
          input: body.input,
          riderWeightLbs: riderWeightFrom(body),
          bikeModelId,
        });
        callId = typeof recordedId === "number" ? recordedId : null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("tune_calls insert failed, call aborted:", msg.slice(0, 160));
        return jsonResponse(
          { error: "Couldn't record this tune. Try again in a moment." },
          503
        );
      }

      // ------------------------ MODE: Tune Two (feedback refinement) ------------------------
      if (mode === "tune2_v1") {
        const raw = body.input as any;

        if (!raw.previous || !raw.feedback) {
          return jsonResponse(
            { error: "Tune Two requires 'previous' tune and 'feedback'." },
            400
          );
        }

        // ---- Change 2: free-text parse stage (fail-open) ----
        const freeText =
          typeof raw.feedback?.free_text === "string"
            ? raw.feedback.free_text.trim()
            : "";
        let parsed: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } | null =
          null;
        if (freeText.length > 0) {
          // Fail-open even if the parse dep itself throws.
          const rawParsed = await deps.parseFreeText(freeText).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("free-text parse dep failed (fail-open):", msg.slice(0, 160));
            return null;
          });
          parsed = rawParsed ? sanitizeParsedFeedback(rawParsed) : null;
        }

        // ---- Change 3: merge (explicit chips win) ----
        const merged = mergeFeedback(raw.feedback as Tune2Feedback, parsed);

        // Contract v3: a conditions ask has no symptoms of its own and never
        // runs the adaptive step against the bike's last outcome.
        const feedbackSource = raw.feedback?.source;
        const isConditionsAsk = feedbackSource === "conditions";

        const tune2Input: Tune2Input = {
          make: raw.make,
          model: raw.model,
          year: raw.year,
          terrain: raw.terrain,
          track: raw.track,
          rider: raw.rider,
          previous: sanitizePrevious(raw.previous),
          feedback: {
            ...(raw.feedback as Tune2Feedback),
            symptoms: merged.symptoms,
          },
          guardrails: raw.guardrails,
          protectedAreas: merged.protectedAreas,
          lastOutcome: isConditionsAsk ? undefined : sanitizeLastOutcome(raw.last_outcome),
          parsedAddedIds: merged.parsedAddedIds,
          conditions: sanitizeConditions(raw.conditions),
          setupId: typeof raw.setup_id === "string" && ANON_ID_RE.test(raw.setup_id) ? raw.setup_id.toLowerCase() : undefined,
        };

        const partial = buildTuneTwo(tune2Input);
        const result = safeShapeSparse(partial, tune2Input.guardrails);

        if (callId !== null) await deps.recordOutput?.(callId, result);
        return jsonResponse(result, 200);
      }

      // ------------------------ MODE: Baseline (zero_baseline_v1) ------------------------
      try {
        const z = body.input;

        // Build initial baseline (fallback). If OpenAI is available, refine.
        let partial: Partial<ZeroResult> = buildFallback(z);
        let engineSource: EngineSource = "formula";

        if (OPENAI_API_KEY) {
          try {
            const ai = await callOpenAI(z);
            // {} means the model's text was not JSON (callOpenAI swallows the
            // parse): the formula's numbers ship, and the response says so.
            engineSource = ai && typeof ai === "object" && ("fork" in ai || "shock" in ai) ? "llm" : "fallback_parse";
            // merge AI fields over baseline
            partial = {
              ...partial,
              ...ai,
              fork: { ...partial.fork, ...ai?.fork } as ZeroResult["fork"],
              shock: { ...partial.shock, ...ai?.shock } as ZeroResult["shock"],
              detected: { ...partial.detected, ...ai?.detected },
              notes: ai?.notes ?? partial.notes,
            };
          } catch (e) {
            // keep baseline but include note
            engineSource = "fallback_error";
            const msg = (e as Error).message ?? String(e);
            partial.notes = [
              ...(partial.notes ?? []),
              `AI fallback used: ${msg.slice(0, 160)}`,
            ];
          }
        } else {
          partial.notes = [
            ...(partial.notes ?? []),
            "OPENAI_API_KEY not set — using safe baseline.",
          ];
        }

        partial.engine_source = engineSource;

        // Fork type is decided by the catalog flag or the rider's toggle, never
        // by the model (decision 1): a coil bike ships with no air value even
        // when the LLM invented one.
        if (!resolveAirFork(z)) {
          if (partial.fork) delete partial.fork.air_pressure_bar;
          partial.detected = { ...(partial.detected ?? {}), has_air_fork: false };
        }

        // Enforce guardrails & shape
        const result = safeShape(partial, z.guardrails);

        if (callId !== null) await deps.recordOutput?.(callId, result);
        return jsonResponse(result, 200);
      } catch (genErr) {
        // The server claimed the credit before generation — generation
        // failed, so the server gives it back (H2: claim/refund pairing is
        // server-owned now). Old-client pass-through requests refund
        // themselves via refund_free_tune.
        if (serverClaimedCredit && userId) {
          await deps.refundClaim(userId);
        }
        throw genErr;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  };
}

export const handler = makeHandler();

// Guarded so `deno test` can import this module without starting a server.
// The edge runtime never sets AI_TUNE_TEST, so production always serves.
if (Deno.env.get("AI_TUNE_TEST") !== "1") {
  Deno.serve(handler);
}
