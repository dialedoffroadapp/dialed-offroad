// lib/setupVersions.ts
// Typed helpers for the Tune Two v2 lineage tables (setup_versions, ride_feedback).
// These shadow the existing `sessions` writes — callers must treat failures as
// non-fatal and never let them break the save/refine flow.

import { Tune2Context, Tune2SymptomId, ZeroTuneResult } from "./ai";
import { supabase } from "./supabase";
import { logEvent } from "./usage";
import { asUuidOrNull, isUuid } from "./uuid";

export type SetupSource = "baseline" | "refinement" | "restore" | "manual";
export type FeedbackOutcome = "improved" | "same" | "worse";

export type FeedbackSymptom = {
  id: Tune2SymptomId;
  severity: number; // 1–10, post-conversion scale
  where?: string;
};

// "Don't touch" areas the rider marked as already working.
export type FeedbackProtection = {
  area: string;
  protect: true;
};

// ride_feedback.symptoms jsonb shape: a FLAT ARRAY mixing issue entries
// ({id, severity, where?}) and protection entries ({area, protect: true}).
// Chosen over an {issues, protected} object root so rows written before the
// protect feature existed (plain symptom arrays) keep the exact same shape —
// consumers distinguish entries by the presence of the `protect` flag.
export type FeedbackEntry = FeedbackSymptom | FeedbackProtection;

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
  symptoms: FeedbackEntry[];
  free_text: string | null;
  outcome: FeedbackOutcome | null;
  created_at: string;
};

export const VERSION_COLUMNS =
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

/** A tune's settings as a flat snapshot (recommended_settings.settings shape). */
export type SettingsSnapshot = {
  fork_comp: number | null;
  fork_reb: number | null;
  fork_air: number | null;
  shock_lsc: number | null;
  shock_hsc: number | null;
  shock_reb: number | null;
  shock_sag: number | null;
};

function settingsSnapshot(tune: ZeroTuneResult): SettingsSnapshot {
  return {
    fork_comp: tune.fork.comp_clicks,
    fork_reb: tune.fork.reb_clicks,
    fork_air:
      typeof tune.fork.air_pressure_bar === "number"
        ? tune.fork.air_pressure_bar
        : null,
    shock_lsc: tune.shock.lsc_clicks,
    shock_hsc: tune.shock.hsc_turns,
    shock_reb: tune.shock.reb_clicks,
    shock_sag: tune.shock.sag_mm,
  };
}

// The engine-context bundle recorded alongside the settings (the training link).
export type RecommendedContext = {
  model_id: string | null;
  spec_verified: boolean;
  sag_target_mm: number | null;
  sag_bounds: [number, number] | null;
  rider_weight_lbs: number | null;
  spring_check: { status: string; direction?: string } | null;
  engine: string;
};

// recommended_settings jsonb: canonical shape is { settings, context }, but prod
// ALSO contains BARE SettingsSnapshot rows written by the 48h-old store build's
// live clients until the next release ships. Readers MUST tolerate BOTH shapes.
export type RecommendedSettings =
  | SettingsSnapshot
  | { settings: SettingsSnapshot; context?: RecommendedContext | null };

