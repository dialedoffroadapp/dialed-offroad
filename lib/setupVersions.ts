// lib/setupVersions.ts
// Typed helpers for the Tune Two v2 lineage tables (setup_versions, ride_feedback).
// These shadow the existing `sessions` writes — callers must treat failures as
// non-fatal and never let them break the save/refine flow.

import { Tune2Context, Tune2SymptomId, ZeroTuneResult } from "./ai";
import { supabase } from "./supabase";
import { logEvent } from "./usage";

export type SetupSource = "baseline" | "refinement" | "restore" | "manual";
export type FeedbackOutcome = "improved" | "same" | "worse";

export type FeedbackSymptom = {
  id: Tune2SymptomId;
  severity: number; // 1–10, post-conversion scale
  where?: string;
};

export type SetupVersionRow = {
  id: string;
  user_id: string;
  bike_id: string | null;
  version_number: number;
  source: SetupSource;
  parent_version_id: string | null;
  restored_from_version_id: string | null;
  fork_comp_clicks: number | null;
  fork_reb_clicks: number | null;
  fork_air_bar: number | null;
  shock_lsc_clicks: number | null;
  shock_hsc_turns: number | null;
  shock_reb_clicks: number | null;
  sag_mm: number | null;
  notes: string[];
  terrain: string | null;
  context: Tune2Context | null;
  created_at: string;
};

export type RideFeedbackRow = {
  id: string;
  user_id: string;
  setup_version_id: string;
  resulting_version_id: string | null;
  overall_rating: number | null;
  symptoms: FeedbackSymptom[];
  free_text: string | null;
  outcome: FeedbackOutcome | null;
  created_at: string;
};

const VERSION_COLUMNS =
  "id, user_id, bike_id, version_number, source, parent_version_id, " +
  "restored_from_version_id, fork_comp_clicks, fork_reb_clicks, fork_air_bar, " +
  "shock_lsc_clicks, shock_hsc_turns, shock_reb_clicks, sag_mm, notes, terrain, " +
  "context, created_at";

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data?.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

/** Flatten a ZeroTuneResult into setup_versions columns. */
function tuneColumns(tune: ZeroTuneResult) {
  return {
    fork_comp_clicks: tune.fork.comp_clicks,
    fork_reb_clicks: tune.fork.reb_clicks,
    fork_air_bar:
      typeof tune.fork.air_pressure_bar === "number"
        ? tune.fork.air_pressure_bar
        : null,
    shock_lsc_clicks: tune.shock.lsc_clicks,
    shock_hsc_turns: tune.shock.hsc_turns,
    shock_reb_clicks: tune.shock.reb_clicks,
    sag_mm: tune.shock.sag_mm,
    notes: tune.notes ?? [],
  };
}

/**
 * createBaselineVersion
 * Insert a version row for a Tune One result. version_number is assigned by a
 * DB trigger (max+1 per user+bike; first version for a bike is 1).
 */
export async function createBaselineVersion(params: {
  bikeId: string | null;
  tune: ZeroTuneResult;
  terrain?: string | null;
  context?: Tune2Context | null;
}): Promise<SetupVersionRow> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("setup_versions")
    .insert({
      user_id: userId,
      bike_id: params.bikeId ?? null,
      source: "baseline",
      parent_version_id: null,
      terrain: params.terrain ?? null,
      context: params.context ?? null,
      ...tuneColumns(params.tune),
    })
    .select(VERSION_COLUMNS)
    .single<SetupVersionRow>();

  if (error) throw error;

  void logEvent("version_created", {
    source: "baseline",
    bike_id: params.bikeId ?? null,
    version_number: data.version_number,
  });
  return data;
}

/**
 * createRefinementVersion
 * Insert the refined tune as a child of the critiqued version. If feedbackId is
 * provided, links ride_feedback.resulting_version_id to the new version.
 */
export async function createRefinementVersion(params: {
  bikeId: string | null;
  parentVersionId: string;
  tune: ZeroTuneResult;
  terrain?: string | null;
  context?: Tune2Context | null;
  feedbackId?: string | null;
}): Promise<SetupVersionRow> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("setup_versions")
    .insert({
      user_id: userId,
      bike_id: params.bikeId ?? null,
      source: "refinement",
      parent_version_id: params.parentVersionId,
      terrain: params.terrain ?? null,
      context: params.context ?? null,
      ...tuneColumns(params.tune),
    })
    .select(VERSION_COLUMNS)
    .single<SetupVersionRow>();

  if (error) throw error;

  if (params.feedbackId) {
    const { error: linkErr } = await supabase
      .from("ride_feedback")
      .update({ resulting_version_id: data.id })
      .eq("id", params.feedbackId);
    if (linkErr) {
      // The version row exists either way; the missing link is recoverable.
      console.warn("ride_feedback resulting_version_id link failed", linkErr);
    }
  }

  void logEvent("version_created", {
    source: "refinement",
    bike_id: params.bikeId ?? null,
    version_number: data.version_number,
    parent_version_id: params.parentVersionId,
  });
  return data;
}

/**
 * createFeedback
 * Persist the rider's structured feedback (and, for the first time, the raw
 * free-text notes) against the version being critiqued.
 */
export async function createFeedback(params: {
  setupVersionId: string;
  overallRating?: number | null; // 1–10, post-conversion
  symptoms: FeedbackSymptom[];
  freeText?: string | null;
}): Promise<RideFeedbackRow> {
  const userId = await requireUserId();
  const freeText =
    typeof params.freeText === "string" && params.freeText.trim().length > 0
      ? params.freeText.trim()
      : null;

  const { data, error } = await supabase
    .from("ride_feedback")
    .insert({
      user_id: userId,
      setup_version_id: params.setupVersionId,
      overall_rating: params.overallRating ?? null,
      symptoms: params.symptoms,
      free_text: freeText,
    })
    .select("*")
    .single<RideFeedbackRow>();

  if (error) throw error;

  void logEvent("feedback_submitted", {
    symptom_count: params.symptoms.length,
    has_free_text: !!freeText,
  });
  return data;
}

/** updateFeedbackOutcome — later check-in: did the refinement help? */
export async function updateFeedbackOutcome(
  feedbackId: string,
  outcome: FeedbackOutcome
): Promise<void> {
  const { error } = await supabase
    .from("ride_feedback")
    .update({ outcome })
    .eq("id", feedbackId);

  if (error) throw error;
  void logEvent("outcome_recorded", { outcome });
}

/** getVersionHistory — all versions for a bike, newest first. */
export async function getVersionHistory(
  bikeId: string
): Promise<SetupVersionRow[]> {
  const { data, error } = await supabase
    .from("setup_versions")
    .select(VERSION_COLUMNS)
    .eq("bike_id", bikeId)
    .order("version_number", { ascending: false });

  if (error) throw error;
  // supabase-js can't infer a row type from the joined column string.
  return (data ?? []) as unknown as SetupVersionRow[];
}
