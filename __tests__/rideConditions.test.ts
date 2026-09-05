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

test("engine-first: no free text → rules with engineSkipped; free text → engine; engine no-change → rules", async () => {
  const conditions = { surfaces: ["hardpack" as const], state: "choppy" as const, temp: "hot" as const, watered: false };
  const common = { bike, hasAirFork: false, trackName: "Local", conditions, effective: base, setupName: "MX" };
  const a = await suggestForConditions({ ...common, freeText: "" });
  expect(a.source).toBe("rules");
  expect(a.engineSkipped).toBe("no_free_text");
  expect(generateTuneTwo).not.toHaveBeenCalled();

  (generateTuneTwo as jest.Mock).mockResolvedValueOnce({ fork: { comp_clicks: 14, reb_clicks: 10 }, shock: { lsc_clicks: 10, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 }, notes: ["Front is harsh on the chop: two clicks softer compression."] });
  const b = await suggestForConditions({ ...common, freeText: "front feels harsh on the chop" });
  expect(b.source).toBe("engine");
  expect(b.deltas).toEqual([{ circuit: "fork_comp", delta: 2, reason: expect.any(String) }]);
  expect(b.reasoning).toMatch(/harsh/);
  const call = (generateTuneTwo as jest.Mock).mock.calls[0][0];
  expect(call.feedback.free_text).toBe("front feels harsh on the chop");
  expect(call.feedback.terrain_tags).toEqual(["hardpack", "choppy"]);
  expect(call.feedback.symptoms).toEqual([]);

  (generateTuneTwo as jest.Mock).mockResolvedValueOnce({ fork: { comp_clicks: 12, reb_clicks: 10 }, shock: { lsc_clicks: 10, hsc_turns: 1.5, reb_clicks: 12, sag_mm: 105 }, notes: ["No specific issues were selected, so this Tune Two keeps your last settings."] });
  const c = await suggestForConditions({ ...common, freeText: "nice day" });
  expect(c.source).toBe("rules");
  expect(c.engineSkipped).toBe("engine_no_change");

  (generateTuneTwo as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  const d = await suggestForConditions({ ...common, freeText: "harsh" });
  expect(d.source).toBe("rules");
  expect(d.engineSkipped).toBe("offline_or_error");
});
