// lib/rideAdjust.ts
// The Adjust screen's change set (design/mockups/ride/09, PROMPT §8): ALL
// suggestion content comes from the refine engine. We send the current
// effective values as `previous`, the logged symptom + qualifier as the
// feedback (qualifier = the engine's existing `where`), and diff the
// engine's answer against `previous`. Reasons are pulled from the engine's
// own notes with lib/tuneNotes matchers. Nothing here maps symptoms to
// adjusters. The two-changes-per-moto cap is a PRESENTATION cap (flagged):
// the engine's frozen contract is untouched.
import { generateTuneTwo, type Tune2Context, type Tune2SymptomId, type ZeroTuneResult } from "./ai";
import { CIRCUIT_STEPS, type CircuitKey } from "./currentSetup";
import { tempBandToF } from "./rideConditions";
import type { RideSession } from "./rideDay";
import { ratingFor, severityFor } from "./rideSymptoms";
import type { SettingsSnapshot } from "./setupVersions";
import { NOTE_HINTS, reasonFromNotes } from "./tuneNotes";

export type AdjustChange = {
  circuit: CircuitKey;
  label: string;
  from: number;
  to: number;
  delta: number;
  unit: "clicks" | "turns" | "bar" | "mm";
  reason: string;
};

export const CIRCUIT_LABELS: Record<CircuitKey, string> = {
  fork_comp: "Fork compression",
  fork_reb: "Fork rebound",
  fork_air: "Fork air",
  shock_lsc: "Shock low speed comp",
  shock_hsc: "Shock high speed comp",
  shock_reb: "Shock rebound",
  shock_sag: "Race sag",
};

const UNIT: Record<CircuitKey, AdjustChange["unit"]> = {
  fork_comp: "clicks",
  fork_reb: "clicks",
  fork_air: "bar",
  shock_lsc: "clicks",
  shock_hsc: "turns",
  shock_reb: "clicks",
  shock_sag: "mm",
};

export const DEFAULT_CHANGE_CAP = 2;

export function snapshotToTune(v: SettingsSnapshot, hasAirFork: boolean): ZeroTuneResult {
  const n = (x: number | null, f: number) => (typeof x === "number" ? x : f);
  return {
    fork: { comp_clicks: n(v.fork_comp, 12), reb_clicks: n(v.fork_reb, 12), ...(hasAirFork && typeof v.fork_air === "number" ? { air_pressure_bar: v.fork_air } : {}) },
    shock: { lsc_clicks: n(v.shock_lsc, 12), hsc_turns: n(v.shock_hsc, 1.5), reb_clicks: n(v.shock_reb, 14), sag_mm: n(v.shock_sag, 105) },
    detected: { has_air_fork: hasAirFork },
    notes: [],
  };
}

function tuneToSnapshot(t: ZeroTuneResult): SettingsSnapshot {
  return {
    fork_comp: t.fork.comp_clicks,
    fork_reb: t.fork.reb_clicks,
    fork_air: typeof t.fork.air_pressure_bar === "number" ? t.fork.air_pressure_bar : null,
    shock_lsc: t.shock.lsc_clicks,
    shock_hsc: t.shock.hsc_turns,
    shock_reb: t.shock.reb_clicks,
    shock_sag: t.shock.sag_mm,
  };
}

/** Diff engine output vs the values in force → the presented change set. */
export function diffChanges(previous: SettingsSnapshot, result: ZeroTuneResult, cap = DEFAULT_CHANGE_CAP): AdjustChange[] {
  const next = tuneToSnapshot(result);
  const out: AdjustChange[] = [];
  for (const k of Object.keys(CIRCUIT_STEPS) as CircuitKey[]) {
    const a = previous[k];
    const b = next[k];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const d = Math.round((b - a) * 100) / 100;
    if (!d) continue;
    if (k === "shock_sag") continue; // sag is a measurement, not a clicker turn at the track
    const hints = NOTE_HINTS[k as Exclude<CircuitKey, "shock_sag">];
    const reason = reasonFromNotes(result.notes, hints) ?? engineFallbackReason(result.notes);
    out.push({ circuit: k, label: CIRCUIT_LABELS[k], from: a, to: b, delta: d, unit: UNIT[k], reason });
  }
  out.sort((x, y) => Math.abs(y.delta) / CIRCUIT_STEPS[y.circuit].step - Math.abs(x.delta) / CIRCUIT_STEPS[x.circuit].step);
  return out.slice(0, cap);
}

function engineFallbackReason(notes: string[]): string {
  const first = notes.find((n) => n.length > 20 && !/^Tune Two for/.test(n));
  return first ? first.replace(/\s+/g, " ").slice(0, 120) : "The engine's call for what you logged.";
}

/** "2 clicks OUT · counterclockwise" / "0.2 bar OUT" */
export function directionLine(c: AdjustChange): string {
  const mag = c.unit === "bar" ? `${Math.abs(c.delta).toFixed(1)} bar` : c.unit === "turns" ? `${Math.abs(c.delta)} ${Math.abs(c.delta) === 1 ? "turn" : "turns"}` : `${Math.abs(c.delta)} ${Math.abs(c.delta) === 1 ? "click" : "clicks"}`;
  const out = c.delta > 0;
  return `${mag} ${out ? "OUT" : "IN"} · ${out ? "counterclockwise" : "clockwise"}`;
}

export async function fetchAdjustChanges(
  s: RideSession,
  symptom: Tune2SymptomId,
  qualifier: string | null,
  sentiment: "better" | "same" | "worse",
  effective: SettingsSnapshot
): Promise<AdjustChange[]> {
  const previous = snapshotToTune(effective, s.hasAirFork);
  const context: Tune2Context = {
    make: s.bike.make ?? undefined,
    model: s.bike.model ?? undefined,
    year: s.bike.year ?? undefined,
    model_id: s.bike.model_id ?? undefined,
    terrain: s.conditions.surface ?? undefined,
    track: s.trackName ?? undefined,
    temp_f: tempBandToF(s.conditions.temp),
    wants_air_fork: s.hasAirFork,
  };
  const result = await generateTuneTwo({
    previous,
    feedback: {
      overall_rating: ratingFor(sentiment),
      symptoms: [{ id: symptom, severity: severityFor(sentiment), ...(qualifier ? { where: qualifier } : {}) }],
      terrain_tags: [s.conditions.surface, s.conditions.state].filter(Boolean) as string[],
    },
    context,
    bikeId: s.bike.id,
  } as any);
  return diffChanges(effective, result);
}
