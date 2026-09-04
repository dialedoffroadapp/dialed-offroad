// Remote-switchable paywall position: build default, device cache, remote
// refresh with timeout, parse tolerance.
import AsyncStorage from "@react-native-async-storage/async-storage";

let remoteValue: unknown = undefined;
let remoteDelayMs = 0;
let remoteThrows = false;
jest.mock("../lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            new Promise((resolve, reject) => {
              setTimeout(() => {
                if (remoteThrows) reject(new Error("offline"));
                else resolve({ data: remoteValue === undefined ? null : { value: remoteValue }, error: null });
              }, remoteDelayMs);
            }),
        }),
      }),
    }),
  },
}));

/* eslint-disable import/first */
import {
  __setPaywallPositionForTests,
  getPaywallPosition,
  hydratePaywallPositionFromCache,
  isActionGatedPaywall,
  parsePaywallPosition,
  refreshPaywallPositionFromRemote,
} from "../lib/paywallPosition";

beforeEach(async () => {
  await AsyncStorage.clear();
  remoteValue = undefined;
  remoteDelayMs = 0;
  remoteThrows = false;
  __setPaywallPositionForTests(null);
});

test("build default is action_gated on this branch", () => {
  expect(getPaywallPosition()).toBe("action_gated");
  expect(isActionGatedPaywall()).toBe(true);
});

test("parse tolerates garbage", () => {
  expect(parsePaywallPosition("interstitial")).toBe("interstitial");
  expect(parsePaywallPosition("action_gated")).toBe("action_gated");
  expect(parsePaywallPosition("ACTION_GATED")).toBeNull();
  expect(parsePaywallPosition(null)).toBeNull();
  expect(parsePaywallPosition({ value: "interstitial" })).toBeNull();
});

test("device cache wins over the build default", async () => {
  await AsyncStorage.setItem("dialed_paywall_position_v1", "interstitial");
  expect(await hydratePaywallPositionFromCache()).toBe("interstitial");
  expect(getPaywallPosition()).toBe("interstitial");
});

test("remote value wins and is cached for the next cold start", async () => {
  remoteValue = "interstitial";
  expect(await refreshPaywallPositionFromRemote()).toBe("interstitial");
  expect(getPaywallPosition()).toBe("interstitial");
  expect(await AsyncStorage.getItem("dialed_paywall_position_v1")).toBe("interstitial");
});

test("unparseable / missing remote row leaves the current value alone", async () => {
  remoteValue = "sideways";
  expect(await refreshPaywallPositionFromRemote()).toBe("action_gated");
  remoteValue = undefined;
  expect(await refreshPaywallPositionFromRemote()).toBe("action_gated");
});

test("remote failure never throws", async () => {
  remoteThrows = true;
  await expect(refreshPaywallPositionFromRemote()).resolves.toBe("action_gated");
});

test("a slow remote is abandoned at the timeout", async () => {
  jest.useFakeTimers();
  remoteValue = "interstitial";
  remoteDelayMs = 60_000;
  const p = refreshPaywallPositionFromRemote();
  await jest.advanceTimersByTimeAsync(4500);
  await expect(p).resolves.toBe("action_gated");
  jest.useRealTimers();
});
