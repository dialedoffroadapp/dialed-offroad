// Contract v3 (2026-09-05): the client side of the frozen-contract PR.
// Honest previous values, the sparse refine result, the legacy symptom map,
// qualifier tags, and the conditions note bucket.
jest.mock("../lib/supabase", () => ({ supabase: {} }));
jest.mock("../lib/tuneAttribution", () => ({ getOrCreateAnonTuneId: async () => null }));
jest.mock("../lib/tuneLocation", () => ({ getTuneLocation: async () => null }));

/* eslint-disable import/first */
import { completeTune, SYMPTOM_PHRASES, type Tune2Result, type ZeroTuneResult } from "../lib/ai";
import { diffChanges, snapshotToTune, wireConditions } from "../lib/rideAdjust";
import { ALL_SYMPTOMS, LEGACY_TO_V3, qualifierLabel, symptomLabel } from "../lib/rideSymptoms";
import { classifyTuneNotes, reasonFromNotes, NOTE_HINTS } from "../lib/tuneNotes";

test("snapshotToTune never invents a value: nulls stay null and air goes out only when the bike has one", () => {
  const sparse = snapshotToTune({ fork_comp: 14, fork_reb: null, fork_air: 10.4, shock_lsc: 11, shock_hsc: null, shock_reb: 15, shock_sag: null }, false);
  expect(sparse.fork.reb_clicks).toBeNull();
  expect(sparse.shock.hsc_turns).toBeNull();
  expect(sparse.shock.sag_mm).toBeNull();
  expect(sparse.fork.air_pressure_bar).toBeUndefined(); // coil bike: no air even though the snapshot carries one
  expect(snapshotToTune({ fork_comp: 14, fork_reb: 12, fork_air: 10.4, shock_lsc: 11, shock_hsc: 1, shock_reb: 15, shock_sag: 105 }, true).fork.air_pressure_bar).toBe(10.4);
});

test("diffChanges skips a circuit that is null on either side", () => {
  const effective = { fork_comp: 14, fork_reb: 12, fork_air: null, shock_lsc: 11, shock_hsc: null, shock_reb: 15, shock_sag: 105 };
  const result: Tune2Result = { fork: { comp_clicks: 12, reb_clicks: 12 }, shock: { lsc_clicks: 11, hsc_turns: null, reb_clicks: 15, sag_mm: 105 }, notes: ["Harsh on small bumps → +2 fork compression clicks (softer)."] };
  expect(diffChanges(effective, result).map((c) => c.circuit)).toEqual(["fork_comp"]);
});

test("completeTune fills a null circuit from the complete previous tune", () => {
  const previous: ZeroTuneResult = { fork: { comp_clicks: 14, reb_clicks: 12, air_pressure_bar: 10.6 }, shock: { lsc_clicks: 12, hsc_turns: 1.4, reb_clicks: 14, sag_mm: 103 }, notes: [] };
  const result: Tune2Result = { fork: { comp_clicks: 16, reb_clicks: null }, shock: { lsc_clicks: 12, hsc_turns: null, reb_clicks: 14, sag_mm: 103 }, notes: ["x"], engine_source: "deterministic" };
  expect(completeTune(result, previous)).toMatchObject({ fork: { comp_clicks: 16, reb_clicks: 12, air_pressure_bar: 10.6 }, shock: { hsc_turns: 1.4 }, engine_source: "deterministic" });
});

test("every chip id and every legacy id has a phrase; the legacy map reads legacy rows as today's chips", () => {
  for (const c of ALL_SYMPTOMS) expect(typeof SYMPTOM_PHRASES[c.id]).toBe("string");
  for (const id of Object.keys(LEGACY_TO_V3)) expect(typeof SYMPTOM_PHRASES[id as keyof typeof SYMPTOM_PHRASES]).toBe("string");
  expect(symptomLabel("rear_kicks_accel")).toBe("Rear kicks");
  expect(symptomLabel("packs_whoops")).toBe("Packs in chop");
  expect(symptomLabel("dead_feel")).toBe("Dead / no pop"); // no v3 equivalent, keeps its own label
  expect(symptomLabel("rear_kicks")).toBe("Rear kicks");
  expect(qualifierLabel("logs_ledges")).toBe("Logs and ledges");
  expect(qualifierLabel("Square edges")).toBe("Square edges"); // a legacy row's stored label passes through
});

test("wireConditions is the engine's shape, tolerant of old single-surface sessions", () => {
  expect(wireConditions({ surfaces: ["sand", "loam"], state: "rutted", temp: "cold", watered: false })).toEqual({ surfaces: ["sand", "loam"], state: "rutted", temp_band: "cold", watered: false, retune: null });
  expect(wireConditions({ surface: "mud", state: null, temp: null, watered: null } as any, { tile: "roughed", prior_tweaks: [] })).toEqual({ surfaces: ["mud"], state: null, temp_band: null, watered: null, retune: { tile: "roughed", prior_tweaks: [] } });
});

test("tuneNotes: conditions notes get their own bucket and mine a reason", () => {
  const notes = [
    "Tune Two for KTM on hardpack: small changes for today's conditions.",
    "Re-test on the same section for 3–5 laps. If a symptom gets worse, go back 2 clicks in that direction.",
    "Conditions: choppy hardpack → +1 fork compression. Choppy hardpack: a click softer keeps the fork moving over the chop.",
    "Tires: -0.50 psi front and rear for the water.",
    "Rear kicks → -2 shock rebound clicks (slower to stop kicking).",
  ];
  const c = classifyTuneNotes(notes);
  expect(c.conditions).toHaveLength(2);
  expect(c.routine).toEqual([notes[4]]);
  expect(reasonFromNotes(notes, NOTE_HINTS.fork_comp)).toBe("Conditions: choppy hardpack");
  expect(reasonFromNotes(notes, NOTE_HINTS.shock_reb)).toBe("Rear kicks");
});
