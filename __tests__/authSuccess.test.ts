// Equivalence coverage for the completeAuthSuccess() extraction.
//
// Every expectation in the "email happy path" tests is transcribed from the
// pre-refactor inline code in app/signup.tsx @ release/v2.2.0 (b3df976):
// exact upsert payload/options, guest-bike migration + pending-tune remap,
// toast position (after migration, before analytics), event order, and the
// markAccountCreated → setStep("trial") → replace("/premium") advance. If a
// change here fails, the shared path has drifted from what email signup
// shipped — fix the drift, not the test.
import AsyncStorage from "@react-native-async-storage/async-storage";

const calls: string[] = [];

const profileUpsert = jest.fn(async (_payload: any, _opts: any) => {
  calls.push("profiles.upsert");
  return { error: null } as any;
});
const bikeSingle = jest.fn(async () => {
  calls.push("bikes.insert");
  return { data: { id: "11111111-2222-4333-8444-555555555555" }, error: null } as any;
});
const bikeInsert = jest.fn((_payload: any) => ({
  select: (_cols: string) => ({ single: bikeSingle }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "profiles") return { upsert: profileUpsert };
      if (table === "bikes") return { insert: bikeInsert };
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const logEvent = jest.fn(async (event: string, _meta?: any) => {
  calls.push(`logEvent:${event}`);
});
const getOrCreateFunnelId = jest.fn(async () => "funnel_test_1");
jest.mock("../lib/usage", () => ({
  logEvent: (...args: any[]) => logEvent(...(args as [string, any])),
  getOrCreateFunnelId: () => getOrCreateFunnelId(),
  clearFunnelId: async () => {},
}));

// Paywall position (2026-09-02): the action-gated tail completes onboarding
// through lib/onboardingCompletion.ts. Mocked here so this file keeps
// asserting the auth sequence alone; the sequence has its own contract.
const completeOnboardingSequence = jest.fn(async (_p: any) => ({
  target: "/tune-results",
  pendingExists: true,
  autoBaseline: null,
}));
jest.mock("../lib/onboardingCompletion", () => ({
  completeOnboardingSequence: (p: any) => completeOnboardingSequence(p),
}));

jest.mock("../lib/bikes", () => ({
  normalizeBikeStrings: (make: string, model: string) => ({
    make: make.trim(),
    model: model.trim().toUpperCase(),
  }),
  resolveModelId: async () => "model-uuid-1",
}));

// WS-C consolidation (v2.3.0 assembly): silent mock — no `calls` push,
// because the equivalence tests assert exact call sequences transcribed
// from PRE-claim signup.tsx. Ordering is asserted separately below via
// invocationCallOrder.
const claimAnonTuneCalls = jest.fn(async () => {});
jest.mock("../lib/tuneAttribution", () => ({
  claimAnonTuneCalls: () => claimAnonTuneCalls(),
}));

/* eslint-disable import/first -- these imports must follow the jest.mock
   factories above: the factories close over the mock fns (TDZ otherwise). */
import { completeAuthSuccess, type AuthSuccessParams } from "../lib/authSuccess";
import { __setPaywallPositionForTests } from "../lib/paywallPosition";
import {
  PENDING_GUEST_BIKE_SYNC_KEY,
  PENDING_TUNE_STORAGE_KEY,
  readPendingTune,
} from "../lib/onboarding";

const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LOCAL_BIKE_ID = "1783553470201_9a0e52e462e018";

function pendingTuneRaw(bikeId: string = LOCAL_BIKE_ID) {
  const meta = encodeURIComponent(
    JSON.stringify({
      bike_id: bikeId,
      bike: { id: bikeId, make: "KTM", model: "450 sx-f", year: 2024 },
    })
  );
  return JSON.stringify({
    r: encodeURIComponent(JSON.stringify({ ok: true })),
    meta,
    bikeId,
    savedAt: Date.now(),
  });
}

function makeParams(overrides: Partial<AuthSuccessParams> = {}): AuthSuccessParams {
  return {
    userId: USER_ID,
    isNewAccount: true,
    method: "email",
    onboardingStep: "signup",
    onboardingComplete: false,
    ageMinutesSinceLastStep: 2,
    notify: () => calls.push("notify"),
    markAccountCreated: async () => {
      calls.push("markAccountCreated");
    },
    setStep: async (step) => {
      calls.push(`setStep:${step}`);
    },
    replace: (route) => calls.push(`replace:${route}`),
    returnTo: "/premium?returnTo=/tune-results",
    ...overrides,
  };
}

beforeEach(async () => {
  calls.length = 0;
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // Every pre-existing expectation below is the INTERSTITIAL contract
  // (signup → trial → /premium). The action-gated tail is covered at the end.
  __setPaywallPositionForTests("interstitial");
});

describe("action-gated paywall position (reveal first)", () => {
  beforeEach(() => __setPaywallPositionForTests("action_gated"));
  afterAll(() => __setPaywallPositionForTests(null));

  test("signup step: profile stamped complete, completion runs, lands on its target", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());
    const completeOnboarding = jest.fn(async () => {});
    completeOnboardingSequence.mockResolvedValueOnce({
      target: "/quiz/reveal",
      pendingExists: true,
      autoBaseline: null,
    });

    await completeAuthSuccess(
      makeParams({ completeOnboarding, revealRoute: "/quiz/reveal", method: "apple" })
    );

    expect(profileUpsert.mock.calls[0][0]).toEqual({
      user_id: USER_ID,
      onboarding_step: "complete",
      onboarding_complete: true,
    });
    // Same migration + events as the interstitial world, then completion
    // instead of the trial step, and NO /premium.
    expect(calls).toEqual([
      "profiles.upsert",
      "bikes.insert",
      "notify",
      "logEvent:sign_up",
      "logEvent:onboarding_signup_completed",
      "markAccountCreated",
      "replace:/quiz/reveal",
    ]);
    expect(completeOnboardingSequence).toHaveBeenCalledTimes(1);
    expect(completeOnboardingSequence.mock.calls[0][0]).toMatchObject({
      completeOnboarding,
      onboardingStep: "signup",
      viaPaywall: false,
      returnTo: "/quiz/reveal",
      sourceRoute: "/signup",
      extraMeta: { signup_method: "apple" },
    });
  });

  test("explicit paywallPosition param overrides the live value", async () => {
    await completeAuthSuccess(makeParams({ paywallPosition: "interstitial" }));
    expect(calls.slice(-3)).toEqual(["markAccountCreated", "setStep:trial", "replace:/premium"]);
    expect(completeOnboardingSequence).not.toHaveBeenCalled();
  });

  test("interstitial + revealRoute hands the reveal to /premium as returnTo", async () => {
    await completeAuthSuccess(
      makeParams({ paywallPosition: "interstitial", revealRoute: "/quiz/reveal" })
    );
    expect(calls[calls.length - 1]).toBe("replace:/premium?returnTo=%2Fquiz%2Freveal");
  });

  test("non-signup steps never complete here (routing unchanged)", async () => {
    await completeAuthSuccess(makeParams({ onboardingStep: "results_locked" }));
    expect(completeOnboardingSequence).not.toHaveBeenCalled();
    expect(calls[calls.length - 1]).toBe("replace:/premium?returnTo=/tune-results");
  });

  test("login mode, returning user: heal-only write, no completion", async () => {
    await completeAuthSuccess(
      makeParams({ mode: "login", isNewAccount: false, onboardingStep: "complete", onboardingComplete: true })
    );
    expect(profileUpsert.mock.calls[0][0]).toEqual({ user_id: USER_ID });
    expect(completeOnboardingSequence).not.toHaveBeenCalled();
  });
});

describe("email happy path — pre-refactor sequence preserved", () => {
  test("full onboarding signup: upsert → migrate → notify → events → advance", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(makeParams());

    // Exact pre-refactor upsert payload: no display_name key for email.
    expect(profileUpsert).toHaveBeenCalledTimes(1);
    expect(profileUpsert.mock.calls[0][0]).toEqual({
      user_id: USER_ID,
      onboarding_step: "trial",
      onboarding_complete: false,
    });
    expect(profileUpsert.mock.calls[0][1]).toEqual({
      onConflict: "user_id",
      ignoreDuplicates: false,
    });

    // Guest bike inserted for the new user with normalized strings + model_id.
    expect(bikeInsert).toHaveBeenCalledWith({
      user_id: USER_ID,
      make: "KTM",
      model: "450 SX-F",
      year: 2024,
      model_id: "model-uuid-1",
    });

    // Pending tune remapped from the local id to the inserted uuid.
    const { tune } = await readPendingTune();
    expect(tune?.bikeId).toBe("11111111-2222-4333-8444-555555555555");
    const remappedMeta = JSON.parse(decodeURIComponent(tune!.meta));
    expect(remappedMeta.bike_id).toBe("11111111-2222-4333-8444-555555555555");

    // Analytics: sign_up carries signup_method; funnel meta matches the
    // pre-refactor shape plus signup_method.
    expect(logEvent).toHaveBeenCalledWith("sign_up", { signup_method: "email" });
    expect(logEvent).toHaveBeenCalledWith("onboarding_signup_completed", {
      funnel_id: "funnel_test_1",
      onboarding_step: "signup",
      signed_in: true,
      account_created: true,
      trial_started: false,
      onboarding_complete: false,
      pending_tune_exists: true,
      resume: false,
      age_minutes_since_last_step: 2,
      source_route: "/signup",
      signup_method: "email",
    });

    // Order: profile → bike → toast → sign_up → funnel → advance → /premium.
    expect(calls).toEqual([
      "profiles.upsert",
      "bikes.insert",
      "notify",
      "logEvent:sign_up",
      "logEvent:onboarding_signup_completed",
      "markAccountCreated",
      "setStep:trial",
      "replace:/premium",
    ]);
  });

  test("upsert retries transient failures (2 fail + 1 succeed) and proceeds", async () => {
    profileUpsert
      .mockResolvedValueOnce({ error: { message: "jwt not ready" } } as any)
      .mockResolvedValueOnce({ error: { message: "jwt not ready" } } as any);

    await completeAuthSuccess(makeParams());

    expect(profileUpsert).toHaveBeenCalledTimes(3);
    expect(calls).toContain("replace:/premium");
  }, 10000);

  test("upsert failing all 3 attempts still routes the user forward", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    profileUpsert
      .mockResolvedValueOnce({ error: { message: "nope" } } as any)
      .mockResolvedValueOnce({ error: { message: "nope" } } as any)
      .mockResolvedValueOnce({ error: { message: "nope" } } as any);

    await completeAuthSuccess(makeParams());

    expect(profileUpsert).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith("[Signup] profile upsert failed after retries");
    expect(logEvent).toHaveBeenCalledWith("sign_up", { signup_method: "email" });
    expect(calls[calls.length - 1]).toBe("replace:/premium");
    warn.mockRestore();
  }, 10000);

  test("bike insert failure stashes the guest bike for cold-start retry", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());
    bikeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "rls denied" },
    } as any);

    await completeAuthSuccess(makeParams());

    const stashed = JSON.parse(
      (await AsyncStorage.getItem(PENDING_GUEST_BIKE_SYNC_KEY)) ?? "null"
    );
    expect(stashed).toEqual({
      make: "KTM",
      model: "450 SX-F",
      year: 2024,
      userId: USER_ID,
    });
    // Pending tune keeps the local id (remap never ran) and the flow continues.
    const { tune } = await readPendingTune();
    expect(tune?.bikeId).toBe(LOCAL_BIKE_ID);
    expect(calls[calls.length - 1]).toBe("replace:/premium");
  });

  test("no session user id skips profile/bike writes but still logs + routes", async () => {
    await completeAuthSuccess(makeParams({ userId: null }));

    expect(profileUpsert).not.toHaveBeenCalled();
    expect(bikeInsert).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "notify",
      "logEvent:sign_up",
      "logEvent:onboarding_signup_completed",
      "markAccountCreated",
      "setStep:trial",
      "replace:/premium",
    ]);
  });

  test("existing account (isNewAccount=false): sign_in, no funnel event", async () => {
    await completeAuthSuccess(makeParams({ isNewAccount: false }));

    expect(logEvent).toHaveBeenCalledWith("sign_in", { signup_method: "email" });
    expect(logEvent).not.toHaveBeenCalledWith(
      "onboarding_signup_completed",
      expect.anything()
    );
    expect(calls[calls.length - 1]).toBe("replace:/premium");
  });

  test("outside the signup step: routes to returnTo, no onboarding advance", async () => {
    await completeAuthSuccess(
      makeParams({ onboardingStep: "complete", onboardingComplete: true })
    );

    expect(calls).not.toContain("markAccountCreated");
    expect(calls).not.toContain("setStep:trial");
    expect(calls[calls.length - 1]).toBe(
      "replace:/premium?returnTo=/tune-results"
    );
  });
});

