// lib/feedbackRetry.ts
// Retry queue for the tune-feedback lineage shadow writes (ride_feedback +
// setup_versions). Those writes are deliberately non-blocking — the refined
// tune itself is valid even when they fail — but silently dropping them cost
// riders their debrief and broke the outcome check-in loop. On failure the
// screen enqueues the un-persisted remainder here; the root layout flushes the
// queue on the next app launch.
//
// One entry replays the remaining chain in order:
//   1. versionId null      → recreate the critiqued baseline from previousTune
//   2. feedback pending    → insert the ride_feedback row
//   3. refinedTune pending → insert the refinement version (+ feedback link)
// Steps that already succeeded on-screen are nulled out and skipped.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Tune2Context, ZeroTuneResult } from "./ai";
import {
  createBaselineVersion,
  createFeedback,
  createRefinementVersion,
  FeedbackEntry,
} from "./setupVersions";
import { supabase } from "./supabase";

const RETRY_KEY = "pending_feedback_retry";
const MAX_ENTRIES = 5;

export type PendingFeedbackRetry = {
  /** setup_versions id being critiqued; null = the baseline insert itself failed. */
  versionId: string | null;
  bikeId: string | null;
  /** Tune the rider critiqued — recreates the baseline when versionId is null. */
  previousTune: ZeroTuneResult;
  /** Refined result whose version insert failed; null when it saved (or never generated). */
  refinedTune: ZeroTuneResult | null;
  /** Feedback payload still to persist; null once the ride_feedback row exists. */
  feedback: {
    overallRating: number | null;
    symptoms: FeedbackEntry[];
    freeText: string | null;
  } | null;
  /** ride_feedback id when that row was created before a later step failed. */
  feedbackId: string | null;
  /** When the refinement version saved but the feedback row didn't, the replayed
   *  feedback still needs its resulting_version_id link (the outcome check-in
   *  keys on it). */
  resultingVersionId: string | null;
  terrain: string | null;
  context: Tune2Context | null;
  queuedAt: string;
};

/** Dedup key: the critiqued version id when known, else the tune values —
 *  re-submitting the same failed debrief must replace, never duplicate. */
function retryKeyOf(e: Omit<PendingFeedbackRetry, "queuedAt">): string {
  return e.versionId ?? `unsaved:${JSON.stringify(e.previousTune)}`;
}

async function readQueue(): Promise<PendingFeedbackRetry[]> {
  try {
    const raw = await AsyncStorage.getItem(RETRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingFeedbackRetry[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: PendingFeedbackRetry[]): Promise<void> {
  await AsyncStorage.setItem(RETRY_KEY, JSON.stringify(q));
}

export async function enqueueFeedbackRetry(
  entry: Omit<PendingFeedbackRetry, "queuedAt">
): Promise<void> {
  try {
    const key = retryKeyOf(entry);
    const rest = (await readQueue()).filter((e) => retryKeyOf(e) !== key);
    rest.push({ ...entry, queuedAt: new Date().toISOString() });
    // Cap the queue; oldest entries drop first.
    await writeQueue(rest.slice(-MAX_ENTRIES));
  } catch (err) {
    console.error("pending_feedback_retry enqueue failed", err);
  }
}

/**
 * Replay one entry's remaining steps. Returns null when fully persisted, or
 * the entry updated with whatever partial progress was made (so a flush that
 * dies at step 3 doesn't redo steps 1–2 next launch).
 */
async function replay(
  entry: PendingFeedbackRetry
): Promise<PendingFeedbackRetry | null> {
  const e: PendingFeedbackRetry = { ...entry };
  try {
    if (!e.versionId) {
      const baseline = await createBaselineVersion({
        bikeId: e.bikeId,
        tune: e.previousTune,
        terrain: e.terrain,
        context: e.context,
      });
      e.versionId = baseline.id;
    }
    if (e.feedback && !e.feedbackId) {
      const fb = await createFeedback({
        setupVersionId: e.versionId,
        overallRating: e.feedback.overallRating,
        symptoms: e.feedback.symptoms,
        freeText: e.feedback.freeText,
      });
      e.feedbackId = fb.id;
      e.feedback = null;
      if (e.resultingVersionId) {
        // Refinement row already exists from the original session — restore
        // the link the failed feedback write left dangling.
        const { error: linkErr } = await supabase
          .from("ride_feedback")
          .update({ resulting_version_id: e.resultingVersionId })
          .eq("id", fb.id);
        if (linkErr) throw linkErr;
        e.resultingVersionId = null;
      }
    }
    if (e.refinedTune) {
      await createRefinementVersion({
        bikeId: e.bikeId,
        parentVersionId: e.versionId,
        tune: e.refinedTune,
        terrain: e.terrain,
        context: e.context,
        feedbackId: e.feedbackId,
      });
      e.refinedTune = null;
    }
    return null;
  } catch (err: any) {
    // Log the real Supabase error — an RLS rejection (42501, as shipped in the
    // bug 20260707100000_fix_setup_versions_insert_policy.sql fixed) must be
    // distinguishable from a network blip in dev.
    console.error("pending_feedback_retry replay failed", {
      code: err?.code,
      message: err?.message,
      details: err?.details,
    });
    return e;
  }
}

let flushing = false;

/** Flush the queue: attempt each entry, remove on success, keep on failure.
 *  Called from the root layout on app launch. Safe while signed out — the
 *  helpers throw "Not signed in" and entries are kept for the next launch. */
export async function flushFeedbackRetryQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = await readQueue();
    if (!q.length) return;
    const remaining: PendingFeedbackRetry[] = [];
    for (const entry of q) {
      const kept = await replay(entry);
      if (kept) remaining.push(kept);
    }
    await writeQueue(remaining);
  } catch (err) {
    console.error("pending_feedback_retry flush failed", err);
  } finally {
    flushing = false;
  }
}
