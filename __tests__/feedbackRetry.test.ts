// Retry queue for failed feedback/lineage shadow writes:
// enqueue, dedupe-by-version-id, cap-5-drop-oldest, flush semantics.

jest.mock("../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
    })),
  },
}));
jest.mock("../lib/setupVersions", () => ({
  createBaselineVersion: jest.fn(),
  createFeedback: jest.fn(),
  createRefinementVersion: jest.fn(),
}));
jest.mock("../lib/rideReminder", () => ({
  cancelRideReminderForVersion: jest.fn(async () => {}),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueFeedbackRetry,
  flushFeedbackRetryQueue,
  PendingFeedbackRetry,
} from "../lib/feedbackRetry";
import {
  createBaselineVersion,
  createFeedback,
  createRefinementVersion,
} from "../lib/setupVersions";

const RETRY_KEY = "pending_feedback_retry";

const tune = (comp: number) => ({
  fork: { comp_clicks: comp, reb_clicks: 12 },
  shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 },
  notes: [],
});

const entry = (
  versionId: string | null,
  over: Partial<Omit<PendingFeedbackRetry, "queuedAt">> = {}
): Omit<PendingFeedbackRetry, "queuedAt"> => ({
  versionId,
  bikeId: "a3bb189e-8bf9-3888-9912-ace4e6543002",
  previousTune: tune(10),
  refinedTune: null,
  feedback: {
    overallRating: 6,
    symptoms: [{ id: "dead_feel", severity: 5 } as any],
    freeText: "felt dead",
  },
  feedbackId: null,
  resultingVersionId: null,
  terrain: "hardpack",
  context: null,
  ...over,
});

const readQueue = async (): Promise<PendingFeedbackRetry[]> =>
  JSON.parse((await AsyncStorage.getItem(RETRY_KEY)) ?? "[]");

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("enqueue", () => {
  test("distinct version ids append in order", async () => {
    await enqueueFeedbackRetry(entry("v-1"));
    await enqueueFeedbackRetry(entry("v-2"));
    const q = await readQueue();
    expect(q.map((e) => e.versionId)).toEqual(["v-1", "v-2"]);
    expect(q.every((e) => typeof e.queuedAt === "string")).toBe(true);
  });

  test("same version id replaces, never duplicates", async () => {
    await enqueueFeedbackRetry(entry("v-1"));
    await enqueueFeedbackRetry(
      entry("v-1", { feedback: null, feedbackId: "fb-9" })
    );
    const q = await readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].feedbackId).toBe("fb-9"); // latest payload won
  });

  test("cap 5: oldest dropped beyond the cap", async () => {
    for (let i = 1; i <= 6; i++) await enqueueFeedbackRetry(entry(`v-${i}`));
    const q = await readQueue();
    expect(q).toHaveLength(5);
    expect(q.map((e) => e.versionId)).toEqual([
      "v-2",
      "v-3",
      "v-4",
      "v-5",
      "v-6",
    ]);
  });
});

describe("flush", () => {
  test("successful replay removes the entry", async () => {
    (createFeedback as jest.Mock).mockResolvedValue({ id: "fb-1" });
    await enqueueFeedbackRetry(entry("v-1"));

    await flushFeedbackRetryQueue();

    expect(createFeedback).toHaveBeenCalledWith({
      setupVersionId: "v-1",
      overallRating: 6,
      symptoms: [{ id: "dead_feel", severity: 5 }],
      freeText: "felt dead",
    });
    expect(await readQueue()).toHaveLength(0);
  });

  test("failed replay keeps the entry", async () => {
    (createFeedback as jest.Mock).mockRejectedValue(
      Object.assign(new Error("rls"), { code: "42501" })
    );
    await enqueueFeedbackRetry(entry("v-1"));

    await flushFeedbackRetryQueue();

    expect(await readQueue()).toHaveLength(1);
  });

  test("partial progress persists: baseline recreated, feedback still pending", async () => {
    (createBaselineVersion as jest.Mock).mockResolvedValue({ id: "v-new" });
    (createFeedback as jest.Mock).mockRejectedValue(new Error("network"));
    await enqueueFeedbackRetry(entry(null)); // baseline insert itself failed

    await flushFeedbackRetryQueue();

    const q = await readQueue();
    expect(q).toHaveLength(1);
    // The recreated baseline id was saved so the next flush skips step 1.
    expect(q[0].versionId).toBe("v-new");
    expect(q[0].feedback).not.toBeNull();
  });

  test("mixed queue: successes removed, failures kept; refinement chain replays", async () => {
    (createFeedback as jest.Mock).mockResolvedValue({ id: "fb-1" });
    (createRefinementVersion as jest.Mock)
      .mockResolvedValueOnce({ id: "ref-1" }) // v-ok's refinement
      .mockRejectedValueOnce(new Error("boom")); // v-bad's refinement
    await enqueueFeedbackRetry(
      entry("v-ok", { refinedTune: tune(14) as any })
    );
    await enqueueFeedbackRetry(
      entry("v-bad", { feedback: null, feedbackId: "fb-2", refinedTune: tune(15) as any })
    );

    await flushFeedbackRetryQueue();

    const q = await readQueue();
    expect(q.map((e) => e.versionId)).toEqual(["v-bad"]);
    expect(createRefinementVersion).toHaveBeenCalledTimes(2);
    expect((createRefinementVersion as jest.Mock).mock.calls[0][0]).toMatchObject({
      parentVersionId: "v-ok",
      feedbackId: "fb-1",
    });
  });
});
