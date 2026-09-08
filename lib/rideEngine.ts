// lib/rideEngine.ts
// Today's setup, mid-day retune and Adjust all ask the ENGINE when online,
// with the deterministic rule base (lib/conditionsRules.ts) as the offline
// fallback (decision 2026-09-04). Contract v3 (2026-09-05, decision 6): the
// Tune Two edge now takes a `conditions` input and runs the same rule base
// server-side (parity-tested), so a conditions ask no longer needs free text
// to get an answer: the engine is asked every time it is reachable, with
// `feedback.source: "conditions"` (no symptoms of its own, no adaptive step),
// and the rules run locally only when the call fails.
import { generateTuneTwo, type TireInput, type Tune2Context } from "./ai";
import { asTireSurface, type TirePlanOutput } from "./tirePlanCore";
import { disciplineForBike } from "./discipline";
import { activeRiderProfileId } from "./riderProfile";
import type { CircuitKey } from "./currentSetup";
import { retuneRules, todaysSetupRules, type RetuneContext, type RetuneTile, type RuleDelta, type RuleResult } from "./conditionsRules";
import { surfacesOf, tempBandToF, type RideConditions } from "./rideConditions";
import type { RideBike } from "./rideDay";
import { diffChanges, snapshotToTune, wireConditions } from "./rideAdjust";
import type { SettingsSnapshot } from "./setupVersions";

export type SuggestSource = "engine" | "rules";

export type SuggestResult = RuleResult & {
  source: SuggestSource;
  /** The engine's summary line, or the rule base's note. */
  reasoning: string | null;
  /** Why the engine did not decide (present only when source is "rules"). */
  engineSkipped?: "offline_or_error";
  /** The engine's tire plan when it answered with one (2026-09-07). */
  tires?: TirePlanOutput;
};

export type SuggestParams = {
  bike: RideBike;
  hasAirFork: boolean;
  trackName: string | null;
  conditions: RideConditions;
  effective: SettingsSnapshot;
  setupName: string;
  /** The setup lineage (decision 5); null = the default setup. */
  setupId?: string | null;
  freeText?: string | null;
  /** Retune tile (mid-day); absent = today's setup (morning). */
  tile?: Exclude<RetuneTile, "new_track"> | null;
  priorTweaks?: { circuit: CircuitKey; delta: number }[];
  /** Track state, logged bottoming, skill and discipline for the retune rules (second report, 2026-09-07). */
  retuneContext?: RetuneContext | null;
  /** What is in each tire and the saved pressures, for the engine's tire output. */
  tires?: TireInput | null;
};

function rulesFor(p: SuggestParams): RuleResult {
  return p.tile
    ? retuneRules(p.tile, p.effective, p.hasAirFork, p.priorTweaks ?? [], p.retuneContext ?? {})
    : todaysSetupRules(p.conditions, p.effective, p.setupName, p.hasAirFork);
}

export async function suggestForConditions(p: SuggestParams): Promise<SuggestResult> {
  const text = typeof p.freeText === "string" && p.freeText.trim() ? p.freeText.trim().slice(0, 800) : null;
  const rules = rulesFor(p);
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
      // The bike's discipline rides to the engine (finding 2: without it the
      // tire table fell to MX for a TX 300 on singletrack).
      rider: { discipline: disciplineForBike(p.bike) ?? undefined, profile_id: await activeRiderProfileId().catch(() => undefined) },
      ...(p.tires ? { tires: p.tires } : {}),
    };
    const result = await generateTuneTwo({
      previous: snapshotToTune(p.effective, p.hasAirFork),
      feedback: {
        overall_rating: 5,
        symptoms: [],
        source: "conditions",
        terrain_tags: [...surfaces, p.conditions.state, p.conditions.watered ? "watered" : null, p.tile ?? null].filter(Boolean) as string[],
        ...(text ? { free_text: text } : {}),
      },
      context,
      bikeId: p.bike.id,
      setupId: p.setupId ?? null,
      // The retune context (second report, 2026-09-07) rides to the engine so
      // the server applies the same watered and roughed rules as the client.
      conditions: wireConditions(p.conditions, p.tile ? { tile: p.tile, prior_tweaks: p.priorTweaks ?? [], ...(p.retuneContext ?? {}) } : null),
    });
    const changes = diffChanges(p.effective, result, 2);
    const reasoning = Array.isArray(result?.notes) ? (result.notes.find((n: unknown) => typeof n === "string" && n.trim()) as string | undefined) ?? null : null;
    // The engine's tire plan (additive fields) rides along whatever the clickers say.
    const tires: TirePlanOutput | undefined =
      "tire_front_psi" in result && typeof result.tire_reason === "string" && typeof result.tire_source === "string"
        ? {
            front: typeof result.tire_front_psi === "number" ? result.tire_front_psi : null,
            rear: typeof result.tire_rear_psi === "number" ? result.tire_rear_psi : null,
            reason: result.tire_reason,
            source: result.tire_source,
            discipline: disciplineForBike(p.bike) ?? "mx",
            surface: asTireSurface(surfaces[0]) ?? "hardpack",
            delta: typeof result.tire_psi_delta === "number" ? result.tire_psi_delta : rules.tirePsiDelta,
            systemFront: p.tires?.system_front ?? "unknown",
            systemRear: p.tires?.system_rear ?? "unknown",
          }
        : undefined;
    const tirePsiDelta = typeof result.tire_psi_delta === "number" ? result.tire_psi_delta : rules.tirePsiDelta;
    const deltas: RuleDelta[] = changes.map((c) => ({ circuit: c.circuit, delta: c.delta, reason: c.reason }));
    const n = deltas.length + (tirePsiDelta ? 1 : 0);
    const summary = p.tile
      ? rules.summary
      : n === 0
        ? `Your ${p.setupName}, as it stands. Nothing today's dirt asks to change.`
        : `Your ${p.setupName}, ${deltas.length === 0 ? "one tweak" : deltas.length === 1 ? "one change" : "two changes"} for today's conditions.`;
    return { deltas, tirePsiDelta, summary, note: reasoning, source: "engine", reasoning, ...(tires ? { tires } : {}) };
  } catch {
    return { ...rules, source: "rules", reasoning: rules.note ?? (rules.deltas[0]?.reason ?? null), engineSkipped: "offline_or_error" };
  }
}