/** Settings snapshot from either recommended_settings shape (dual-shape safe). */
export function settingsFromRecommended(
  rec: RecommendedSettings | null | undefined
): SettingsSnapshot | null {
  if (!rec || typeof rec !== "object") return null;
  // Wrapper shape — detect by EITHER key, so a malformed row like
  // {"context": null} (settings key dropped by a buggy writer; such rows exist
  // in prod) reads as "no settings" instead of being misreturned as a bare
  // snapshot. Bare snapshots only ever carry circuit keys (fork_comp, …).
  if ("settings" in rec || "context" in rec) return (rec as any).settings ?? null;
  return rec as SettingsSnapshot;
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
  // Engine-context capture: recorded in recommended_settings.context.
  recommendedContext?: RecommendedContext | null;
}): Promise<SetupVersionRow> {
  const userId = await requireUserId();

  // Legacy/guest bike ids ("1783553470201_…") are not uuids — treat as
  // bikeless rather than letting Postgres reject the row.
  const bikeId = asUuidOrNull(params.bikeId);

  const { data, error } = await supabase
    .from("setup_versions")
    .insert({
      user_id: userId,
      bike_id: bikeId,
      source: "baseline",
      parent_version_id: null,
      terrain: params.terrain ?? null,
      context: params.context ?? null,
      ...tuneColumns(params.tune),
      // Canonical { settings, context } — the engine's inputs recorded alongside
      // its outputs. (The delta trigger diffs the typed columns, not this jsonb.)
      recommended_settings: {
        settings: settingsSnapshot(params.tune),
        context: params.recommendedContext ?? null,
      },
    })
    .select(VERSION_COLUMNS)
    .single<SetupVersionRow>();

  if (error) throw error;

  void logEvent("version_created", {
    source: "baseline",
    bike_id: bikeId,
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
  const bikeId = asUuidOrNull(params.bikeId);

  const { data, error } = await supabase
    .from("setup_versions")
    .insert({
      user_id: userId,
      bike_id: bikeId,
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
    bike_id: bikeId,
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
  symptoms: FeedbackEntry[]; // issue + protection entries, see FeedbackEntry
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
    symptom_count: params.symptoms.filter((s) => !("protect" in s)).length,
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
  if (!isUuid(bikeId)) return []; // legacy/guest ids never reach the DB

  const { data, error } = await supabase
    .from("setup_versions")
    .select(VERSION_COLUMNS)
    .eq("bike_id", bikeId)
    .order("version_number", { ascending: false });

  if (error) throw error;
  // supabase-js can't infer a row type from the joined column string.
  return (data ?? []) as unknown as SetupVersionRow[];
}

export type VersionWithFeedback = SetupVersionRow & {
  /** The ride_feedback row whose refinement PRODUCED this version, if any. */
  feedback: RideFeedbackRow | null;
};

/**
 * getHistoryWithFeedback — all versions for a bike (newest first), each
 * carrying the feedback that triggered it (symptoms, free_text, outcome).
 * Merged client-side: one query per table, joined on resulting_version_id.
 */
export async function getHistoryWithFeedback(
  bikeId: string
): Promise<VersionWithFeedback[]> {
  const versions = await getVersionHistory(bikeId);
  if (!versions.length) return [];

  const ids = versions.map((v) => v.id);
  const { data, error } = await supabase
    .from("ride_feedback")
    .select("*")
    .in("resulting_version_id", ids);
  if (error) throw error;

  const byResult = new Map<string, RideFeedbackRow>();
  for (const fb of (data ?? []) as unknown as RideFeedbackRow[]) {
    if (fb.resulting_version_id) byResult.set(fb.resulting_version_id, fb);
  }

  return versions.map((v) => ({ ...v, feedback: byResult.get(v.id) ?? null }));
}

/**
 * createRestoreVersion — save a past setup as a NEW version (nothing is
 * deleted): copies fromVersion's clicker/sag/air values, parents onto the
 * current version, and points restored_from_version_id at the source.
 */
export async function createRestoreVersion(params: {
  bikeId: string | null;
  fromVersion: SetupVersionRow;
  currentVersionId: string;
}): Promise<SetupVersionRow> {
  const userId = await requireUserId();
  const { fromVersion } = params;
  const bikeId = asUuidOrNull(params.bikeId);

  const { data, error } = await supabase
    .from("setup_versions")
    .insert({
      user_id: userId,
      bike_id: bikeId,
      source: "restore",
      parent_version_id: params.currentVersionId,
      restored_from_version_id: fromVersion.id,
      fork_comp_clicks: fromVersion.fork_comp_clicks,
      fork_reb_clicks: fromVersion.fork_reb_clicks,
      fork_air_bar: fromVersion.fork_air_bar,
      shock_lsc_clicks: fromVersion.shock_lsc_clicks,
      shock_hsc_turns: fromVersion.shock_hsc_turns,
      shock_reb_clicks: fromVersion.shock_reb_clicks,
      sag_mm: fromVersion.sag_mm,
      notes: [`Restored from v${fromVersion.version_number}`],
      terrain: fromVersion.terrain,
      context: fromVersion.context,
    })
    .select(VERSION_COLUMNS)
    .single<SetupVersionRow>();

  if (error) throw error;

  void logEvent("version_created", {
    source: "restore",
    bike_id: bikeId,
    version_number: data.version_number,
    restored_from_version_id: fromVersion.id,
  });
  return data;
}
