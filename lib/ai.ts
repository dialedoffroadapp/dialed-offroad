// lib/ai.ts
// Zero-based AI tuning call (Supabase Edge Function)
// Returns absolute click counts "from zero" (fully closed) + safety clamps.

import { supabase } from "./supabase";

/* ------------------------------------------------------------------ */
/* Base Tune (Tune One)                                               */
/* ------------------------------------------------------------------ */

export type ZeroTuneInput = {
  // free text (still useful for model-aware priors)
  make?: string;
  model?: string;
  year?: number;

  // riding context
  terrain: string; // e.g., "hardpack", "sand", "roots", ...
  track?: string;
  temp_f?: number;
  elev_ft?: number;

  // rider context
  rider: {
    weight_lbs?: number;
    skill: "beginner" | "intermediate" | "pro";
    style: "short_motos" | "long_enduro";
    goals: string[]; // e.g., ["stability","comfort"]
    issues?: string; // free text problems
  };

  // UI toggles / flags
  has_zeroed_clickers?: boolean; // user says all clickers set to zero (fully closed)

  // whether the rider is on / cares about an air fork (AER etc.)
  // This lets the backend ask the model for air-pressure guidance when appropriate.
  wants_air_fork?: boolean;
};

export type ZeroTuneResult = {
  fork: {
    comp_clicks: number;        // clicks out from zero
    reb_clicks: number;         // clicks out from zero
    air_pressure_bar?: number;  // for air forks (WP AER) if applicable
  };
  shock: {
    lsc_clicks: number;         // low-speed comp clicks out
    hsc_turns: number;          // high-speed comp turns out
    reb_clicks: number;         // clicks out
    sag_mm: number;             // target riding sag
  };
  // Optional echo from backend if it infers fork family.
  detected?: {
    has_air_fork?: boolean;
    fork_family?: string;       // "WP XACT AER 48", "KYB coil", etc.
  };
  notes: string[];              // short guidance list
};

/* ------------------------------------------------------------------ */
/* Tune Two (feedback refinement)                                     */
/* ------------------------------------------------------------------ */

// These IDs must match the backend union in supabase/functions/ai-tune/index.ts
export type Tune2SymptomId =
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

export type Tune2Symptom = {
  id: Tune2SymptomId;
  severity: number; // ALWAYS 1–10; callers convert from their UI scale first
  where?: string;   // optional location tag ("Braking", "Corners", ...); engine ignores for now
};

export type Tune2Feedback = {
  overall_rating?: number;      // ALWAYS 1–10; callers convert from their UI scale first
  ride_duration_min?: number;   // how long they rode this tune
  terrain_tags?: string[];      // e.g. ["hardpack","whoops"]
  symptoms: Tune2Symptom[];
  // "Don't touch" areas the rider says are already working (engine v2).
  protected?: { area: string }[];
  // Raw rider note — parsed server-side into structured feedback (engine v2).
  free_text?: string;
};

// Engine v2 adaptive step: what the last refinement did and how it went.
export type Tune2LastOutcome = {
  outcome: "improved" | "same" | "worse";
  symptoms: Tune2SymptomId[];
  deltas: Partial<
    Record<"fork_comp" | "fork_reb" | "shock_lsc" | "shock_reb" | "shock_hsc", number>
  >;
};

export type Tune2Context = {
  make?: string;
  model?: string;
  year?: number;
  terrain?: string;
  track?: string;
  temp_f?: number;
  elev_ft?: number;
  rider?: {
    weight_lbs?: number;
    skill?: "beginner" | "intermediate" | "pro";
    style?: "short_motos" | "long_enduro";
    goals?: string[];
  };
  wants_air_fork?: boolean;
};

/* ------------------------------------------------------------------ */
/* Public API your screens call                                       */
/* ------------------------------------------------------------------ */

