// __tests__/tuneAttribution.test.ts
// Workstream C: pre-auth tune attribution — anon id lifecycle, the claim at
// auth success, rotation, and the anon_id wire field on generateTune.
//
// The server-side halves of these guarantees (exact-anon_id match, user_id
// IS NULL one-shot guard, 48h window) live in SQL
// (20260724110000_tune_calls_anon_claim.sql) and can't run under jest; what
// the client MUST uphold for them to compose is covered here: mint-once,
// send-only-when-signed-out, claim-with-stored-id, rotate-only-on-success.

import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn(), getUser: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

import { supabase } from "../lib/supabase";
import {
  claimAnonTuneCalls,
  getOrCreateAnonTuneId,
  peekAnonTuneId,
} from "../lib/tuneAttribution";
import { generateTune, ZeroTuneInput } from "../lib/ai";

const mockRpc = supabase.rpc as jest.Mock;
const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockInvoke = supabase.functions.invoke as jest.Mock;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MINIMAL_INPUT: ZeroTuneInput = {
  terrain: "mx",
  rider: { skill: "intermediate", style: "short_motos", goals: [] },
  has_zeroed_clickers: true,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("anon tune id lifecycle", () => {
  test("mints a v4 uuid once and returns the same id afterwards", async () => {
    const first = await getOrCreateAnonTuneId();
    expect(first).toMatch(UUID_RE);
    expect(await getOrCreateAnonTuneId()).toBe(first);
    expect(await peekAnonTuneId()).toBe(first);
  });

  test("peek never mints", async () => {
    expect(await peekAnonTuneId()).toBeNull();
    expect(await peekAnonTuneId()).toBeNull();
  });
});

describe("claim at auth success", () => {
  test("pre-auth tune then signup: claims with the stored id, then rotates", async () => {
    const anonId = await getOrCreateAnonTuneId(); // "guest generated a tune"
    mockRpc.mockResolvedValue({ data: { ok: true, claimed: 1 }, error: null });

    await claimAnonTuneCalls(); // "signup succeeded"

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("claim_anon_tune_calls", {
      p_anon_id: anonId,
    });
    // Rotated: stored id is gone, and the next guest tune mints a FRESH id.
    expect(await peekAnonTuneId()).toBeNull();
    const next = await getOrCreateAnonTuneId();
    expect(next).toMatch(UUID_RE);
    expect(next).not.toBe(anonId);
  });

  test("second account on the same device cannot re-claim: rotation leaves no id, so no RPC fires", async () => {
    // Account 1's full cycle (server has stamped its rows' user_id by now —
    // the SQL one-shot guard; client-side, rotation cleared the id).
    await getOrCreateAnonTuneId();
    mockRpc.mockResolvedValue({ data: { ok: true, claimed: 1 }, error: null });
    await claimAnonTuneCalls();
    mockRpc.mockClear();

    // Account 2 signs up on the same device without generating a guest tune:
    // nothing stored → claim is a silent no-op, no request at all.
    await claimAnonTuneCalls();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("failed claim keeps the id so the next sign-in retries", async () => {
    const anonId = await getOrCreateAnonTuneId();
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await claimAnonTuneCalls(); // must not throw
    expect(await peekAnonTuneId()).toBe(anonId);

    // retry path: next auth success claims the SAME id successfully
    mockRpc.mockResolvedValue({ data: { ok: true, claimed: 2 }, error: null });
    await claimAnonTuneCalls();
    expect(mockRpc).toHaveBeenLastCalledWith("claim_anon_tune_calls", {
      p_anon_id: anonId,
    });
    expect(await peekAnonTuneId()).toBeNull();
  });
});

describe("generateTune anon_id wire field", () => {
  const okTuneResponse = {
    data: { fork: {}, shock: {}, detected: {}, notes: [] },
    error: null,
  };

  test("signed-out call carries the device anon id at payload top level", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockInvoke.mockResolvedValue(okTuneResponse);

    await generateTune(MINIMAL_INPUT);

    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.anon_id).toMatch(UUID_RE);
    expect(body.anon_id).toBe(await peekAnonTuneId()); // same id persisted
    expect(body.mode).toBe("zero_baseline_v1");
  });

  test("signed-in call sends no anon_id and mints nothing", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    mockInvoke.mockResolvedValue(okTuneResponse);

    await generateTune(MINIMAL_INPUT);

    const body = mockInvoke.mock.calls[0][1].body;
    expect("anon_id" in body).toBe(false);
    expect(await peekAnonTuneId()).toBeNull();
  });
});
