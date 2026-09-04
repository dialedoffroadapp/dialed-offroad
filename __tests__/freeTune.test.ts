// Free baseline credit (migration 20260904140000): regenerate is never
// consumed (so never refunded), first baseline per bike is counted, the
// legacy bikeless path keeps the single credit.
const rpc = jest.fn();
jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: any[]) => ({ single: () => rpc(...args) }),
    from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));

/* eslint-disable import/first */
import { claimBaselineCredit, mapClaim, refundBaselineCredit } from "../lib/freeTune";

beforeEach(() => rpc.mockReset());

test("mapClaim: consumed only for trial / first_baseline", () => {
  expect(mapClaim({ ok: true, reason: "regenerate", trial_tunes_used: 1 })).toMatchObject({ ok: true, reason: "regenerate", consumed: false, trialTunesUsed: 1 });
  expect(mapClaim({ ok: true, reason: "first_baseline", trial_tunes_used: 2 })).toMatchObject({ consumed: true });
  expect(mapClaim({ ok: true, reason: "trial" })).toMatchObject({ consumed: true, isPro: false });
  expect(mapClaim({ ok: true, reason: "pro" })).toMatchObject({ consumed: false, isPro: true });
  expect(mapClaim({ ok: false, reason: "no_trial" })).toMatchObject({ ok: false, reason: "no_trial", consumed: false });
  expect(mapClaim(null)).toMatchObject({ ok: false, reason: "error" });
});

test("claim passes the bike only when it is a real uuid", async () => {
  rpc.mockResolvedValue({ data: { ok: true, reason: "regenerate", trial_tunes_used: 1 }, error: null });
  await claimBaselineCredit("11111111-2222-4333-8444-555555555555");
  expect(rpc).toHaveBeenLastCalledWith("claim_free_tune", { p_bike_id: "11111111-2222-4333-8444-555555555555" });
  await claimBaselineCredit("1783553470201_9a0e52e462e018");
  expect(rpc).toHaveBeenLastCalledWith("claim_free_tune", {});
  await claimBaselineCredit(null);
  expect(rpc).toHaveBeenLastCalledWith("claim_free_tune", {});
  rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  expect((await claimBaselineCredit(null)).reason).toBe("error");
});

test("refund is a no-op unless the claim consumed a credit", async () => {
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  await refundBaselineCredit(mapClaim({ ok: true, reason: "regenerate" }));
  await refundBaselineCredit(mapClaim({ ok: true, reason: "pro" }));
  await refundBaselineCredit(null);
  expect(rpc).not.toHaveBeenCalled();
  await refundBaselineCredit(mapClaim({ ok: true, reason: "first_baseline" }));
  expect(rpc).toHaveBeenCalledWith("refund_free_tune");
});

test("DEV ONLY: a missing per-bike claim RPC fails open as a no-consume regenerate; never in a release build", async () => {
  const UUID = "11111111-2222-4333-8444-555555555555";
  const missing = {
    data: null,
    error: { code: "PGRST202", message: "Could not find the function public.claim_free_tune(p_bike_id) in the schema cache" },
  };
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    rpc.mockResolvedValue(missing);
    // release build (__DEV__ false, the jest default): fails closed
    expect((await claimBaselineCredit(UUID)).reason).toBe("error");
    (globalThis as any).__DEV__ = true;
    expect(await claimBaselineCredit(UUID)).toMatchObject({ ok: true, reason: "regenerate", consumed: false, isPro: false });
    expect(warn).toHaveBeenCalledTimes(1);
    // any other failure still fails closed, even in dev
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function claim_free_tune" } });
    expect((await claimBaselineCredit(UUID)).reason).toBe("error");
    rpc.mockResolvedValue({ data: { ok: false, reason: "no_trial" }, error: null });
    expect((await claimBaselineCredit(UUID)).reason).toBe("no_trial");
  } finally {
    (globalThis as any).__DEV__ = false;
    warn.mockRestore();
  }
});
