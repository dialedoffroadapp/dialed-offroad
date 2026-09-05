// Audit item 4 + decision 8: a paying rider passes the gates even when the
// entitlement RPC is missing or unreachable; the cache is per user; the
// launch-trial latch only writes on a server answer; ever-paid accounts get
// no launch trial.
import AsyncStorage from "@react-native-async-storage/async-storage";

const state: { uid: string | null; rpc: any; profile: any; info: any; started: number } = { uid: "u-1", rpc: null, profile: null, info: null, started: 0 };
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: state.uid ? { id: state.uid } : null } }),
      getSession: async () => ({ data: { session: state.uid ? { user: { id: state.uid } } : null } }),
    },
    rpc: (name: string) => ({
      single: async () => {
        if (name === "start_reverse_trial") {
          state.started += 1;
          return { data: { state: "trial_active", started: true, trial_ride_day_limit: 3, trial_ends_at: "2026-09-25T00:00:00Z" }, error: null };
        }
        return typeof state.rpc === "function" ? state.rpc() : state.rpc;
      },
    }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile, error: null }) }) }) }),
  },
}));
jest.mock("../lib/purchases", () => ({
  hasPurchasedThisSession: () => false,
  getCustomerInfo: async () => state.info,
  isPro: (info: any) => !!info?.entitlements?.active?.pro,
}));
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));

/* eslint-disable import/first */
import { clearEntitlementCache, isEntitled, maybeStartLaunchTrial, resolveEntitlement } from "../lib/entitlement";

const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function public.resolve_entitlement" } };

beforeEach(async () => {
  await AsyncStorage.clear();
  clearEntitlementCache();
  state.uid = "u-1"; state.rpc = MISSING; state.profile = null; state.info = null; state.started = 0;
});

test("RPC missing + profile is_pro → pro, not from the server, gates pass", async () => {
  state.profile = { is_pro: true, pro_until: null };
  const e = await resolveEntitlement();
  expect(e.state).toBe("pro");
  expect(e.fromServer).toBe(false);
  expect(isEntitled(e)).toBe(true);
});

test("RPC missing + profile free + RevenueCat cached pro → pro", async () => {
  state.profile = { is_pro: false, pro_until: null };
  state.info = { entitlements: { active: { pro: {} } } };
  expect((await resolveEntitlement()).state).toBe("pro");
});

test("RPC missing + nothing says pro → free, not from the server", async () => {
  state.profile = { is_pro: false, pro_until: null };
  const e = await resolveEntitlement();
  expect(e.state).toBe("free");
  expect(e.fromServer).toBe(false);
  expect(isEntitled(e)).toBe(false);
});

test("RPC ok → from the server; cache is per user", async () => {
  state.rpc = { data: { state: "trial_active", trial_ride_days: 1, trial_ride_day_limit: 3, trial_started_at: "2026-09-01T00:00:00Z", trial_ends_at: "2026-09-22T00:00:00Z" }, error: null };
  const e = await resolveEntitlement();
  expect(e.fromServer).toBe(true);
  expect(await AsyncStorage.getItem("dialed_entitlement_v1:u-1")).toBeTruthy();
  expect(await AsyncStorage.getItem("dialed_entitlement_v1:u-2")).toBeNull();
  // another account on the same phone starts from FREE, not from u-1's trial
  clearEntitlementCache();
  state.uid = "u-2"; state.rpc = MISSING; state.profile = { is_pro: false, pro_until: null };
  expect((await resolveEntitlement()).state).toBe("free");
});

test("launch trial: not latched on a cache/fallback answer; started and latched on a server answer", async () => {
  state.profile = { is_pro: false, pro_until: null };
  expect(await maybeStartLaunchTrial("u-1")).toBeNull();
  expect(await AsyncStorage.getItem("dialed_launch_3_0_trial_v1:u-1")).toBeNull();
  expect(state.started).toBe(0);
  state.rpc = { data: { state: "free", trial_started_at: null }, error: null };
  const started = await maybeStartLaunchTrial("u-1");
  expect(state.started).toBe(1);
  expect(started).not.toBeNull();
  expect(await AsyncStorage.getItem("dialed_launch_3_0_trial_v1:u-1")).toBe("1");
});

test("decision 8: an account that ever paid (pro_until set) gets no launch trial, and is latched", async () => {
  state.rpc = { data: { state: "free", trial_started_at: null, pro_until: "2026-03-01T00:00:00Z" }, error: null };
  expect(await maybeStartLaunchTrial("u-1")).toBeNull();
  expect(state.started).toBe(0);
  expect(await AsyncStorage.getItem("dialed_launch_3_0_trial_v1:u-1")).toBe("1");
});
