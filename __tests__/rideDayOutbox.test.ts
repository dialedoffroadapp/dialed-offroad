// Audit item 2: the outbox conflict target must match the (user_id, local_id)
// unique indexes on ride_days and track_sessions exactly. With "local_id"
// alone Postgres raised 42P10 on every job and no ride day ever synced.
import AsyncStorage from "@react-native-async-storage/async-storage";

const upserts: { table: string; row: any; opts: any }[] = [];
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "11111111-2222-4333-8444-555555555555" } } }) },
    from: (table: string) => ({
      upsert: (row: any, opts: any) => {
        upserts.push({ table, row, opts });
        const res = { data: { id: table === "ride_days" ? "day-srv-1" : "moto-srv-1" }, error: null };
        return Object.assign(Promise.resolve(res), { select: () => ({ single: async () => res }) });
      },
    }),
  },
}));
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));
const createManualVersion = jest.fn(async (_params: any) => ({ id: "v-settled", version_number: 3 }));
jest.mock("../lib/bikeSetups", () => ({ createManualVersion: (p: any) => createManualVersion(p) }));

/* eslint-disable import/first */
import { enqueue, flushOutbox, settlePatch, type RideSession } from "../lib/rideDay";

const session: RideSession = {
  localId: "day-local-1",
  serverId: null,
  userId: "11111111-2222-4333-8444-555555555555",
  bike: { id: "22222222-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026, nickname: null, model_id: null },
  setupId: null,
  setupName: "Baseline",
  startingVersionId: "33333333-2222-4333-8444-555555555555",
  startingVersionNumber: 1,
  base: { fork_comp: 12, fork_reb: 10, fork_air: null, shock_lsc: 10, shock_hsc: 1.5, shock_reb: 12, shock_sag: 105 } as any,
  hasAirFork: false,
  trackId: null,
  trackName: "Local",
  conditions: { surfaces: ["hardpack"], state: "fresh", temp: "mild", watered: false },
  startedAt: "2026-09-04T16:00:00.000Z",
  endedAt: null,
  lastActiveAt: "2026-09-04T16:00:00.000Z",
  pending: [],
  motos: [
    { seq: 1, loggedAt: "2026-09-04T16:30:00.000Z", sentiment: "better", symptoms: [{ id: "rear_kicks", qualifier: "Whoops", label: "Rear kicks" }], note: "loose out back", durationMin: 30, laps: null, values: {} as any, localId: "moto-local-1", serverId: null, feedbackId: "44444444-2222-4333-8444-555555555555" },
  ],
  suggestionShown: false,
  suggestionApplied: false,
} as any;

beforeEach(async () => {
  upserts.length = 0;
  await AsyncStorage.clear();
});

test("ride_days and track_sessions upserts name the full (user_id, local_id) conflict target", async () => {
  await enqueue({ kind: "ride_day_upsert", localId: session.localId });
  await enqueue({ kind: "moto_insert", localId: session.localId, motoLocalId: "moto-local-1" });
  await enqueue({ kind: "moto_feedback", localId: session.localId, motoLocalId: "moto-local-1" });
  const done = await flushOutbox(session);
  expect(done).toBe(3);
  const day = upserts.find((u) => u.table === "ride_days");
  const moto = upserts.find((u) => u.table === "track_sessions");
  expect(day?.opts).toEqual({ onConflict: "user_id,local_id" });
  expect(moto?.opts).toEqual({ onConflict: "user_id,local_id" });
  expect(day?.row).toMatchObject({ user_id: session.userId, local_id: "day-local-1" });
  expect(moto?.row).toMatchObject({ user_id: session.userId, ride_day_id: "day-srv-1", local_id: "moto-local-1", duration_min: 30, laps: null });
  expect(session.serverId).toBe("day-srv-1");
  // decision 3: one ride_feedback row per moto, upserted by its client-minted id
  const fb = upserts.find((u) => u.table === "ride_feedback");
  expect(fb?.opts).toEqual({ onConflict: "id" });
  expect(fb?.row).toMatchObject({ id: "44444444-2222-4333-8444-555555555555", user_id: session.userId, setup_version_id: session.startingVersionId, overall_rating: expect.any(Number), free_text: "loose out back", created_at: "2026-09-04T16:30:00.000Z" });
  expect(fb?.row.symptoms).toEqual([{ id: "rear_kicks", severity: expect.any(Number), where: "Whoops" }]);
});

test("settle_version job: the day settles into ONE manual version from the outbox, idempotently", async () => {
  const ended: RideSession = {
    ...session,
    localId: "day-local-2",
    endedAt: "2026-09-04T19:00:00.000Z",
    pending: [{ circuit: "fork_comp", delta: -2, at: "2026-09-04T17:00:00.000Z", kind: "adjust", reason: "Harsh", afterMoto: 1 }],
  } as any;
  expect(settlePatch(ended)).toEqual({ fork_comp: -2 });
  await enqueue({ kind: "settle_version", localId: ended.localId });
  expect(await flushOutbox(ended)).toBe(1);
  expect(createManualVersion).toHaveBeenCalledTimes(1);
  const call = createManualVersion.mock.calls[0][0] as any;
  expect(call).toMatchObject({ bikeId: ended.bike.id, parentId: ended.startingVersionId, patch: { fork_comp_clicks: 10 } });
  expect(ended.settledVersionId).toBe("v-settled");
  // a second flush of the same session writes nothing
  await enqueue({ kind: "settle_version", localId: ended.localId });
  await flushOutbox(ended);
  expect(createManualVersion).toHaveBeenCalledTimes(1);
});
