// Ride day: session store (start → tweaks → motos → effective values →
// settle math), the deterministic conditions rule base, the engine change-set
// diff (no hardcoded mappings), and the log-moto vocabulary.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { previewValue, retuneRules, todaysSetupRules } from "../lib/conditionsRules";
import { diffChanges, directionLine, snapshotToTune } from "../lib/rideAdjust";
import {
  applyDeltas,
  elapsedMs,
  emptyDraft,
  formatElapsed,
  logMoto,
  readOpenSession,
  rideEffective,
  setAbsolute,
  startSession,
  type RideDraft,
} from "../lib/rideDay";
import { hoursFromMs, meterDelta, settledDelta } from "../lib/rideEnd";
import { ALL_SYMPTOMS, PRIMARY_SYMPTOMS, severityFor } from "../lib/rideSymptoms";
import type { SetupVersionRow, SettingsSnapshot } from "../lib/setupVersions";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => { throw new Error("offline"); },
    rpc: () => { throw new Error("offline"); },
  },
}));

const version: SetupVersionRow = {
  id: "11111111-2222-4333-8444-555555555555",
  user_id: "u",
  bike_id: "b",
  version_number: 5,
  source: "refinement",
  parent_version_id: null,
  restored_from_version_id: null,
  fork_comp_clicks: 13,
  fork_reb_clicks: 12,
  fork_air_bar: 10.6,
  shock_lsc_clicks: 11,
  shock_hsc_turns: 1,
  shock_reb_clicks: 15,
  sag_mm: 105,
  sag_measured: true,
  notes: [],
  terrain: "Hardpack",
  context: null,
  recommended_settings: null,
  applied_settings: null,
  settings_delta: null,
  created_at: "2026-09-03T12:00:00Z",
};

