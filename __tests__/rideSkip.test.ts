// Adjust's Skip records the suggestion and never applies it (finding 8, 2026-09-08).
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => { throw new Error("offline"); },
    rpc: () => { throw new Error("offline"); },
  },
}));

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { emptyDraft, recordSkipped, rideEffective, setAbsolute, settlePatch, startSession, type RideDraft } from "../lib/rideDay";
import type { SetupVersionRow } from "../lib/setupVersions";

const version = {
  id: "11111111-2222-4333-8444-555555555555",
  user_id: "u",
  bike_id: "b",
  version_number: 3,
  source: "refinement",
  parent_version_id: null,
  restored_from_version_id: null,
  fork_comp_clicks: 14,
  fork_reb_clicks: 12,
  fork_air_bar: 10.6,
  shock_lsc_clicks: 12,
  shock_hsc_turns: 1.5,
  shock_reb_clicks: 14,
  sag_mm: 105,
  sag_measured: false,
  notes: [],
  terrain: "Hardpack",
  context: null,
  recommended_settings: null,
  applied_settings: null,
  settings_delta: null,
  created_at: "2026-09-08T12:00:00Z",
} as unknown as SetupVersionRow;

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
    conditions: { surfaces: ["hardpack"], state: "fresh", temp: "mild", watered: false },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("a skipped suggestion is recorded, not applied: effective values and the settle patch ignore it", async () => {
  const s0 = await startSession(draft(), null);
  const before = rideEffective(s0);
  const s1 = await recordSkipped(s0, { circuit: "fork_comp", delta: -1, reason: "The front pushes." });
  expect(s1.skipped).toHaveLength(1);
  expect(s1.skipped?.[0]).toMatchObject({ circuit: "fork_comp", delta: -1, reason: "The front pushes.", afterMoto: 0 });
  expect(rideEffective(s1)).toEqual(before);
  expect(settlePatch(s1)).toEqual({});
  // A confirmed change next to it still settles on its own.
  const s2 = await setAbsolute(s1, "fork_reb", 13, "adjust", "A click faster.");
  expect(settlePatch(s2)).toEqual({ fork_reb: 1 });
  expect(s2.skipped).toHaveLength(1);
});