/**
 * generateTune
 * Calls the 'ai-tune' Edge Function with a zero-based prompt contract.
 * The function should apply guardrails (clicker/sag clamps) and return structured JSON.
 */
export async function generateTune(input: ZeroTuneInput): Promise<ZeroTuneResult> {
  const payload = {
    mode: "zero_baseline_v1" as const,
    input: {
      make: input.make?.trim() || undefined,
      model: input.model?.trim() || undefined,
      year: input.year ?? undefined,
      terrain: input.terrain,
      track: input.track || undefined,
      temp_f: isFiniteNumber(input.temp_f) ? input.temp_f : undefined,
      elev_ft: isFiniteNumber(input.elev_ft) ? input.elev_ft : undefined,

      rider: {
        weight_lbs: isFiniteNumber(input.rider.weight_lbs)
          ? input.rider.weight_lbs
          : undefined,
        skill: input.rider.skill,
        style: input.rider.style,
        // keep prompt tight but still let the rider stack a few goals
        goals: (input.rider.goals || []).slice(0, 8),
        issues: input.rider.issues || undefined,
      },

      has_zeroed_clickers: !!input.has_zeroed_clickers,

      // pass through air-fork intent so Edge function / model can handle AER vs coil
      wants_air_fork: input.wants_air_fork ?? undefined,

      // Ask backend to enforce safe bounds so suggestions are always rideable.
      guardrails: defaultGuardrails(),
    },
  };

  const { data, error } = await supabase.functions.invoke("ai-tune", { body: payload });
  if (error) throw new Error(error.message || "AI tune failed");

  return normalizeResult(data as Partial<ZeroTuneResult>);
}

/**
 * generateTuneTwo
 * Second-pass refinement on top of an existing tune, based on rider feedback.
 * You pass:
 *  - previous: the ZeroTuneResult from Tune One (or last tune)
 *  - feedback: structured symptoms + severity
 *  - context: optional bike/ride context to echo to backend
 */
export async function generateTuneTwo(params: {
  previous: ZeroTuneResult;
  feedback: Tune2Feedback;
  context?: Tune2Context;
  // When provided, the most recent outcome-rated refinement for this bike is
  // sent so the engine can adapt its step size (engine v2). Fail-open.
  bikeId?: string | null;
}): Promise<ZeroTuneResult> {
  const { previous, feedback, context, bikeId } = params;

  const lastOutcome = bikeId ? await fetchLastOutcome(bikeId) : undefined;

  // Clamp feedback into the 1–10 scale. Callers (tune-feedback) have already
  // converted their 1–5 UI inputs to 1–10 — do NOT rescale here.
  const normalizedFeedback: Tune2Feedback = {
    overall_rating: clampTenScale(feedback.overall_rating),
    ride_duration_min: isFiniteNumber(feedback.ride_duration_min)
      ? feedback.ride_duration_min
      : undefined,
    terrain_tags: (feedback.terrain_tags || []).slice(0, 8),
    symptoms: Array.isArray(feedback.symptoms)
      ? feedback.symptoms
          .filter((s) => !!s && !!s.id)
          .map((s) => ({
            id: s.id,
            severity: clampTenScale(s.severity) ?? 6, // default mid if somehow missing
            where: s.where || undefined,
          }))
      : [],
    protected: feedback.protected?.length
      ? feedback.protected.slice(0, 8)
      : undefined,
    free_text:
      typeof feedback.free_text === "string" && feedback.free_text.trim().length
        ? feedback.free_text.trim().slice(0, 800)
        : undefined,
  };

  const payload = {
    mode: "tune2_v1" as const,
    input: {
      // optional context – backend mostly uses previous + feedback
      make: context?.make?.trim() || undefined,
      model: context?.model?.trim() || undefined,
      year: context?.year ?? undefined,
      terrain: context?.terrain,
      track: context?.track,
      temp_f: isFiniteNumber(context?.temp_f) ? context?.temp_f : undefined,
      elev_ft: isFiniteNumber(context?.elev_ft) ? context?.elev_ft : undefined,

      rider: {
        weight_lbs: isFiniteNumber(context?.rider?.weight_lbs)
          ? context?.rider?.weight_lbs
          : undefined,
        skill: context?.rider?.skill ?? "intermediate",
        style: context?.rider?.style ?? "short_motos",
        goals: (context?.rider?.goals || []).slice(0, 8),
        // issues not used in Tune Two; feedback.symptoms is the main signal
        issues: undefined,
      },

      has_zeroed_clickers: true, // Tune Two always assumes we’re still zero-based
      wants_air_fork: context?.wants_air_fork ?? undefined,

      guardrails: defaultGuardrails(),

      // Tune Two specific
      previous,
      feedback: normalizedFeedback,
      last_outcome: lastOutcome,
    },
  };

  const { data, error } = await supabase.functions.invoke("ai-tune", { body: payload });
  if (error) throw new Error(error.message || "AI Tune Two failed");

  return normalizeResult(data as Partial<ZeroTuneResult>);
}

