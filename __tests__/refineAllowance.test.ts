// One free refinement before the paywall (2026-09-07): the refine CTA routes
// through the Pro gate only when the rider is not entitled AND the
// server-counted allowance is zero. Unknown allowance proceeds (the server
// enforces). The last refine response is remembered per bike; the RPC is the
// fallback.
import AsyncStorage from "@react-native-async-storage/async-storage";

let entitlementState: "free" | "trial_active" | "pro" = "free";
let rpcAnswer: { data: unknown; error: unknown } = { data: 1, error: null };
const rpc = jest.fn((..._a: unknown[]) => Promise.resolve(rpcAnswer));
const showProGate = jest.fn((..._a: unknown[]) => undefined);

jest.mock("../lib/entitlement", () => ({
  resolveEntitlement: async () => ({ state: entitlementState }),
  isEntitled: (e: any) => e?.state === "pro" || e?.state === "trial_active",
}));
jest.mock("../lib/proGate", () => ({ showProGate: (...a: unknown[]) => showProGate(...a) }));
jest.mock("../lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

/* eslint-disable import/first */
import { FREE_REFINE_USED_LINE, gateRefine, noteRefineAllowance, readRefineAllowance, shouldGateRefine } from "../lib/refineAllowance";

const BIKE = "3f9a2c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b";

beforeEach(async () => {
  await AsyncStorage.clear();
  entitlementState = "free";
  rpcAnswer = { data: 1, error: null };
  rpc.mockClear();
  showProGate.mockClear();
});

test("routing rule: entitled never gates; zero gates; positive or unknown proceeds", () => {
  expect(shouldGateRefine({ entitled: true, allowance: 0 })).toBe(false);
  expect(shouldGateRefine({ entitled: false, allowance: 0 })).toBe(true);
  expect(shouldGateRefine({ entitled: false, allowance: 1 })).toBe(false);
  expect(shouldGateRefine({ entitled: false, allowance: null })).toBe(false);
});

test("allowance 1: a free rider proceeds without the gate", async () => {
  expect(await gateRefine(BIKE)).toBe(true);
  expect(showProGate).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("refine_allowance", { p_bike_id: BIKE });
});

test("allowance 0: a free rider gets the Pro gate with the refine trigger", async () => {
  rpcAnswer = { data: 0, error: null };
  expect(await gateRefine(BIKE)).toBe(false);
  expect(showProGate).toHaveBeenCalledWith({ trigger: "refine", bikeId: BIKE });
});

test("Pro and trial riders proceed at allowance 0 and never hit the RPC", async () => {
  rpcAnswer = { data: 0, error: null };
  entitlementState = "pro";
  expect(await gateRefine(BIKE)).toBe(true);
  entitlementState = "trial_active";
  expect(await gateRefine(BIKE)).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
  expect(showProGate).not.toHaveBeenCalled();
});

test("the last refine response wins over the RPC; an RPC error is unknown, not zero", async () => {
  await noteRefineAllowance(BIKE, 0);
  expect(await readRefineAllowance(BIKE)).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
  await AsyncStorage.clear();
  rpcAnswer = { data: null, error: new Error("offline") };
  expect(await readRefineAllowance(BIKE)).toBeNull();
  expect(await gateRefine(BIKE)).toBe(true); // unknown proceeds; the server enforces
  expect(await readRefineAllowance("guest_123")).toBeNull(); // not a uuid: no RPC
});

test("the copy line has no em dash and names Pro", () => {
  expect(FREE_REFINE_USED_LINE).not.toMatch(/—/);
  expect(FREE_REFINE_USED_LINE).toMatch(/free refinement/);
});
