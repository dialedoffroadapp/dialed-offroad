// Sag page (2026-09-07): the three-measurement math, the verdicts and copy
// (factory vs typical), the save path (rows written, errors surface) and
// the recheck trigger.
import AsyncStorage from "@react-native-async-storage/async-storage";

type Call = { table: string; op: string; payload?: unknown };
const calls: Call[] = [];
let insertError: { message: string } | null = null;
let rideDayCount: number | null = 3;

function chain(table: string) {
  const self: any = {
    insert(payload: unknown) {
      calls.push({ table, op: "insert", payload });
      return self;
    },
    select(_c?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) return { eq: () => ({ gt: async () => ({ count: rideDayCount, error: rideDayCount === null ? new Error("offline") : null }) }) };
      return self;
    },
    eq() {
      return self;
    },
    order() {
      return self;
    },
    limit: async () => ({ data: [], error: null }),
    single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "m1", measured_at: "2026-09-07T10:00:00.000Z", riding_mm: 104, static_mm: 33 }, error: null }),
  };
  return self;
}
const logEvent = jest.fn();
jest.mock("../lib/usage", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
jest.mock("../lib/rideDay", () => ({ readHistory: async () => [{ bike: { id: "b" }, quick: false, startedAt: "2026-09-05T00:00:00.000Z" }, { bike: { id: "b" }, quick: true, startedAt: "2026-09-06T00:00:00.000Z" }] }));
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (t: string) => chain(t),
  },
}));

/* eslint-disable import/first */
import { dismissSagRecheck, rangeLabel, rideDaysSince, ridingVerdict, sagMath, sagRecheckDismissedToday, sagRecheckDue, saveSagMeasurement, SPRING_RULE_LINE, springRuleApplies, staticVerdict, verdictLine } from "../lib/sag";

const BIKE = "3f9a2c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";
const VERSION = "9c2b4d6e-1f3a-4b5c-8d7e-0f1a2b3c4d5e";
const BOUNDS = { target: 105, min: 102, max: 112 };

beforeEach(async () => {
  calls.length = 0;
  insertError = null;
  rideDayCount = 3;
  logEvent.mockClear();
  await AsyncStorage.clear();
});

test("math: static = A minus B, riding = A minus C, null until both numbers exist", () => {
  expect(sagMath({ a: 610, b: 577, c: 506 })).toEqual({ staticMm: 33, ridingMm: 104 });
  expect(sagMath({ a: 610, b: null, c: 506 })).toEqual({ staticMm: null, ridingMm: 104 });
  expect(sagMath({ a: null, b: 577, c: 506 })).toEqual({ staticMm: null, ridingMm: null });
});

test("verdicts and copy: window and static target; factory vs typical", () => {
  expect(ridingVerdict(104, BOUNDS)).toBe("in_range");
  expect(ridingVerdict(98, BOUNDS)).toBe("low");
  expect(ridingVerdict(115, BOUNDS)).toBe("high");
  expect(ridingVerdict(null, BOUNDS)).toBe("unknown");
  expect(staticVerdict(33, 33)).toBe("in_range");
  expect(staticVerdict(40, 33)).toBe("high");
  expect(staticVerdict(33, null)).toBe("unknown");
  expect(rangeLabel(true)).toBe("factory range");
  expect(rangeLabel(false)).toBe("typical range");
  expect(rangeLabel(null)).toBe("typical range");
  expect(verdictLine("riding", "low", BOUNDS)).toMatch(/sits high/);
  expect(verdictLine("riding", "in_range", BOUNDS)).toMatch(/102 to 112 mm, target 105/);
  expect(springRuleApplies("in_range", "high")).toBe(true);
  expect(springRuleApplies("low", "high")).toBe(false);
  expect(SPRING_RULE_LINE).toMatch(/Change the spring, not the preload/);
  expect(SPRING_RULE_LINE).not.toMatch(/—/);
});

test("save: one measurement row linked to the version, never a version update, the event; from the recheck also completes it", async () => {
  const saved = await saveSagMeasurement({ bikeId: BIKE, versionId: VERSION, a: 610, b: 577, c: 506, bounds: BOUNDS, fromRecheck: true });
  expect(saved.riding_mm).toBe(104);
  expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(["sag_measurements:insert"]); // setup_versions stays immutable
  expect(calls[0].payload).toMatchObject({ user_id: "u1", bike_id: BIKE, version_id: VERSION, a_mm: 610, b_mm: 577, c_mm: 506, riding_mm: 104, static_mm: 33 });
  expect(logEvent).toHaveBeenCalledWith("sag_measured_saved", expect.objectContaining({ bike_id: BIKE, version_id: VERSION, riding_mm: 104, in_range: true }));
  expect(logEvent).toHaveBeenCalledWith("sag_recheck_completed", { bike_id: BIKE });
});

test("save: no version = a row with no version link; bad numbers and a failed write surface as errors", async () => {
  await saveSagMeasurement({ bikeId: BIKE, versionId: null, a: 610, b: 577, c: 506, bounds: BOUNDS });
  expect(calls.map((c) => c.op)).toEqual(["insert"]);
  expect(calls[0].payload).toMatchObject({ version_id: null });
  await expect(saveSagMeasurement({ bikeId: BIKE, versionId: null, a: 500, b: 577, c: 506, bounds: BOUNDS })).rejects.toThrow(/do not add up/);
  // B is optional at save (finding 1): riding only, static stored as 0.
  calls.length = 0;
  await saveSagMeasurement({ bikeId: BIKE, versionId: null, a: 615, b: null, c: 510, bounds: BOUNDS });
  expect(calls[0].payload).toMatchObject({ riding_mm: 105, static_mm: 0, b_mm: 615 });
  insertError = { message: "relation sag_measurements does not exist" };
  await expect(saveSagMeasurement({ bikeId: BIKE, versionId: null, a: 610, b: 577, c: 506, bounds: BOUNDS })).rejects.toThrow(/Couldn't save the measurement/);
});

test("recheck: due when never measured or when the ride days reach the threshold; dismiss hides it for the day", async () => {
  expect(sagRecheckDue({ lastMeasuredAt: null, rideDaysSince: 0, threshold: 5 })).toBe(true);
  expect(sagRecheckDue({ lastMeasuredAt: "2026-09-01T00:00:00Z", rideDaysSince: 2, threshold: 5 })).toBe(false);
  expect(sagRecheckDue({ lastMeasuredAt: "2026-09-01T00:00:00Z", rideDaysSince: 5, threshold: 5 })).toBe(true);
  expect(sagRecheckDue({ lastMeasuredAt: "2026-09-01T00:00:00Z", rideDaysSince: 50, threshold: 0 })).toBe(false);
  expect(await rideDaysSince(BIKE, "2026-09-01T00:00:00Z")).toBe(3); // the server count
  rideDayCount = null; // server offline: the device's ride history, quick refines excluded
  expect(await rideDaysSince("b", "2026-09-01T00:00:00Z")).toBe(1);
  expect(await rideDaysSince(BIKE, null)).toBe(0);
  expect(await sagRecheckDismissedToday(BIKE)).toBe(false);
  await dismissSagRecheck(BIKE);
  expect(await sagRecheckDismissedToday(BIKE)).toBe(true);
  expect(await sagRecheckDismissedToday(BIKE, new Date(Date.now() + 86400000 * 2))).toBe(false);
});