/**
 * fetchLastOutcome
 * Most recent outcome-rated ride_feedback for this bike, with the per-circuit
 * deltas its refinement applied (computed from the linked version rows).
 * Fail-open: any error or missing data returns undefined and the refinement
 * proceeds without the adaptive step.
 */
async function fetchLastOutcome(
  bikeId: string
): Promise<Tune2LastOutcome | undefined> {
  try {
    const { data: versions, error: vErr } = await supabase
      .from("setup_versions")
      .select("id")
      .eq("bike_id", bikeId)
      .limit(200);
    if (vErr || !versions?.length) return undefined;

    const ids = versions.map((v: any) => v.id);
    const { data: fb, error: fbErr } = await supabase
      .from("ride_feedback")
      .select("outcome, symptoms, setup_version_id, resulting_version_id")
      .in("setup_version_id", ids)
      .not("outcome", "is", null)
      .not("resulting_version_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fbErr || !fb?.outcome || !fb.resulting_version_id) return undefined;

    const { data: rows, error: rErr } = await supabase
      .from("setup_versions")
      .select(
        "id, fork_comp_clicks, fork_reb_clicks, shock_lsc_clicks, shock_reb_clicks, shock_hsc_turns"
      )
      .in("id", [fb.setup_version_id, fb.resulting_version_id]);
    if (rErr) return undefined;

    const parent = rows?.find((r: any) => r.id === fb.setup_version_id);
    const child = rows?.find((r: any) => r.id === fb.resulting_version_id);
    if (!parent || !child) return undefined;

    const diff = (a: unknown, b: unknown) =>
      typeof a === "number" && typeof b === "number" ? b - a : 0;

    const deltas: Tune2LastOutcome["deltas"] = {};
    const pairs: [keyof Tune2LastOutcome["deltas"], number][] = [
      ["fork_comp", diff(parent.fork_comp_clicks, child.fork_comp_clicks)],
      ["fork_reb", diff(parent.fork_reb_clicks, child.fork_reb_clicks)],
      ["shock_lsc", diff(parent.shock_lsc_clicks, child.shock_lsc_clicks)],
      ["shock_reb", diff(parent.shock_reb_clicks, child.shock_reb_clicks)],
      ["shock_hsc", diff(parent.shock_hsc_turns, child.shock_hsc_turns)],
    ];
    for (const [key, value] of pairs) {
      if (value !== 0) deltas[key] = value;
    }
    if (!Object.keys(deltas).length) return undefined;

    const symptoms = (Array.isArray(fb.symptoms) ? fb.symptoms : [])
      .filter((s: any) => s && typeof s.id === "string" && !s.protect)
      .map((s: any) => s.id as Tune2SymptomId);
    if (!symptoms.length) return undefined;

    return { outcome: fb.outcome, symptoms, deltas };
  } catch (e) {
    console.warn("fetchLastOutcome skipped", e);
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function defaultGuardrails() {
  return {
    clicks_min: 0,
    clicks_max: 30,
    hsc_turns_min: 0,
    hsc_turns_max: 3,
    sag_min_mm: 95,
    sag_max_mm: 112,
    // Air fork defaults the backend can scale by weight if applicable:
    aer_pressure_bar_default: 10.6, // ≈154 psi baseline for ~185 lb
    aer_pressure_bar_per_10lb: 0.2, // ~+/-0.2 bar per 10 lb delta
  };
}

function isFiniteNumber(n: any): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function asInt(n: any, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : fallback;
}

function asFloat(n: any, fallback: number, precision = 2): number {
  const v = Number(n);
  return Number.isFinite(v) ? Number(v.toFixed(precision)) : fallback;
}

function safeBar(n: any): number | undefined {
  if (!Number.isFinite(Number(n))) return undefined;
  const v = Number(n);
  if (v <= 0 || v > 15) return undefined; // sanity bounds
  return Number(v.toFixed(2));
}

/**
 * Clamp a severity/overall rating into the 1–10 scale.
 *
 * Values arriving here are ALREADY ten-scale — the screens convert their 1–5
 * UI inputs before calling generateTuneTwo. A previous version guessed the
 * scale by magnitude and doubled anything <= 5, which double-scaled screen
 * input: overall 2/5 arrived as 8/10 ("nearly perfect") and inverted the
 * refinement's aggressiveness for unhappy riders. Do not reintroduce scaling.
 */
function clampTenScale(v: any): number | undefined {
  if (!isFiniteNumber(v)) return undefined;
  const n = Number(v);

  if (n <= 0) return undefined;

  return clamp(n, 1, 10);
}

/**
 * normalizeResult
 *
 * IMPORTANT:
 * - We now TRUST a valid `fork.air_pressure_bar` from the backend.
 * - If the backend sets a sane pressure value, we mark `detected.has_air_fork = true`
 *   even if the model forgot to set that flag, so the UI always sees it.
 * - Clickers, sag, and HSC are all clamped into safe rideable ranges.
 */
function normalizeResult(result: Partial<ZeroTuneResult>): ZeroTuneResult {
  const forkComp = asInt(result?.fork?.comp_clicks, 12);
  const forkReb = asInt(result?.fork?.reb_clicks, 12);
  const shockLSC = asInt(result?.shock?.lsc_clicks, 12);
  const shockReb = asInt(result?.shock?.reb_clicks, 14);
  const shockHSC = asFloat(result?.shock?.hsc_turns, 1.5, 1);
  const sag = asInt(result?.shock?.sag_mm, 105);

  // Respect any sane air value the backend produced.
  const airBarRaw = safeBar(result?.fork?.air_pressure_bar);
  const hasAirFromValue = typeof airBarRaw === "number";
  const hasAirFromFlag = !!result?.detected?.has_air_fork;
  const hasAirFork = hasAirFromValue || hasAirFromFlag;

  const fork = {
    comp_clicks: clamp(forkComp, 0, 30),
    reb_clicks: clamp(forkReb, 0, 30),
    air_pressure_bar: hasAirFork ? airBarRaw : undefined,
  };

  const shock = {
    lsc_clicks: clamp(shockLSC, 0, 30),
    hsc_turns: clamp(shockHSC, 0, 3),
    reb_clicks: clamp(shockReb, 0, 30),
    sag_mm: clamp(sag, 90, 120),
  };

  const notesArray = Array.isArray(result?.notes)
    ? result!.notes.filter((n) => typeof n === "string").slice(0, 12)
    : [];

  return {
    fork,
    shock,
    detected: {
      has_air_fork: hasAirFork,
      fork_family: result?.detected?.fork_family || undefined,
    },
    notes: notesArray,
  };
}
