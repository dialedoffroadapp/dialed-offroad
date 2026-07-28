// __tests__/rideArmCard.test.ts
// Lifecycle matrix for the Home ride-arm card (fresh / armed / feedback /
// snoozed / expired / new-version reset), the mutual-exclusion render gate,
// and storage round-trips.

jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  computeArmCardEligible,
  HOME_ARM_CARD_WINDOW_MS,
  HOME_ARM_SNOOZE_MS,
  homeArmSlotVisible,
  markArmCardArmed,
  readArmCardLocal,
  snoozeArmCard,
} from "../lib/rideArmCard";

const NOW = 1_800_000_000_000;
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

const fresh = (over: Partial<Parameters<typeof computeArmCardEligible>[0]> = {}) => ({
  candidate: { versionId: V1, createdAtMs: NOW - 60_000 },
  hasFeedback: false,
  local: { armedVersionIds: [], snoozes: {} },
  now: NOW,
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("computeArmCardEligible — lifecycle", () => {
  test("fresh version inside the window → eligible", () => {
    expect(computeArmCardEligible(fresh())).toBe(true);
  });

  test("no candidate → hidden", () => {
    expect(computeArmCardEligible(fresh({ candidate: null }))).toBe(false);
  });

  test("armed (either surface) → hidden permanently", () => {
    expect(
      computeArmCardEligible(
        fresh({ local: { armedVersionIds: [V1], snoozes: {} } })
      )
    ).toBe(false);
  });

  test("feedback submitted → hidden permanently", () => {
    expect(computeArmCardEligible(fresh({ hasFeedback: true }))).toBe(false);
  });

  test("snoozed → hidden until the 24h passes, then back", () => {
    const snoozed = fresh({
      local: { armedVersionIds: [], snoozes: { [V1]: NOW + 1000 } },
    });
    expect(computeArmCardEligible(snoozed)).toBe(false);
    expect(computeArmCardEligible({ ...snoozed, now: NOW + 1001 })).toBe(true);
  });

  test("older than 14 days → expired", () => {
    expect(
      computeArmCardEligible(
        fresh({
          candidate: {
            versionId: V1,
            createdAtMs: NOW - HOME_ARM_CARD_WINDOW_MS - 1,
          },
        })
      )
    ).toBe(false);
  });

  test("new setup version resets the cycle (old latches don't apply)", () => {
    expect(
      computeArmCardEligible(
        fresh({
          candidate: { versionId: V2, createdAtMs: NOW - 60_000 },
          local: {
            armedVersionIds: [V1],
            snoozes: { [V1]: NOW + HOME_ARM_SNOOZE_MS },
          },
        })
      )
    ).toBe(true);
  });
});

describe("homeArmSlotVisible — mutual exclusion with check-in cards", () => {
  const base = {
    paywallDecliner: false,
    checkinDecided: true,
    checkinVisible: false,
    armEligible: true,
  };

  test("eligible + check-in decided-hidden → shows", () => {
    expect(homeArmSlotVisible(base)).toBe(true);
  });

  test("a rendering check-in card ALWAYS wins", () => {
    expect(homeArmSlotVisible({ ...base, checkinVisible: true })).toBe(false);
  });

  test("nothing renders before the check-in decision (no flash-then-hide)", () => {
    expect(
      homeArmSlotVisible({ ...base, checkinDecided: false })
    ).toBe(false);
  });

  test("paywall decliners never see it", () => {
    expect(homeArmSlotVisible({ ...base, paywallDecliner: true })).toBe(false);
  });

  test("ineligible stays hidden even with the slot free", () => {
    expect(homeArmSlotVisible({ ...base, armEligible: false })).toBe(false);
  });
});

describe("local state round-trips", () => {
  test("markArmCardArmed persists and dedupes", async () => {
    await markArmCardArmed(V1);
    await markArmCardArmed(V1);
    const local = await readArmCardLocal();
    expect(local.armedVersionIds).toEqual([V1]);
  });

  test("snoozeArmCard stamps now+24h for exactly that version", async () => {
    await snoozeArmCard(V1, NOW);
    const local = await readArmCardLocal();
    expect(local.snoozes[V1]).toBe(NOW + HOME_ARM_SNOOZE_MS);
    expect(local.snoozes[V2]).toBeUndefined();
  });

  test("malformed storage reads as empty state", async () => {
    await AsyncStorage.setItem("dialed_ride_arm_card_v1", "{not json");
    const local = await readArmCardLocal();
    expect(local).toEqual({ armedVersionIds: [], snoozes: {} });
  });
});
