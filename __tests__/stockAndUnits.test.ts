// Second report (2026-09-07): the vs-stock copy by tag, and the BFRC unit
// handling in Current Setup (quarter-turn LSC and rebound, no HSC).
import { circuitStep, circuitUnit } from "../lib/currentSetup";
import { formatSetting } from "../lib/format";
import { stockDeltaLine, stockLabel } from "../lib/stockCopy";

const specs = (over: Record<string, unknown>) => ({ id: "x", make: "KTM", model: "250 SX-F", stock_sag_mm: 105, sag_min: 102, sag_max: 112, stock_fork_spring_nmm: null, stock_shock_spring_nmm: 45, rider_weight_min_lbs: 165, rider_weight_max_lbs: 187, fork_type: "WP XACT air", shock_type: "WP linkage", has_air_fork: true, spec_verified: true, stock_fork_comp: 12, stock_shock_comp: 10, ...over }) as any;

test("vs-stock copy: factory and tuner rows read differently, inferred rows read as missing", () => {
  expect(stockLabel("factory")).toBe("factory stock");
  expect(stockLabel("tuner")).toBe("tuner-published stock");
  expect(stockLabel("inferred")).toBeNull();
  expect(stockLabel(null)).toBeNull();
  const tune = { fork: { comp_clicks: 14 }, shock: { lsc_clicks: 9 } };
  expect(stockDeltaLine(tune, specs({ stock_clicker_tag: "factory" }))).toEqual({ line: "Fork comp 2 clicks softer, shock LSC 1 click firmer than factory stock.", missing: false, tag: "factory" });
  expect(stockDeltaLine(tune, specs({ stock_clicker_tag: "tuner" })).line).toMatch(/than tuner-published stock\.$/);
  expect(stockDeltaLine(tune, specs({ stock_clicker_tag: "inferred" }))).toEqual({ line: null, missing: true, tag: "inferred" });
  expect(stockDeltaLine(tune, specs({ stock_clicker_tag: "factory", stock_fork_comp: null, stock_shock_comp: null })).missing).toBe(true);
  expect(stockDeltaLine({ fork: { comp_clicks: 12 }, shock: { lsc_clicks: 10 } }, specs({ stock_clicker_tag: "factory" })).line).toBe("Fork comp at stock, shock LSC at stock than factory stock.".replace(" than factory stock.", " than factory stock.") );
  expect(stockDeltaLine(tune, null).missing).toBe(true);
});

test("BFRC: shock LSC and rebound step by quarter turns with two decimals and no HSC; clicks elsewhere", () => {
  expect(circuitStep("shock_lsc", "turns")).toEqual({ step: 0.25, min: 0, max: 4, decimals: 2 });
  expect(circuitStep("shock_reb", "turns").step).toBe(0.25);
  expect(circuitStep("shock_lsc", "clicks").step).toBe(1);
  expect(circuitStep("fork_comp", "turns").step).toBe(1);
  expect(circuitUnit("shock_lsc", "turns")).toBe("turns");
  expect(circuitUnit("shock_reb", "turns")).toBe("turns");
  expect(circuitUnit("shock_lsc", "clicks")).toBe("clicks");
  expect(circuitUnit("shock_hsc", "clicks")).toBe("turns");
  expect(formatSetting(2.75, "shock_lsc", "turns")).toBe("2.75");
  expect(formatSetting(12, "shock_lsc", "clicks")).toBe("12");
  expect(formatSetting(2.5, "shock_reb", "turns")).toBe("2.5");
});
