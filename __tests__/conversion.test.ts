// Conversion model pure logic: entitlement math, gate placements/copy,
// pricing framing, meter stall.
import { __setRemoteConfigForTests } from "../lib/remoteConfig";
import { FREE_ENTITLEMENT, isEntitled, trialDaysLeft, trialLine, trialNearEnd, trialRidesLeft, type Entitlement } from "../lib/entitlement";
import { GATE_COPY, anchorLine } from "../lib/gateCopy";
import { meterStalled, stallLine } from "../lib/meterStall";
import { gateTriggerFor, placementId } from "../lib/placements";
import { annualDiscountPct, lifetimeFallbackPrice, lifetimeVisible, monthlyEquivalentLine, perRideDayLine } from "../lib/pricing";

jest.mock("../lib/supabase", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) }, rpc: () => ({ single: async () => ({ data: null, error: null }) }), from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) } }));
jest.mock("../lib/purchases", () => ({ hasPurchasedThisSession: () => false, isWeb: true, getOfferings: async () => null, purchasePackage: async () => null, syncProFromRevenueCat: async () => false, markPurchasedThisSession: () => {}, restorePurchases: async () => null, setSubscriberAttributes: async () => {} }));
jest.mock("react-native-purchases", () => ({ __esModule: true, default: { getCurrentOfferingForPlacement: async () => null, setAttributes: async () => {} } }));

const NOW = Date.parse("2026-09-10T12:00:00Z");
const trial = (over: Partial<Entitlement>): Entitlement => ({
  ...FREE_ENTITLEMENT,
  state: "trial_active",
  trialRideDays: 0,
  trialRideDayLimit: 3,
  trialStartedAt: "2026-09-01T00:00:00Z",
  trialEndsAt: "2026-09-22T00:00:00Z",
  ...over,
});

describe("entitlement", () => {
  test("trial_active and pro are entitled; free is not", () => {
    expect(isEntitled(trial({}))).toBe(true);
    expect(isEntitled({ ...FREE_ENTITLEMENT, state: "pro" })).toBe(true);
    expect(isEntitled(FREE_ENTITLEMENT)).toBe(false);
    expect(isEntitled(null)).toBe(false);
  });
  test("rides left, days left, near end (last ride OR ≤ 3 days)", () => {
    expect(trialRidesLeft(trial({ trialRideDays: 2 }))).toBe(1);
    expect(trialDaysLeft(trial({}), NOW)).toBe(12);
    expect(trialNearEnd(trial({}), NOW)).toBe(false);
    expect(trialNearEnd(trial({ trialRideDays: 2 }), NOW)).toBe(true);
    expect(trialNearEnd(trial({ trialEndsAt: "2026-09-12T00:00:00Z" }), NOW)).toBe(true);
    expect(trialNearEnd(FREE_ENTITLEMENT, NOW)).toBe(false);
  });
  test("home trial line", () => {
    expect(trialLine(trial({}), NOW)).toBe("Pro on for your next 3 rides");
    expect(trialLine(trial({ trialRideDays: 2, trialEndsAt: new Date(NOW + 2 * 86400000).toISOString() }), NOW)).toBe("Pro on for your next ride, or 2 days");
    expect(trialLine(FREE_ENTITLEMENT)).toBeNull();
  });
});

describe("gates", () => {
  test("every trigger folds onto one of the six placements with copy", () => {
    for (const t of ["log_moto", "adjust", "second_setup", "second_bike", "history", "tire_pressure"] as const) {
      expect(gateTriggerFor(t)).toBe(t);
      expect(placementId(t)).toBe(`feature_gate_${t}`);
      expect(GATE_COPY[t].payoff.length).toBeGreaterThan(20);
      expect(GATE_COPY[t].action).toMatch(/Pro\.$/);
    }
    expect(gateTriggerFor("refine")).toBe("adjust");
    expect(gateTriggerFor("setup_history")).toBe("history");
    expect(gateTriggerFor("save_preset")).toBe("adjust");
  });
  test("cost anchor names tuner, revalve, and the live annual price", () => {
    const a = anchorLine("$59.99");
    expect(a).toContain("$500");
    expect(a).toContain("$295 to $600");
    expect(a).toContain("$59.99 a year");
    expect(anchorLine(null)).toContain("$59.99");
    expect(a).not.toMatch(/—/);
  });
});

describe("pricing", () => {
  beforeEach(() => __setRemoteConfigForTests({ lifetime_price_usd: 149, lifetime_min_ride_days: 3 }));
  test("annual discount vs monthly, per-ride-day, monthly equivalent", () => {
    expect(annualDiscountPct(7.99, 59.99)).toBe(37);
    expect(perRideDayLine(59.99)).toBe("about $1 per ride day");
    expect(perRideDayLine(99)).toBe("about $1.98 per ride day");
    expect(monthlyEquivalentLine(59.99)).toBe("$5.00 a month, billed once");
  });
  test("lifetime hides until 3 ride days; price is config-driven", () => {
    expect(lifetimeVisible(2)).toBe(false);
    expect(lifetimeVisible(3)).toBe(true);
    expect(lifetimeFallbackPrice()).toBe(149);
    __setRemoteConfigForTests({});
    expect(lifetimeFallbackPrice()).toBe(129);
  });
});

describe("meter stall", () => {
  const cats = [
    { key: "baseline" as const, label: "Baseline", weight: 20, progress: 1, state: "done" as const, caption: "" },
    { key: "sag" as const, label: "Sag", weight: 15, progress: 1, state: "done" as const, caption: "" },
    { key: "first_ride" as const, label: "First ride", weight: 15, progress: 1, state: "done" as const, caption: "" },
    { key: "refined" as const, label: "Refined", weight: 30, progress: 0, state: "open" as const, caption: "" },
    { key: "consistency" as const, label: "Outcomes", weight: 20, progress: 0, state: "open" as const, caption: "" },
  ];
  test("stalls only in free, after two equal ride-day readings, with only locked categories left", () => {
    expect(meterStalled({ rideDayMeters: [50, 50], categories: cats, lockedKeys: ["refined", "consistency"], state: "free" })).toBe(true);
    expect(meterStalled({ rideDayMeters: [50, 50], categories: cats, lockedKeys: ["refined", "consistency"], state: "trial_active" })).toBe(false);
    expect(meterStalled({ rideDayMeters: [50, 45], categories: cats, lockedKeys: ["refined", "consistency"], state: "free" })).toBe(false);
    expect(meterStalled({ rideDayMeters: [50], categories: cats, lockedKeys: ["refined", "consistency"], state: "free" })).toBe(false);
    expect(meterStalled({ rideDayMeters: [50, 50], categories: cats, lockedKeys: ["refined"], state: "free" })).toBe(false);
    expect(stallLine(50, cats, ["refined", "consistency"])).toBe("You're 50% dialed. The next 50% is Pro: refined and outcomes.");
  });
});
