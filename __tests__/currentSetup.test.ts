// Current Setup offline store: pending-delta math, clamps, undo, cache
// round-trip, base-supersession on refresh, and the air-row conditional.

jest.mock("../lib/supabase", () => ({ supabase: {} }));
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));

const mockGetVersionHistory = jest.fn();
jest.mock("../lib/setupVersions", () => ({
  ...jest.requireActual("../lib/setupVersions"),
  getVersionHistory: (...args: unknown[]) => mockGetVersionHistory(...args),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  adjust,
  CIRCUIT_STEPS,
  effectiveSettings,
  loadCachedSetup,
  refreshSetupFromServer,
  resolveShowsAir,
  snapshotFromVersion,
  undoLast,
  type CurrentSetupState,
} from "../lib/currentSetup";

const BIKE = "11111111-1111-4111-8111-111111111111";

const baseState = (over: Partial<CurrentSetupState> = {}): CurrentSetupState => ({
  bikeId: BIKE,
  baseVersionId: "v1",
  baseVersionNumber: 3,
  base: {
    fork_comp: 12,
    fork_reb: 12,
    fork_air: null,
    shock_lsc: 10,
    shock_hsc: 1.5,
    shock_reb: 12,
    shock_sag: 105,
  },
  pending: [],
  hasAirFork: false,
  fetchedAt: null,
  ...over,
});

const versionRow = (over: Record<string, unknown> = {}) =>
  ({
    id: "v-new",
    version_number: 4,
    fork_comp_clicks: 14,
    fork_reb_clicks: 11,
    fork_air_bar: null,
    shock_lsc_clicks: 10,
    shock_hsc_turns: 1,
    shock_reb_clicks: 13,
    sag_mm: 104,
    applied_settings: null,
    recommended_settings: null,
    ...over,
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  return AsyncStorage.clear();
});

describe("adjust + effectiveSettings", () => {
  it("logs a delta and the effective value moves by the circuit step", async () => {
    let s = baseState();
    s = await adjust(s, "fork_comp", 1);
    s = await adjust(s, "shock_hsc", -1);
    expect(effectiveSettings(s).fork_comp).toBe(13);
    expect(effectiveSettings(s).shock_hsc).toBe(1.25); // quarter-turn step
    expect(s.pending).toHaveLength(2);
  });

  it("clamps at the range edge and refuses to log a no-op tap", async () => {
    let s = baseState({ base: { ...baseState().base, fork_comp: CIRCUIT_STEPS.fork_comp.max } });
    s = await adjust(s, "fork_comp", 1);
    expect(s.pending).toHaveLength(0); // already at max: nothing logged
    expect(effectiveSettings(s).fork_comp).toBe(CIRCUIT_STEPS.fork_comp.max);
  });

  it("never invents a value for a null circuit", async () => {
    let s = baseState(); // fork_air is null
    s = await adjust(s, "fork_air", 1);
    expect(s.pending).toHaveLength(0);
    expect(effectiveSettings(s).fork_air).toBeNull();
  });

  it("avoids float drift on air steps", async () => {
    let s = baseState({ base: { ...baseState().base, fork_air: 10.6 }, hasAirFork: true });
    s = await adjust(s, "fork_air", 1);
    s = await adjust(s, "fork_air", 1);
    s = await adjust(s, "fork_air", -1);
    expect(effectiveSettings(s).fork_air).toBe(10.7);
  });
});

describe("undoLast", () => {
  it("removes only the most recent tap", async () => {
    let s = baseState();
    s = await adjust(s, "fork_comp", 1);
    s = await adjust(s, "shock_reb", -1);
    s = await undoLast(s);
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0].circuit).toBe("fork_comp");
    expect(effectiveSettings(s).shock_reb).toBe(12);
  });

  it("is a no-op on an empty log", async () => {
    const s = await undoLast(baseState());
    expect(s.pending).toHaveLength(0);
  });
});

describe("cache round-trip + refresh", () => {
  it("adjust persists; loadCachedSetup returns the same state", async () => {
    let s = baseState();
    s = await adjust(s, "fork_comp", 1);
    const back = await loadCachedSetup(BIKE);
    expect(back?.pending).toHaveLength(1);
    expect(effectiveSettings(back!).fork_comp).toBe(13);
  });

  it("offline refresh (history throws) returns the cache untouched", async () => {
    let s = baseState();
    await adjust(s, "fork_comp", 1);
    mockGetVersionHistory.mockRejectedValue(new Error("offline"));
    const out = await refreshSetupFromServer(BIKE, false);
    expect(out?.pending).toHaveLength(1);
  });

  it("a NEW server version replaces the base and drops stale pending taps", async () => {
    let s = baseState();
    await adjust(s, "fork_comp", 1); // pending against baseVersionId v1
    mockGetVersionHistory.mockResolvedValue([versionRow()]);
    const out = await refreshSetupFromServer(BIKE, false);
    expect(out?.baseVersionId).toBe("v-new");
    expect(out?.base.fork_comp).toBe(14);
    expect(out?.pending).toHaveLength(0);
  });

  it("the SAME server version keeps pending taps", async () => {
    let s = baseState({ baseVersionId: "v-new" });
    await adjust(s, "fork_comp", 1);
    mockGetVersionHistory.mockResolvedValue([versionRow()]);
    const out = await refreshSetupFromServer(BIKE, false);
    expect(out?.pending).toHaveLength(1);
  });
});

describe("snapshotFromVersion", () => {
  it("typed columns win; jsonb fills gaps only", () => {
    const snap = snapshotFromVersion(
      versionRow({
        fork_comp_clicks: null,
        applied_settings: { fork_comp: 9, fork_reb: 99 },
      })
    );
    expect(snap.fork_comp).toBe(9); // gap filled
    expect(snap.fork_reb).toBe(11); // typed column kept
  });
});

describe("resolveShowsAir (RIVER-Q 7 conditional)", () => {
  const withAir = { ...baseState().base, fork_air: 10.6 };
  const noAir = baseState().base;

  it("verified model flag is authoritative both ways", () => {
    expect(resolveShowsAir(true, noAir)).toBe(true);
    expect(resolveShowsAir(false, withAir)).toBe(false);
  });

  it("unmatched bike falls back to the setup's air value", () => {
    expect(resolveShowsAir(null, withAir)).toBe(true);
    expect(resolveShowsAir(undefined, noAir)).toBe(false);
  });
});
