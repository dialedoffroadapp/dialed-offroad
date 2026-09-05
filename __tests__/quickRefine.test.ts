// Device pass round 3, item 5: "Refine after ride" runs the ride-day Log →
// Adjust on a QUICK session. It must never write ride_days / track_sessions,
// must still write one ride_feedback row per moto with the chip's tap-level
// severity, and must link that row to the version it settled into.
import AsyncStorage from "@react-native-async-storage/async-storage";

const upserts: { table: string; row: any }[] = [];
const updates: { table: string; row: any; eq: [string, string] }[] = [];
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "11111111-2222-4333-8444-555555555555" } } }) },
    from: (table: string) => ({
      upsert: (row: any) => {
        upserts.push({ table, row });
        const res = { data: { id: "srv-1" }, error: null };
        return Object.assign(Promise.resolve(res), { select: () => ({ single: async () => res }) });
      },
      update: (row: any) => ({
        eq: async (col: string, val: string) => {
          updates.push({ table, row, eq: [col, val] });
          return { error: null };
        },
      }),
    }),
  },
}));
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));
const createManualVersion = jest.fn(async (_p: any) => ({ id: "44444444-2222-4333-8444-555555555555", version_number: 2 }));
jest.mock("../lib/bikeSetups", () => ({ createManualVersion: (p: any) => createManualVersion(p) }));
jest.mock("../lib/rideLiveActivity", () => ({ endRideActivity: async () => {} }));

/* eslint-disable import/first */
import { logMoto, readHistory, readOpenSession, readOutbox, setAbsolute, startQuickRefineSession } from "../lib/rideDay";

/** logMoto kicks off a background flush; wait for the outbox to drain. */
async function drained(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if ((await readOutbox()).length === 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("outbox did not drain");
}
import { finishQuickRefine } from "../lib/rideEnd";
import { severityFor } from "../lib/rideSymptoms";

const version: any = {
  id: "33333333-2222-4333-8444-555555555555",
  version_number: 1,
  bike_id: "22222222-2222-4333-8444-555555555555",
  fork_comp_clicks: 12,
  fork_reb_clicks: 10,
  fork_air_bar: null,
  shock_lsc_clicks: 10,
  shock_hsc_turns: 1.5,
  shock_reb_clicks: 12,
  sag_mm: 105,
  terrain: "Hardpack",
};

beforeEach(async () => {
  await AsyncStorage.clear();
  upserts.length = 0;
  updates.length = 0;
  createManualVersion.mockClear();
});

test("severity: chip tap level wins over sentiment; sentiment is the fallback", () => {
  expect(severityFor("better", "mild")).toBe(4);
  expect(severityFor("better", "bad")).toBe(8);
  expect(severityFor("worse", null)).toBe(8);
  expect(severityFor("same")).toBe(6);
  expect(severityFor("better")).toBe(4);
});

test("a quick session queues no ride-day rows, writes the feedback row with the tap level", async () => {
  const s = await startQuickRefineSession({
    bike: { id: version.bike_id, make: "KTM", model: "250 SX-F", year: 2026, nickname: null, model_id: null },
    setupId: null,
    setupName: "Baseline",
    startingVersion: version,
    hasAirFork: false,
    userId: "11111111-2222-4333-8444-555555555555",
  });
  expect(s.quick).toBe(true);
  expect(await readOutbox()).toEqual([]);
  await logMoto(s, { sentiment: "better", symptoms: [{ id: "rear_kicks_accel", qualifier: "Landings", label: "Rear kicks", level: "bad" }], note: null });
  await drained();
  expect(upserts.map((u) => u.table)).toEqual(["ride_feedback"]);
  expect(upserts[0].row.symptoms).toEqual([{ id: "rear_kicks_accel", severity: 8, where: "Landings" }]);
  expect(upserts[0].row.setup_version_id).toBe(version.id);
});

test("Done settles ONE version on the setup, links the feedback row, and leaves the open slot", async () => {
  let s = await startQuickRefineSession({
    bike: { id: version.bike_id, make: "KTM", model: "250 SX-F", year: 2026, nickname: null, model_id: null },
    setupId: "55555555-2222-4333-8444-555555555555",
    setupName: "Sand setup",
    startingVersion: version,
    hasAirFork: false,
    userId: "11111111-2222-4333-8444-555555555555",
  });
  s = await logMoto(s, { sentiment: "worse", symptoms: [{ id: "harsh_braking_bumps", qualifier: null, label: "Harsh", level: "mild" }], note: "chattery" });
  s = (await setAbsolute(s, "fork_comp", 14, "adjust", "Softer on the small stuff")) as any;
  const r = await finishQuickRefine(s);
  expect(r.version?.version_number).toBe(2);
  expect(r.queued).toBe(false);
  expect(createManualVersion).toHaveBeenCalledTimes(1);
  const call = createManualVersion.mock.calls[0][0];
  expect(call.setupId).toBe("55555555-2222-4333-8444-555555555555");
  expect(call.parentId).toBe(version.id);
  expect(call.note).toBe("Refined after a ride: 1 change");
  expect(updates).toEqual([{ table: "ride_feedback", row: { resulting_version_id: "44444444-2222-4333-8444-555555555555" }, eq: ["id", s.motos[0].feedbackId] }]);
  expect(await readOpenSession()).toBeNull();
  expect((await readHistory())[0]?.settledVersionId).toBe("44444444-2222-4333-8444-555555555555");
});
