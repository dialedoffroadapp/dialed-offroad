// lib/rideEngine.ts
// Today's setup, mid-day retune and Adjust all ask the ENGINE when online,
// with the deterministic rule base (lib/conditionsRules.ts) as the offline
// fallback (decision 2026-09-04). Contract reality (flagged, not changed):
// the Tune Two edge keys on symptom ids and parses feedback.free_text
// server-side; it has NO conditions input (surface / state / watered are
// sent as terrain_tags + terrain + temp_f, which today's engine ignores for
// adjustments). So the engine has something to say only when the rider
// wrote something. With no free text the rules run directly and the result
// says why (`engineSkipped`), instead of a wasted call that returns
// "keep your last settings". A conditions-aware engine path is a frozen-
// contract change (engine + tests + tuneNotes), owed to River first.
import { generateTuneTwo, type Tune2Context } from "./ai";
import type { CircuitKey } from "./currentSetup";
import { retuneRules, todaysSetupRules, type RetuneTile, type RuleDelta, type RuleResult } from "./conditionsRules";
import { surfacesOf, tempBandToF, type RideConditions } from "./rideConditions";
import type { RideBike } from "./rideDay";
import { diffChanges, snapshotToTune } from "./rideAdjust";
import type { SettingsSnapshot } from "./setupVersions";

export type SuggestSource = "engine" | "rules";

export type SuggestResult = RuleResult & {
  source: SuggestSource;
  /** The engine's summary line, or the rule base's note. */
  reasoning: string | null;
  /** Why the engine did not decide (present only when source is "rules"). */
  engineSkipped?: "no_free_text" | "engine_no_change" | "offline_or_error";
};

export type SuggestParams = {
  bike: RideBike;
  hasAirFork: boolean;
  trackName: string | null;
  conditions: RideConditions;
  effective: SettingsSnapshot;
  setupName: string;
  freeText?: string | null;
  /** Retune tile (mid-day); absent = today's setup (morning). */
  tile?: Exclude<RetuneTile, "new_track"> | null;
  priorTweaks?: { circuit: CircuitKey; delta: number }[];
};

function rulesFor(p: SuggestParams): RuleResult {
  return p.tile
    ? retuneRules(p.tile, p.effective, p.hasAirFork, p.priorTweaks ?? [])
    : todaysSetupRules(p.conditions, p.effective, p.setupName, p.hasAirFork);
}

export async function suggestForConditions(p: SuggestParams): Promise<SuggestResult> {
  const text = typeof p.freeText === "string" && p.freeText.trim() ? p.freeText.trim().slice(0, 800) : null;
  const rules = rulesFor(p);
  if (!text) return { ...rules, source: "rules", reasoning: rules.note ?? (rules.deltas[0]?.reason ?? null), engineSkipped: "no_free_text" };
  try {
    const surfaces = surfacesOf(p.conditions);
    const context: Tune2Context = {
      make: p.bike.make ?? undefined,
      model: p.bike.model ?? undefined,
      year: p.bike.year ?? undefined,
      model_id: p.bike.model_id ?? undefined,
      terrain: surfaces[0] ?? undefined,
      track: p.trackName ?? undefined,
      temp_f: tempBandToF(p.conditions.temp),
      wants_air_fork: p.hasAirFork,
    };
    const result = await generateTuneTwo({
      previous: snapshotToTune(p.effective, p.hasAirFork),
      feedback: {
        overall_rating: 5,
        symptoms: [],
        terrain_tags: [...surfaces, p.conditions.state, p.conditions.watered ? "watered" : null, p.tile ?? null].filter(Boolean) as string[],
        free_text: text,
      },
      context,
      bikeId: p.bike.id,
    } as any);
    const changes = diffChanges(p.effective, result, 2);
    const reasoning = Array.isArray(result?.notes) ? (result.notes.find((n: unknown) => typeof n === "string" && n.trim()) as string | undefined) ?? null : null;
    if (changes.length === 0) {
      return { ...rules, source: "rules", reasoning: rules.note ?? reasoning, engineSkipped: "engine_no_change" };
    }
    const deltas: RuleDelta[] = changes.map((c) => ({ circuit: c.circuit, delta: c.delta, reason: c.reason }));
    return {
      deltas,
      tirePsiDelta: rules.tirePsiDelta,
      summary: p.tile ? rules.summary : `${p.setupName}, ${deltas.length === 1 ? "one change" : "two changes"} from what you told the engine.`,
      note: reasoning,
      source: "engine",
      reasoning,
    };
  } catch {
    return { ...rules, source: "rules", reasoning: rules.note ?? (rules.deltas[0]?.reason ?? null), engineSkipped: "offline_or_error" };
  }
}
