// Multi-select surfaces (2026-09-04), the per-surface tire default, and the
// engine-first / rules-fallback source marker.
jest.mock("../lib/ai", () => ({ generateTuneTwo: jest.fn() }));

/* eslint-disable import/first */
import { generateTuneTwo } from "../lib/ai";
import { tirePressureForToday, todaysSetupRules } from "../lib/conditionsRules";
import { conditionsComplete, conditionsSummary, normalizeConditions, primarySurface, surfacesOf } from "../lib/rideConditions";
import { suggestForConditions } from "../lib/rideEngine";

const base = { fork_comp: 12, fork_reb: 10, fork_air: null, shock_lsc: 10, shock_hsc: 1.5, shock_reb: 12, shock_sag: 105 } as any;
const bike = { id: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026, nickname: null, model_id: null };

test("surfaces: old single-surface sessions still read; first tap is primary", () => {
  expect(surfacesOf({ surface: "sand" } as any)).toEqual(["sand"]);
  expect(surfacesOf({ surfaces: ["loam", "sand"] } as any)).toEqual(["loam", "sand"]);
  expect(primarySurface({ surfaces: ["loam", "sand"] } as any)).toBe("loam");
  expect(normalizeConditions({ surface: "mud", state: "fresh" })).toEqual({ surfaces: ["mud"], state: "fresh", temp: null, watered: null });
  expect(conditionsComplete({ surfaces: [], state: "fresh", temp: "mild", watered: null })).toBe(false);
  expect(conditionsSummary({ surfaces: ["hardpack", "sand"], state: "choppy", temp: "hot", watered: true })).toBe("Hardpack + Sand · choppy · hot · watered");
});

test("rules key on the PRIMARY surface", () => {
  const r = todaysSetupRules({ surfaces: ["sand", "hardpack"], state: "choppy", temp: "mild", watered: false }, base, "MX", false);
  expect(r.deltas.map((d) => d.circuit)).toEqual(["fork_comp", "fork_reb"]);
  expect(r.deltas[0].delta).toBe(-1);
});

test("tire pressure: saved value wins; else a per-surface default rendered as changed", () => {
  expect(tirePressureForToday({ surfaces: ["sand"], state: "fresh", temp: "mild", watered: false }, { front: 14, rear: 13 }, 0)).toMatchObject({ front: 14, rear: 13, changed: false, source: "saved" });
  expect(tirePressureForToday({ surfaces: ["sand"], state: "fresh", temp: "mild", watered: true }, { front: 14, rear: 13 }, -0.5)).toMatchObject({ front: 13.5, rear: 12.5, changed: true, source: "saved" });
  const d = tirePressureForToday({ surfaces: ["sand", "mud"], state: "fresh", temp: "mild", watered: false }, { front: null, rear: null }, 0);
  expect(d).toMatchObject({ front: 12.5, rear: 12, changed: true, source: "default" });
  expect(d.reason).toMatch(/Sand starting point/);
  expect(tirePressureForToday({ surfaces: [], state: null, temp: null, watered: null }, { front: null, rear: null }, 0).source).toBe("none");
});

test("engine-first (contract v3): the engine is asked with the conditions on the wire, free text or not; rules only when the call fails", async () => {
  const conditions = { surfaces: ["hardpack" as const], state: "choppy" as const, temp: "hot" as const, watered: true };
  const common = { bike, hasAirFork: false, trackName: "Local", conditions, effective: base, setupName: "MX", setupId: "55555555-2222-4333-8444-555555555555" };

  (generateTuneTwo as jest.Mock).mockResolvedValueOnce({ fork: { comp_clicks: 13, reb_clicks: 10 }, shock: { lsc_clicks: 9, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 }, notes: ["Tune Two for KTM on hardpack: small changes for today's conditions.", "Conditions: choppy hardpack → +1 fork compression. Choppy hardpack: a click softer keeps the fork moving over the chop."], tire_psi_delta: -0.5, engine_source: "deterministic" });
  const a = await suggestForConditions({ ...common, freeText: "" });
  expect(a.source).toBe("engine");
  expect(a.engineSkipped).toBeUndefined();
  expect(a.deltas.map((d) => [d.circuit, d.delta])).toEqual([["fork_comp", 1], ["shock_lsc", -1]]);
  expect(a.deltas[0].reason).toBe("Conditions: choppy hardpack");
  expect(a.tirePsiDelta).toBe(-0.5);
  expect(a.summary).toBe("Your MX, two changes for today's conditions.");
  const call = (generateTuneTwo as jest.Mock).mock.calls[0][0];
  expect(call.feedback.source).toBe("conditions");
  expect(call.feedback.symptoms).toEqual([]);
  expect(call.feedback.free_text).toBeUndefined();
  expect(call.conditions).toEqual({ surfaces: ["hardpack"], state: "choppy", temp_band: "hot", watered: true, retune: null });
  expect(call.setupId).toBe("55555555-2222-4333-8444-555555555555");
  // Honest previous: nulls go out as nulls, never as 12 / 1.5 / 105.
  expect(call.previous.fork.air_pressure_bar).toBeUndefined();

  // A retune tile rides in the same input, with the morning's tweaks.
  (generateTuneTwo as jest.Mock).mockResolvedValueOnce({ fork: { comp_clicks: 11, reb_clicks: 10 }, shock: { lsc_clicks: 10, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 }, notes: ["Conditions: just watered → -1 fork compression. Fresh water means grip."], tire_psi_delta: -0.5 });
  const t = await suggestForConditions({ ...common, freeText: "", tile: "watered", priorTweaks: [{ circuit: "fork_comp", delta: 1 }] });
  expect((generateTuneTwo as jest.Mock).mock.calls[1][0].conditions.retune).toEqual({ tile: "watered", prior_tweaks: [{ circuit: "fork_comp", delta: 1 }] });
  expect(t.deltas).toEqual([{ circuit: "fork_comp", delta: -1, reason: "Conditions: just watered" }]);

  // Nothing to change is still the engine's answer.
  (generateTuneTwo as jest.Mock).mockResolvedValueOnce({ fork: { comp_clicks: 12, reb_clicks: 10 }, shock: { lsc_clicks: 10, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 }, notes: ["Nothing in today's conditions asks for a clicker change, so your setup stands."], tire_psi_delta: 0 });
  const c = await suggestForConditions({ ...common, conditions: { ...conditions, state: "fresh", temp: "mild", watered: false }, freeText: "nice day" });
  expect(c.source).toBe("engine");
  expect(c.deltas).toEqual([]);
  expect(c.summary).toBe("Your MX, as it stands. Nothing today's dirt asks to change.");

  // Offline: the local rule base, flagged.
  (generateTuneTwo as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  const d = await suggestForConditions({ ...common, freeText: "harsh" });
  expect(d.source).toBe("rules");
  expect(d.engineSkipped).toBe("offline_or_error");
  expect(d.deltas.map((x) => x.circuit)).toEqual(["fork_comp", "shock_lsc"]);
});
