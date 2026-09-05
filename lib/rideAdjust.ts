// lib/rideAdjust.ts
// The Adjust screen's change set (design/mockups/ride/09, PROMPT §8): ALL
// suggestion content comes from the refine engine. We send the current
// effective values as `previous`, the logged symptom + qualifier as the
// feedback (qualifier = the engine's existing `where`), and diff the
// engine's answer against `previous`. Reasons are pulled from the engine's
// own notes with lib/tuneNotes matchers. Nothing here maps symptoms to
// adjusters. The two-changes-per-moto cap is a PRESENTATION cap (flagged):
// the engine's frozen contract is untouched.
import { generateTuneTwo, type Tune2Conditions, type Tune2Context, type Tune2Previous, type Tune2Result, type Tune2SymptomId } from "./ai";
import { CIRCUIT_STEPS, type CircuitKey } from "./currentSetup";
import { surfacesOf, tempBandToF, type RideConditions } from "./rideConditions";
import type { RideSession } from "./rideDay";
import { ratingFor, severityFor, type SymptomLevel } from "./rideSymptoms";
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

/** The effective values as the engine's previous tune. HONEST (contract v3):
 *  a circuit the setup never recorded goes out as null, never as an invented
 *  12 / 12 / 1.5 / 14 / 105, and the engine leaves it null. */
export function snapshotToTune(v: SettingsSnapshot, hasAirFork: boolean): Tune2Previous {
  const n = (x: number | null | undefined) => (typeof x === "number" ? x : null);
  return {
    fork: { comp_clicks: n(v.fork_comp), reb_clicks: n(v.fork_reb), ...(hasAirFork && typeof v.fork_air === "number" ? { air_pressure_bar: v.fork_air } : {}) },
    shock: { lsc_clicks: n(v.shock_lsc), hsc_turns: n(v.shock_hsc), reb_clicks: n(v.shock_reb), sag_mm: n(v.shock_sag) },
    detected: { has_air_fork: hasAirFork },
    notes: [],
  };
}

function tuneToSnapshot(t: Tune2Result): SettingsSnapshot {
  const n = (x: number | null | undefined) => (typeof x === "number" ? x : null);
  return {
    fork_comp: n(t.fork.comp_clicks),
    fork_reb: n(t.fork.reb_clicks),
    fork_air: n(t.fork.air_pressure_bar),
    shock_lsc: n(t.shock.lsc_clicks),
    shock_hsc: n(t.shock.hsc_turns),
    shock_reb: n(t.shock.reb_clicks),
    shock_sag: n(t.shock.sag_mm),
  };
}

/** The ride day's conditions on the wire (contract v3). */
export function wireConditions(c: RideConditions | null | undefined, retune?: Tune2Conditions["retune"]): Tune2Conditions {
  return {
    surfaces: surfacesOf(c),
    state: c?.state ?? null,
    temp_band: c?.temp ?? null,
    watered: c?.watered ?? null,
    retune: retune ?? null,
  };
}

/** Diff engine output vs the values in force → the presented change set. */
export function diffChanges(previous: SettingsSnapshot, result: Tune2Result, cap = DEFAULT_CHANGE_CAP): AdjustChange[] {
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

export type AdjustResult = {
  changes: AdjustChange[];
  /** The engine's own summary line (its first note), shown under the change. */
  reasoning: string | null;
  source: "engine";
};

/** One engine call for a logged moto: symptom + qualifier + the rider's own
 *  words (feedback.free_text, parsed server-side; an EXISTING Tune Two input,
 *  no contract change). */
export async function fetchAdjustResult(
  s: RideSession,
  symptom: Tune2SymptomId | null,
  qualifier: string | null,
  sentiment: "better" | "same" | "worse",
  effective: SettingsSnapshot,
  freeText?: string | null,
  level?: SymptomLevel | null
): Promise<AdjustResult> {
  const previous = snapshotToTune(effective, s.hasAirFork);
  const surfaces = surfacesOf(s.conditions);
  const context: Tune2Context = {
    make: s.bike.make ?? undefined,
    model: s.bike.model ?? undefined,
    year: s.bike.year ?? undefined,
    model_id: s.bike.model_id ?? undefined,
    terrain: surfaces[0] ?? undefined,
    track: s.trackName ?? undefined,
    temp_f: tempBandToF(s.conditions.temp),
    wants_air_fork: s.hasAirFork,
  };
  const text = typeof freeText === "string" && freeText.trim() ? freeText.trim().slice(0, 800) : undefined;
  const result = await generateTuneTwo({
    previous,
    feedback: {
      overall_rating: ratingFor(sentiment),
      // `where` is the qualifier TAG (contract v3): the engine's vocabulary.
      symptoms: symptom ? [{ id: symptom, severity: severityFor(sentiment, level), ...(qualifier ? { where: qualifier } : {}) }] : [],
      terrain_tags: [...surfaces, s.conditions.state, s.conditions.watered ? "watered" : null].filter(Boolean) as string[],
      source: "ride_log",
      ...(text ? { free_text: text } : {}),
    },
    context,
    bikeId: s.bike.id,
    // Decision 5: the adaptive step reads this setup's lineage only.
    setupId: s.setupId ?? null,
    // Decision 6: the conditions stage sees the day's conditions (a quick
    // refine has none, so nothing is sent).
    conditions: s.quick ? null : wireConditions(s.conditions),
  });
  const reasoning = Array.isArray(result?.notes) ? (result.notes.find((n: unknown) => typeof n === "string" && n.trim()) as string | undefined) ?? null : null;
  return { changes: diffChanges(effective, result), reasoning, source: "engine" };
}

export async function fetchAdjustChanges(
  s: RideSession,
  symptom: Tune2SymptomId,
  qualifier: string | null,
  sentiment: "better" | "same" | "worse",
  effective: SettingsSnapshot,
  freeText?: string | null
): Promise<AdjustChange[]> {
  return (await fetchAdjustResult(s, symptom, qualifier, sentiment, effective, freeText)).changes;
}
