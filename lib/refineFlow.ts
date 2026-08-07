// lib/refineFlow.ts
// Helpers for launching the refine flow (tune-feedback) from a saved
// setup_versions row — used by Bike Home and the tune tab's active-setup
// block, mirroring the params the results screen's "Refine After Ride" sends.

import { Tune2Context, ZeroTuneResult } from "./ai";
import { SetupVersionRow } from "./setupVersions";

/** Rebuild a ZeroTuneResult from a version row's columns. */
export function versionToTuneResult(v: SetupVersionRow): ZeroTuneResult {
  const n = (val: number | null, fallback: number) =>
    typeof val === "number" && Number.isFinite(val) ? val : fallback;
  const hasAir = typeof v.fork_air_bar === "number";

  return {
    fork: {
      comp_clicks: n(v.fork_comp_clicks, 12),
      reb_clicks: n(v.fork_reb_clicks, 12),
      ...(hasAir ? { air_pressure_bar: v.fork_air_bar as number } : {}),
    },
    shock: {
      lsc_clicks: n(v.shock_lsc_clicks, 12),
      hsc_turns: n(v.shock_hsc_turns, 1.5),
      reb_clicks: n(v.shock_reb_clicks, 14),
      sag_mm: n(v.sag_mm, 105),
    },
    detected: { has_air_fork: hasAir },
    notes: Array.isArray(v.notes) ? v.notes : [],
  };
}

/** Compact one-line values summary: "Fork 14/12 · Shock 12/1.4/14 · Sag 103". */
export function formatValuesLine(v: SetupVersionRow): string {
  const part = (val: number | null, digits = 0): string =>
    typeof val === "number" && Number.isFinite(val) ? val.toFixed(digits) : "—";
  return [
    `Fork ${part(v.fork_comp_clicks)}/${part(v.fork_reb_clicks)}`,
    `Shock ${part(v.shock_lsc_clicks)}/${part(v.shock_hsc_turns, 1)}/${part(
      v.shock_reb_clicks
    )}`,
    `Sag ${part(v.sag_mm)}`,
  ].join(" · ");
}

/**
 * Router params for /tune-feedback, refining `version` as the previous tune.
 * Mirrors tune-results' goToFeedback: meta + previous + context + bikeId +
 * versionId (so the feedback row critiques this exact version).
 */
export function buildRefineParams(
  version: SetupVersionRow,
  bikeTitle: string
): Record<string, string> {
  const storedCtx: any =
    version.context && typeof version.context === "object"
      ? version.context
      : {};

  // The matched model uuid lives in the engine-context capture
  // (recommended_settings.context.model_id, wrapper shape only); refinement
  // contexts built after v2.4.0 also carry it directly on version.context.
  const rec: any = version.recommended_settings;
  const recCtx: any =
    rec && typeof rec === "object" && "context" in rec ? rec.context : null;
  const modelId: string | undefined =
    (typeof recCtx?.model_id === "string" && recCtx.model_id) ||
    (typeof storedCtx.model_id === "string" && storedCtx.model_id) ||
    undefined;

  const terrain: string | undefined =
    version.terrain ?? storedCtx.terrain ?? undefined;

  const ctx: Tune2Context & Record<string, unknown> = {
    make: storedCtx.make,
    model: storedCtx.model,
    year: storedCtx.year,
    model_id: modelId,
    terrain,
    track: storedCtx.track,
    temp_f: storedCtx.temp_f,
    elev_ft: storedCtx.elev_ft,
    rider: {
      weight_lbs: storedCtx.rider?.weight_lbs,
      skill: storedCtx.rider?.skill ?? "intermediate",
      style: storedCtx.rider?.style ?? "short_motos",
      goals: Array.isArray(storedCtx.rider?.goals) ? storedCtx.rider.goals : [],
    },
    wants_air_fork:
      !!storedCtx.wants_air_fork || typeof version.fork_air_bar === "number",
    selectedBikeId: version.bike_id ?? undefined,
    bike_id: version.bike_id ?? undefined,
  };

  const meta = {
    bikeTitle,
    surface: terrain,
    mode: "Balanced",
    bike_id: version.bike_id ?? null,
    context: ctx,
  };

  return {
    meta: encodeURIComponent(JSON.stringify(meta)),
    previous: encodeURIComponent(JSON.stringify(versionToTuneResult(version))),
    context: encodeURIComponent(JSON.stringify(ctx)),
    bikeId: version.bike_id ?? "",
    versionId: version.id,
  };
}
