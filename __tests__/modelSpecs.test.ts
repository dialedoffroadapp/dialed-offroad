// Decision 9 (2026-09-05): the spring PASS/FAIL card renders only for catalog
// rows whose sag window and rider weight range are sourced, the same rule the
// range bars use (click_range_verified). Everything else about the check is
// unchanged and pinned here for the first time.
jest.mock("../lib/supabase", () => ({ supabase: {} }));
jest.mock("../lib/bikes", () => ({ resolveModelId: async () => null }));

/* eslint-disable import/first */
import { computeSpringCheck, hasSourcedRanges, type ModelSpecs } from "../lib/modelSpecs";

const base: ModelSpecs = {
  id: "490e0276-f66a-4ef6-bbf1-ffbb2a4fe1b7",
  make: "Yamaha",
  model: "YZ250F",
  stock_sag_mm: 102,
  sag_min: 95,
  sag_max: 108,
  stock_fork_spring_nmm: 4.7,
  stock_shock_spring_nmm: 56,
  rider_weight_min_lbs: 150,
  rider_weight_max_lbs: 180,
  fork_type: "KYB SSS 48 coil",
  shock_type: "KYB linkage",
  has_air_fork: false,
  spec_verified: true,
  sag_window_verified: true,
  weight_range_verified: true,
};

test("no verdict without sourced ranges: either flag false, or the columns absent", () => {
  expect(computeSpringCheck({ ...base, sag_window_verified: false }, 170)).toBeUndefined();
  expect(computeSpringCheck({ ...base, weight_range_verified: false }, 170)).toBeUndefined();
  const { sag_window_verified, weight_range_verified, ...legacyRow } = base;
  void sag_window_verified;
  void weight_range_verified;
  expect(hasSourcedRanges(legacyRow)).toBe(false);
  expect(computeSpringCheck(legacyRow, 170)).toBeUndefined();
  expect(computeSpringCheck(null, 170)).toBeUndefined();
});

test("sourced ranges: ok inside, marginal within 10 lb, out_of_range beyond, with direction and rates carried", () => {
  expect(computeSpringCheck(base, 170)).toMatchObject({ status: "ok", component: "both", stock_fork_nmm: 4.7, stock_shock_nmm: 56, weight_range: [150, 180] });
  expect(computeSpringCheck(base, 188)).toMatchObject({ status: "marginal", direction: "stiffer" });
  expect(computeSpringCheck(base, 142)).toMatchObject({ status: "marginal", direction: "softer" });
  expect(computeSpringCheck(base, 205)).toMatchObject({ status: "out_of_range", direction: "stiffer" });
  expect(computeSpringCheck(base, undefined)).toBeUndefined();
});

test("air forks and SFF forks compare the shock only; no comparable spring means no check", () => {
  expect(computeSpringCheck({ ...base, has_air_fork: true, stock_fork_spring_nmm: null }, 170)).toMatchObject({ component: "shock", stock_fork_nmm: undefined });
  expect(computeSpringCheck({ ...base, fork_type: "Showa SFF coil" }, 170)).toMatchObject({ component: "shock" });
  expect(computeSpringCheck({ ...base, has_air_fork: true, stock_fork_spring_nmm: null, stock_shock_spring_nmm: null }, 170)).toBeUndefined();
});
