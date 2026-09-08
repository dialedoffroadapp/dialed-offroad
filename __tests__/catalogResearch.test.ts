// Research applied 2026-09-07 (migration 20260907140000): the fork type
// resolves catalog flag, then the rider's stored answer, then the caller's
// fallback; unmatched bikes take the platform manual's sag; the WP air base
// rides in the guardrails; the fork-air why-copy labels the slope as ours.
jest.mock("../lib/supabase", () => ({ supabase: {} }));
jest.mock("../lib/bikes", () => ({ resolveModelId: async () => null }));

/* eslint-disable import/first */
import { whyForYou } from "../lib/adjusterCopy";
import { effectiveAirFork, type ModelSpecs } from "../lib/modelSpecs";
import { DEFAULT_SAG, platformSagBounds, resolveSagBounds } from "../lib/sagBounds";

const row = (over: Partial<ModelSpecs>): ModelSpecs => ({
  id: "x", make: "KTM", model: "250 SX-F", stock_sag_mm: 105, sag_min: 102, sag_max: 112, stock_fork_spring_nmm: null, stock_shock_spring_nmm: 45,
  rider_weight_min_lbs: 165, rider_weight_max_lbs: 187, fork_type: "WP AER 48 air", shock_type: "WP linkage", has_air_fork: true, spec_verified: true, ...over,
} as ModelSpecs);

test("fork type: catalog flag wins; an ambiguous row (null flag) takes the rider's answer; nothing else is guessed", () => {
  expect(effectiveAirFork(row({ has_air_fork: true }), false)).toBe(true);
  expect(effectiveAirFork(row({ has_air_fork: false }), true)).toBe(false);
  expect(effectiveAirFork(row({ has_air_fork: null, fork_type_ambiguous: true }), true)).toBe(true);
  expect(effectiveAirFork(row({ has_air_fork: null, fork_type_ambiguous: true }), false)).toBe(false);
  expect(effectiveAirFork(row({ has_air_fork: null, fork_type_ambiguous: true }), null)).toBeUndefined();
  expect(effectiveAirFork(null, null)).toBeUndefined();
  expect(effectiveAirFork(null, true)).toBe(true);
});

test("sag: a matched row wins, an unmatched bike takes the platform manual value, else the default", () => {
  expect(resolveSagBounds(row({}), platformSagBounds("KTM", "250 SX-F"))).toEqual({ target: 105, min: 102, max: 112 });
  expect(platformSagBounds("KTM", "300 SX")).toMatchObject({ target: 105, min: 102, max: 112 });
  expect(platformSagBounds("KTM", "300 EXC")).toMatchObject({ target: 105, min: 100, max: 110 });
  expect(platformSagBounds("Yamaha", "YZ250F")).toMatchObject({ target: 97, min: 95, max: 105 });
  expect(platformSagBounds("Sherco", "SE 300")).toMatchObject({ target: 98, min: 95, max: 100 });
  expect(platformSagBounds("Beta", "RR 300")).toMatchObject({ target: 100, min: 100, max: 115 });
  expect(platformSagBounds("KTM", "65 SX")).toBeNull(); // minis: no platform value
  expect(platformSagBounds("Stark", "Varg MX")).toBeNull();
  expect(resolveSagBounds(null, platformSagBounds("KTM", "300 SX"))).toEqual({ target: 105, min: 102, max: 112 });
  expect(resolveSagBounds(null, null)).toEqual(DEFAULT_SAG);
  expect(platformSagBounds("KTM", "300 SX")?.source).toMatch(/Owner's Manual/);
});

test("fork-air why-copy: WP's base is WP's, the per-weight step is ours", () => {
  const withBase = whyForYou("fork_air", 10.4, { riderWeightLbs: 172, terrain: "Hardpack", skill: "intermediate", stockAirBar: 10.6 });
  expect(withBase).toMatch(/^WP's base for this model is 10\.6 bar\. At 172 lbs on hardpack/);
  expect(withBase).toMatch(/our rule, not WP's/);
  const noBase = whyForYou("fork_air", 10.4, { riderWeightLbs: 172, terrain: "Hardpack", skill: "intermediate" });
  expect(noBase).not.toMatch(/WP/);
});