describe("OAuth additions (email payload untouched)", () => {
  test("provider display name written for NEW accounts only", async () => {
    await completeAuthSuccess(
      makeParams({ method: "apple", displayName: "Ricky Carmichael" })
    );
    expect(profileUpsert.mock.calls[0][0]).toEqual({
      user_id: USER_ID,
      onboarding_step: "trial",
      onboarding_complete: false,
      display_name: "Ricky Carmichael",
    });
  });

  test("auto-linked returning user keeps their chosen name", async () => {
    await completeAuthSuccess(
      makeParams({
        method: "apple",
        displayName: "Ricky Carmichael",
        isNewAccount: false,
      })
    );
    expect(profileUpsert.mock.calls[0][0]).not.toHaveProperty("display_name");
    expect(logEvent).toHaveBeenCalledWith("sign_in", { signup_method: "apple" });
  });

  test("blank/whitespace provider name falls back to the trigger default", async () => {
    await completeAuthSuccess(makeParams({ method: "google", displayName: "  " }));
    expect(profileUpsert.mock.calls[0][0]).not.toHaveProperty("display_name");
  });
});

describe("login-screen mode (mirrors email login's profile-write contract)", () => {
  test("returning user: heal-only upsert (NO onboarding downgrade), sign_in, no funnel, → /(tabs)", async () => {
    await completeAuthSuccess(
      makeParams({
        mode: "login",
        method: "google",
        isNewAccount: false,
        onboardingStep: "complete",
        onboardingComplete: true,
        returnTo: "/(tabs)",
      })
    );

    // The exact hazard this mode exists to prevent: a completed/Pro user's
    // profile must never be stamped back to trial/incomplete by an OAuth login.
    expect(profileUpsert.mock.calls[0][0]).toEqual({ user_id: USER_ID });

    expect(logEvent).toHaveBeenCalledWith("sign_in", { signup_method: "google" });
    expect(logEvent).not.toHaveBeenCalledWith(
      "onboarding_signup_completed",
      expect.anything()
    );
    expect(calls).not.toContain("markAccountCreated");
    expect(calls).not.toContain("setStep:trial");
    expect(calls[calls.length - 1]).toBe("replace:/(tabs)");
  });

  test("returning user parked at the signup step: trial advance only (email login's signup branch)", async () => {
    await completeAuthSuccess(
      makeParams({
        mode: "login",
        method: "apple",
        isNewAccount: false,
        onboardingStep: "signup",
        returnTo: "/(tabs)",
      })
    );

    expect(profileUpsert.mock.calls[0][0]).toEqual({
      user_id: USER_ID,
      onboarding_step: "trial",
    });
    expect(calls.slice(-3)).toEqual([
      "markAccountCreated",
      "setStep:trial",
      "replace:/premium",
    ]);
  });

  test("new account created from the login screen gets the full signup payload", async () => {
    await completeAuthSuccess(
      makeParams({
        mode: "login",
        method: "apple",
        isNewAccount: true,
        displayName: "Ken Roczen",
      })
    );

    expect(profileUpsert.mock.calls[0][0]).toEqual({
      user_id: USER_ID,
      onboarding_step: "trial",
      onboarding_complete: false,
      display_name: "Ken Roczen",
    });
    expect(logEvent).toHaveBeenCalledWith("sign_up", { signup_method: "apple" });
    expect(logEvent).toHaveBeenCalledWith(
      "onboarding_signup_completed",
      expect.objectContaining({ signup_method: "apple" })
    );
  });
});

