// __tests__/usageAppVersion.test.ts
// Workstream C ride-along: every usage event's meta carries the app version
// of the binary that GENERATED it — stamped once in logEvent before the
// queue/insert fork, so pre-auth queued events keep their origin version
// through a later flush. Absence of app_version = pre-v2.3.0 generator.

import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

// lib/usage.ts reads Constants.expoConfig.version at module load, so the stub
// must be primed BEFORE usage is required — hence requires, not imports.
const Constants = require("expo-constants").default;
Constants.expoConfig.version = "9.9.9";

const { supabase } = require("../lib/supabase");
const { logEvent, flushQueuedUsageEvents } = require("../lib/usage");

const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

let inserted: any[];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  inserted = [];
  mockFrom.mockReturnValue({
    insert: jest.fn((rows: any) => {
      inserted.push(rows);
      return Promise.resolve({ error: null });
    }),
  });
});

test("authenticated event meta is stamped with app_version", async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });

  await logEvent("sign_in", { source: "test" });

  expect(inserted).toHaveLength(1);
  expect(inserted[0].meta).toEqual({ source: "test", app_version: "9.9.9" });
});

test("a caller-provided app_version is never overridden", async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });

  await logEvent("sign_in", { app_version: "override" });

  expect(inserted[0].meta.app_version).toBe("override");
});

test("pre-auth queued events keep their generation-time version through the flush", async () => {
  // guest: event is queued, already stamped
  mockGetUser.mockResolvedValue({ data: { user: null } });
  await logEvent(
    "onboarding_tune_generated",
    { funnel_id: "f1" },
    { allowAnonymous: true, queueIfAnonymous: true }
  );
  expect(inserted).toHaveLength(0); // queued, not inserted

  // signup: flush writes the queued meta verbatim — stamp came from queue time
  await flushQueuedUsageEvents("u1");
  expect(inserted).toHaveLength(1);
  expect(inserted[0]).toEqual([
    {
      user_id: "u1",
      event_type: "onboarding_tune_generated",
      meta: { funnel_id: "f1", app_version: "9.9.9" },
    },
  ]);
});
