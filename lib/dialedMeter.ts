// lib/dialedMeter.ts
// Per-bike % dialed meter (plan 4.7): endowed baseline WITH a stated reason,
// computed client-side from existing rows, categories only for features that
// exist, never a dead 100% (per-track sub-progress comes later). Pure — the
// Home/Garage data layer feeds it counts; tests pin the arithmetic.

export type MeterInputs = {
  /** A setup_versions row exists for the bike. */
  hasBaseline: boolean;
  /** Any version or session for the bike has sag_measured = true. */
  sagMeasured: boolean;
  /** Sessions (rides) logged for the bike. */
  ridesLogged: number;
  /** setup_versions with source "refinement" (Tune Two) for the bike. */
  refinements: number;
  /** ride_feedback rows with a recorded outcome. */
  outcomesRecorded: number;
};

export type MeterCategoryState = "done" | "partial" | "open";

export type MeterCategory = {
  key: "baseline" | "sag" | "first_ride" | "refined" | "consistency";
  label: string;
  /** Weight toward 100. */
  weight: number;
  /** 0..1 completion inside the category. */
  progress: number;
  state: MeterCategoryState;
  /** Short caption fragment ("Refined 2 of 5"). */
  caption: string;
};

export const METER_ENDOWED_PCT = 20;
/** The endowed state's reason line, shared by Home's day-one glance card and
 *  the quiz reveal's meter card (the plan: "endowed 20% with the reason stated").
 *  It names sag as the next earnable step (decision 7, 2026-09-05): until the
 *  measure-sag walkthrough ships, the 15-point sag category must read as
 *  earnable everywhere the meter appears, never as a silent zero. */
export const METER_ENDOWED_REASON = `Baseline's in. That's the first ${METER_ENDOWED_PCT}%. Measure your sag for 15 more; every ride pushes it from there.`;
/** Refinements needed to fill the refined category (plan: count-based). */
export const METER_REFINEMENTS_FULL = 5;
/** Recorded outcomes needed to fill consistency (count-based, NOT a streak). */
export const METER_OUTCOMES_FULL = 5;

export function computeMeter(i: MeterInputs): { pct: number; categories: MeterCategory[] } {
  const refinedProgress = Math.min(1, i.refinements / METER_REFINEMENTS_FULL);
  const consistencyProgress = Math.min(1, i.outcomesRecorded / METER_OUTCOMES_FULL);
  const categories: MeterCategory[] = [
    {
      key: "baseline",
      label: "Baseline",
      weight: METER_ENDOWED_PCT,
      progress: i.hasBaseline ? 1 : 0,
      state: i.hasBaseline ? "done" : "open",
      caption: i.hasBaseline ? "Baseline ✓" : "Baseline",
    },
    {
      key: "sag",
      label: "Sag",
      weight: 15,
      progress: i.sagMeasured ? 1 : 0,
      state: i.sagMeasured ? "done" : "open",
      caption: i.sagMeasured ? "Sag ✓" : "Sag",
    },
    {
      key: "first_ride",
      label: "First ride",
      weight: 15,
      progress: i.ridesLogged > 0 ? 1 : 0,
      state: i.ridesLogged > 0 ? "done" : "open",
      caption: i.ridesLogged > 0 ? "First ride ✓" : "First ride",
    },
    {
      key: "refined",
      label: "Refined",
      weight: 30,
      progress: refinedProgress,
      state: refinedProgress >= 1 ? "done" : refinedProgress > 0 ? "partial" : "open",
      caption: `Refined ${Math.min(i.refinements, METER_REFINEMENTS_FULL)} of ${METER_REFINEMENTS_FULL}`,
    },
    {
      key: "consistency",
      label: "Outcomes",
      weight: 20,
      progress: consistencyProgress,
      state: consistencyProgress >= 1 ? "done" : consistencyProgress > 0 ? "partial" : "open",
      caption: `Outcomes ${Math.min(i.outcomesRecorded, METER_OUTCOMES_FULL)} of ${METER_OUTCOMES_FULL}`,
    },
  ];
  const raw = categories.reduce((n, c) => n + c.weight * c.progress, 0);
  // Never a dead 100% while per-track progress is unbuilt: cap at 95.
  const pct = Math.round(Math.min(95, raw));
  return { pct, categories };
}

/** "Baseline ✓ · Sag ✓ · Refined 2 of 5" (bike page identity caption). */
export function meterCaption(categories: MeterCategory[]): string {
  const parts = categories.filter((c) => c.key !== "consistency" || c.progress > 0).map((c) => c.caption);
  return parts.slice(0, 3).join(" · ");
}

/** Hero one-liner under the number. */
export function meterHeroLine(i: MeterInputs, pct: number): string {
  if (!i.hasBaseline) return "No baseline yet. Build a tune to start.";
  if (i.ridesLogged === 0) return METER_ENDOWED_REASON;
  const rides = i.refinements === 1 ? "One ride of refinement in." : `${numberWord(i.refinements)} rides of refinement in.`;
  const sag = i.sagMeasured ? " Sag measured, not guessed." : " Measure sag to lock in the number.";
  return pct >= 20 && i.refinements > 0 ? rides + sag : "First ride logged. Refine it to move the number." ;
}

function numberWord(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  return n >= 0 && n < words.length ? words[n] : String(n);
}
