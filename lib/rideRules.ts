// lib/rideRules.ts
// ONE deterministic suggestion per logged symptom for Home's "Next time, try
// this" card — shown only when the last ride logged a symptom and no
// refinement was applied. Directions mirror the refine engine's first-order
// moves (supabase/functions/ai-tune/index.ts, tune2 switch); magnitudes are a
// conservative first step, not the engine's scaled change. Clicks out from
// closed: + = softer/faster, − = firmer/slower.
import type { Tune2SymptomId } from "./ai";
import type { SettingsDelta } from "./setupVersions";
import { CIRCUIT_LABELS } from "./setupStory";

export type RideRule = {
  circuit: keyof SettingsDelta;
  delta: number;
  /** Past-tense observation for the card's first line. */
  why: string;
};

export const RIDE_RULES: Record<Tune2SymptomId, RideRule> = {
  harsh_braking_bumps: { circuit: "fork_comp", delta: 2, why: "Braking bumps hit harsh" },
  deflects_in_chop: { circuit: "fork_reb", delta: -1, why: "The front deflected in the chop" },
  rear_kicks_accel: { circuit: "shock_reb", delta: -2, why: "The rear kicked on the gas" },
  bottoms_landings: { circuit: "fork_comp", delta: -2, why: "It bottomed on the landings" },
  front_knifes: { circuit: "fork_comp", delta: -1, why: "The front tucked in the corners" },
  dead_feel: { circuit: "fork_reb", delta: 2, why: "It felt dead" },
  unstable_whoops: { circuit: "shock_reb", delta: -2, why: "It got loose in the whoops" },
  packs_whoops: { circuit: "shock_reb", delta: 2, why: "It packed down in the whoops" },
  harsh_square_edge: { circuit: "fork_comp", delta: 2, why: "Square edges hit harsh" },
  headshake: { circuit: "fork_reb", delta: -1, why: "It shook its head" },
  general_harsh: { circuit: "fork_comp", delta: 2, why: "It rode harsh" },
};

export type RideSuggestion = {
  symptom: Tune2SymptomId;
  circuit: keyof SettingsDelta;
  delta: number;
  /** "The front tucked in the corners and you rode it out." */
  text: string;
  /** "Next time, don't. Start with −1 fork comp." */
  sub: string;
};

export function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "−";
  const mag = Number.isInteger(delta) ? String(Math.abs(delta)) : Math.abs(delta).toFixed(1);
  return `${sign}${mag}`;
}

export function suggestionFor(symptom: Tune2SymptomId, where?: string | null): RideSuggestion {
  const rule = RIDE_RULES[symptom];
  const w = where?.trim();
  const whereText = w ? ` ${/^(in|on|at|through|over|under)\b/i.test(w) ? w : `in ${w.toLowerCase()}`}` : "";
  return {
    symptom,
    circuit: rule.circuit,
    delta: rule.delta,
    text: `${rule.why}${whereText} and you rode it out.`,
    sub: `Next time, don't. Start with ${formatDelta(rule.delta)} ${CIRCUIT_LABELS[rule.circuit]}.`,
  };
}
