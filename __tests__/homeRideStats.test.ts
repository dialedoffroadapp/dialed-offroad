// Decision 3: ride days count on Home. Server feedback rows (one per moto,
// keyed by the moto's feedbackId) merge with archived ride days without
// double counting; season hours come from the ride days, not the meter.
jest.mock("../lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-router", () => ({ useFocusEffect: () => undefined, useRouter: () => ({ push: () => {}, replace: () => {} }) }));
jest.mock("../lib/purchases", () => ({ hasPurchasedThisSession: () => false }));
jest.mock("../lib/entitlement", () => ({ isEntitled: () => false, resolveEntitlement: async () => null }));
/* eslint-disable import/first */
import { homeRideStats } from "../lib/homeV3";

const season = Date.parse("2026-01-01T00:00:00");

test("unsynced motos count once, synced ones are not double counted; day one clears with a local ride day", () => {
  const feedback = [{ id: "fb-1", created_at: "2026-09-01T18:00:00Z" }];
  const history = [
    { startedAt: "2026-09-01T16:00:00Z", hoursAdded: 2.5, motos: [{ feedbackId: "fb-1", loggedAt: "2026-09-01T17:00:00Z" }, { feedbackId: "fb-2", loggedAt: "2026-09-01T18:30:00Z" }] },
    { startedAt: "2025-12-20T16:00:00Z", hoursAdded: 1, motos: [{ feedbackId: null, loggedAt: "2025-12-20T17:00:00Z" }] },
  ];
  const r = homeRideStats(feedback, history, season);
  expect(r.ridesAllTime).toBe(3);
  expect(r.ridesSeason).toBe(2);
  expect(r.rideDaysSeason).toBe(1);
  expect(r.hoursSeason).toBe(2.5);
});

test("nothing ridden: day one; no history means hours unknown, not zero", () => {
  const r = homeRideStats([], [], season);
  expect(r.ridesAllTime).toBe(0);
  expect(r.hoursSeason).toBeNull();
});