function draft(): RideDraft {
  return {
    ...emptyDraft(),
    bike: { id: "22222222-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026, nickname: null, model_id: null },
    setupId: null,
    setupName: "MX setup",
    startingVersion: version,
    hasAirFork: true,
    trackId: null,
    trackName: "OMC",
    conditions: { surface: "hardpack", state: "choppy", temp: "hot", watered: false },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("conditions rule base (deterministic, v1 text)", () => {
  const base: SettingsSnapshot = { fork_comp: 13, fork_reb: 12, fork_air: 10.6, shock_lsc: 11, shock_hsc: 1, shock_reb: 15, shock_sag: 105 };

  test("choppy hardpack + hot on an air fork = the mockup's two tweaks", () => {
    const r = todaysSetupRules({ surface: "hardpack", state: "choppy", temp: "hot", watered: false }, base, "MX setup", true);
    expect(r.deltas).toEqual([
      expect.objectContaining({ circuit: "fork_comp", delta: 1 }),
      expect.objectContaining({ circuit: "fork_air", delta: -0.2 }),
    ]);
    expect(previewValue(base.fork_comp, 1, 0)).toBe(14);
    expect(previewValue(base.fork_air, -0.2, 1)).toBe(10.4);
    expect(r.summary).toBe("Your MX setup, two tweaks for today's dirt and heat.");
    expect(r.tirePsiDelta).toBe(0);
  });

  test("never more than two tweaks; watered adds tires only", () => {
    const r = todaysSetupRules({ surface: "sand", state: "choppy", temp: "hot", watered: true }, base, "Dunes", false);
    expect(r.deltas.length).toBeLessThanOrEqual(2);
    expect(r.deltas[0]).toEqual(expect.objectContaining({ circuit: "fork_comp", delta: -1 }));
    expect(r.tirePsiDelta).toBe(-0.5);
  });

  test("fresh mild dry hardpack changes nothing and says so", () => {
    const r = todaysSetupRules({ surface: "hardpack", state: "fresh", temp: "mild", watered: false }, base, "MX setup", true);
    expect(r.deltas).toEqual([]);
    expect(r.summary).toBe("Your MX setup, as it stands. Nothing today's dirt asks to change.");
  });

  test("retune: just watered reverses the morning's chop softening (mockup 07: 14 → 13)", () => {
    const eff = { ...base, fork_comp: 14 };
    const r = retuneRules("watered", eff, true, [{ circuit: "fork_comp", delta: 1 }]);
    expect(r.deltas).toEqual([expect.objectContaining({ circuit: "fork_comp", delta: -1 })]);
    expect(r.tirePsiDelta).toBe(-0.5);
    expect(retuneRules("roughed", eff, true, []).deltas[0]).toEqual(expect.objectContaining({ circuit: "fork_comp", delta: -1 }));
    expect(retuneRules("heating", eff, true, []).deltas[0]).toEqual(expect.objectContaining({ circuit: "fork_air", delta: -0.1 }));
    expect(retuneRules("heating", eff, false, []).deltas[0]).toEqual(expect.objectContaining({ circuit: "fork_comp", delta: -1 }));
  });
});

describe("ride session store", () => {
  test("start → conditions tweaks → moto → adjust absolute → settle delta", async () => {
    const s0 = await startSession(draft(), null);
    expect((await readOpenSession())?.localId).toBe(s0.localId);
    expect(rideEffective(s0)).toEqual({ fork_comp: 13, fork_reb: 12, fork_air: 10.6, shock_lsc: 11, shock_hsc: 1, shock_reb: 15, shock_sag: 105 });

    const s1 = await applyDeltas(s0, [{ circuit: "fork_comp", delta: 1, reason: "chop" }, { circuit: "fork_air", delta: -0.2, reason: "heat" }], "conditions");
    expect(rideEffective(s1).fork_comp).toBe(14);
    expect(rideEffective(s1).fork_air).toBe(10.4);

    const s2 = await logMoto(s1, { sentiment: "worse", symptoms: [{ id: "rear_kicks_accel", qualifier: "Square edges", label: "Rear kicks" }], note: null });
    expect(s2.motos[0].seq).toBe(1);
    expect(s2.motos[0].values.fork_comp).toBe(14);

    const s3 = await setAbsolute(s2, "shock_lsc", 9, "adjust", "engine");
    expect(rideEffective(s3).shock_lsc).toBe(9);
    expect(s3.pending[s3.pending.length - 1]).toEqual(expect.objectContaining({ circuit: "shock_lsc", delta: -2, kind: "adjust", afterMoto: 1 }));

    // Deltas past the clamp are trimmed, never invented; a no-op is dropped.
    const s4 = await applyDeltas(s3, [{ circuit: "shock_hsc", delta: -9 }], "adjust");
    expect(rideEffective(s4).shock_hsc).toBe(0);
    const s5 = await applyDeltas(s4, [{ circuit: "shock_hsc", delta: -1 }], "adjust");
    expect(s5.pending.length).toBe(s4.pending.length);

    expect(settledDelta(s5)).toEqual({ fork_comp: 1, fork_air: -0.2, shock_lsc: -2, shock_hsc: -1 });
    const persisted = await readOpenSession();
    expect(persisted?.pending.length).toBe(s5.pending.length);
  });

  test("elapsed + hours + meter delta", async () => {
    const s = await startSession(draft(), null);
    const twoH = Date.parse(s.startedAt) + 2 * 3600000 + 36 * 60000;
    expect(formatElapsed(elapsedMs(s, twoH))).toBe("2:36");
    expect(hoursFromMs(elapsedMs(s, twoH))).toBe(2.6);
    const withMotos = { ...s, motos: [1, 2, 3].map((n) => ({ seq: n, loggedAt: s.startedAt, sentiment: "better" as const, symptoms: [], note: null, values: s.base, localId: `m${n}`, serverId: null })) };
    const d = meterDelta({ hasBaseline: true, sagMeasured: true, ridesLogged: 3, refinements: 2, outcomesRecorded: 2 }, withMotos);
    expect(d.to).toBeGreaterThan(d.from);
  });
});

describe("adjust: change set from the engine, never hardcoded", () => {
  test("diff engine output vs effective, cap two, reasons from notes", () => {
    const effective: SettingsSnapshot = { fork_comp: 14, fork_reb: 12, fork_air: 10.4, shock_lsc: 11, shock_hsc: 1, shock_reb: 15, shock_sag: 105 };
    const prev = snapshotToTune(effective, true);
    expect(prev.fork.air_pressure_bar).toBe(10.4);
    const result = { ...prev, shock: { ...prev.shock, lsc_clicks: 9, reb_clicks: 14 }, fork: { ...prev.fork, comp_clicks: 13 }, notes: ["Tune Two for 250 SX-F on hardpack: rear kick.", "Rear kicks on square edges → shock LSC -2 to let the rear absorb the edge.", "Shock rebound -1 to match."] };
    const changes = diffChanges(effective, result);
    expect(changes.map((c) => c.circuit)).toEqual(["shock_lsc", "fork_comp"]);
    expect(changes[0]).toEqual(expect.objectContaining({ from: 11, to: 9, delta: -2 }));
    expect(changes[0].reason).toBe("Rear kicks on square edges");
    expect(directionLine(changes[0])).toBe("2 clicks IN · clockwise");
    expect(directionLine({ ...changes[0], delta: 2 })).toBe("2 clicks OUT · counterclockwise");
    expect(diffChanges(effective, prev)).toEqual([]);
  });

  test("log vocabulary: 4 primary chips, qualifiers only on the ambiguous ones, ids are engine ids", () => {
    expect(PRIMARY_SYMPTOMS).toHaveLength(4);
    expect(PRIMARY_SYMPTOMS.filter((c) => c.qualifiers?.length).map((c) => c.id)).toEqual(["rear_kicks_accel", "harsh_braking_bumps"]);
    expect(ALL_SYMPTOMS.find((c) => c.id === "packs_whoops")?.qualifiers).toEqual(["Whoops", "Rocks"]);
    expect(new Set(ALL_SYMPTOMS.map((c) => c.id)).size).toBe(ALL_SYMPTOMS.length);
    expect(severityFor("worse")).toBeGreaterThan(severityFor("better"));
  });
});