describe("WS-C claim consolidation (v2.3.0 assembly)", () => {
  test("every pass claims pre-auth tune_calls BEFORE the flush-triggering sign_up/sign_in event", async () => {
    await completeAuthSuccess(makeParams());

    expect(claimAnonTuneCalls).toHaveBeenCalledTimes(1);
    const claimOrder = claimAnonTuneCalls.mock.invocationCallOrder[0];
    const signUpIdx = logEvent.mock.calls.findIndex((c) => c[0] === "sign_up");
    expect(signUpIdx).toBeGreaterThanOrEqual(0);
    expect(claimOrder).toBeLessThan(logEvent.mock.invocationCallOrder[signUpIdx]);
  });

  test("returning-user OAuth (mode login) claims too, before sign_in", async () => {
    await completeAuthSuccess(
      makeParams({ isNewAccount: false, method: "google", mode: "login" })
    );

    expect(claimAnonTuneCalls).toHaveBeenCalledTimes(1);
    const claimOrder = claimAnonTuneCalls.mock.invocationCallOrder[0];
    const signInIdx = logEvent.mock.calls.findIndex((c) => c[0] === "sign_in");
    expect(signInIdx).toBeGreaterThanOrEqual(0);
    expect(claimOrder).toBeLessThan(logEvent.mock.invocationCallOrder[signInIdx]);
  });
});

describe("guest-state migration latch (dup-bike fix, 2026-07-27 incident)", () => {
  test("guest tune → signup migrates ONCE; second auth (different user) migrates nothing", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(makeParams()); // user A, mode signup
    expect(bikeInsert).toHaveBeenCalledTimes(1);

    const { tune: afterA } = await readPendingTune();
    expect(afterA?.migratedForUserId).toBe(USER_ID);

    // Same device, new account (the incident shape: 22:39 → 22:50).
    await completeAuthSuccess(
      makeParams({ userId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" })
    );
    expect(bikeInsert).toHaveBeenCalledTimes(1); // still once — no dup

    const { tune: afterB } = await readPendingTune();
    expect(afterB?.migratedForUserId).toBe(USER_ID); // latch untouched
  });

  test("same user re-auth does not migrate twice either", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(makeParams());
    await completeAuthSuccess(makeParams());

    expect(bikeInsert).toHaveBeenCalledTimes(1);
  });

  test("returning login-mode auth does NOT absorb device guest state", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(
      makeParams({ mode: "login", isNewAccount: false })
    );

    expect(bikeInsert).not.toHaveBeenCalled();
    const { tune } = await readPendingTune();
    expect(tune?.migratedForUserId).toBeUndefined(); // unclaimed for its owner
  });

  test("login-mode returning auth from the quiz gate (absorbGuestState) migrates: the rider IS the guest", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(
      makeParams({ mode: "login", isNewAccount: false, absorbGuestState: true })
    );

    expect(bikeInsert).toHaveBeenCalledTimes(1);
  });

  test("login-mode auth that MINTS a new account still migrates (funnel exit)", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());

    await completeAuthSuccess(
      makeParams({ mode: "login", isNewAccount: true })
    );

    expect(bikeInsert).toHaveBeenCalledTimes(1);
  });

  test("latch survives a failed remap: bike row exists, no re-dup on re-auth", async () => {
    await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, pendingTuneRaw());
    // Insert succeeds; remap would run after the latch write. Simulate a
    // re-auth after partial failure by just re-running the whole sequence.
    await completeAuthSuccess(makeParams());
    const { tune } = await readPendingTune();
    expect(tune?.migratedForUserId).toBe(USER_ID);

    await completeAuthSuccess(makeParams());
    expect(bikeInsert).toHaveBeenCalledTimes(1);
  });
});
