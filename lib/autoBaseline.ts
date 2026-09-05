// lib/autoBaseline.ts
// Auto-create the v1 setup version when onboarding completes, from the
// pending tune the funnel generated. Before this, v1 only existed if the
// rider manually tapped "Save Setup" — most didn't, so Day-1 Home rendered
// like Day 0 (no ActiveSetupCard, no RunningSetupRow, no Bike Home state)
// and every refine entry point that keys on setup_versions stayed hidden.
//
// Failure here must NEVER block onboarding completion: every path returns
// null instead of throwing, and real Supabase errors are logged so RLS
// rejections (the 42501 class this codebase has shipped before) are
// distinguishable from network failures in dev.

import { ZeroTuneResult } from "./ai";
import { readPendingTune } from "./onboarding";
import { createBaselineVersion, SetupVersionRow } from "./setupVersions";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export type AutoBaselineResult = {
  version: SetupVersionRow;
  bikeId: string;
  bikeTitle: string;
};

/**
 * True when a stored version row carries exactly the clicker/sag/air values
 * of `tune`. Used to make the manual "Save Setup" idempotent against the
 * auto-created onboarding v1 (and double-taps) WITHOUT breaking saves of
 * genuinely different tunes for the same bike later.
 */
export function versionMatchesTune(
  v: Pick<
    SetupVersionRow,
    | "fork_comp_clicks"
    | "fork_reb_clicks"
    | "fork_air_bar"
    | "shock_lsc_clicks"
    | "shock_hsc_turns"
    | "shock_reb_clicks"
    | "sag_mm"
  >,
  tune: ZeroTuneResult
): boolean {
  const norm = (x: number | null | undefined) =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  return (
    norm(v.fork_comp_clicks) === norm(tune.fork.comp_clicks) &&
    norm(v.fork_reb_clicks) === norm(tune.fork.reb_clicks) &&
    norm(v.fork_air_bar) === norm(tune.fork.air_pressure_bar) &&
    norm(v.shock_lsc_clicks) === norm(tune.shock.lsc_clicks) &&
    norm(v.shock_hsc_turns) === norm(tune.shock.hsc_turns) &&
    norm(v.shock_reb_clicks) === norm(tune.shock.reb_clicks) &&
    norm(v.sag_mm) === norm(tune.shock.sag_mm)
  );
}

/**
 * Resolve the bike the pending tune belongs to, as a REAL bikes-table uuid.
 * Guest-onboarding bikes carry local timestamp ids ("1783553470201_…") that
 * signup's remapPendingTuneBikeId normally rewrites — but that remap is
 * fail-silent, so never trust the pending id: a non-uuid would fail RLS
 * silently. Fall back to the user's most recently created bike (the row the
 * signup migration just inserted).
 */
async function resolveBikeId(
  userId: string,
  pendingBikeId: string | null
): Promise<string | null> {
  if (isUuid(pendingBikeId)) {
    // Confirm the row actually exists and belongs to this user — a uuid
    // pointing nowhere would insert an orphaned version.
    const { data, error } = await supabase
      .from("bikes")
      .select("id")
      .eq("id", pendingBikeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("autoBaseline: bike lookup failed", {
        code: (error as any)?.code,
        message: error.message,
      });
      return null;
    }
    if (data?.id) return data.id;
  }

  const { data: newest, error: newestErr } = await supabase
    .from("bikes")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newestErr) {
    console.error("autoBaseline: fallback bike lookup failed", {
      code: (newestErr as any)?.code,
      message: newestErr.message,
    });
    return null;
  }
  return newest?.id ?? null;
}

/**
 * Create the baseline version from the pending onboarding tune.
 * Returns the created version (plus bike info for follow-ups like the ride
 * reminder), or null when skipped/failed — callers never need a try/catch.
 * Skips when: no signed-in user, no pending tune, no resolvable uuid bike,
 * or a setup_versions row already exists for that bike (re-entry guard).
 */
export type AutoBaselineOptions = {
  /** 3.0 named setups: attach the version to this bike_setups row. */
  setupId?: string | null;
  /** "Starts from" lineage (a new setup branched off the running version). */
  parentVersionId?: string | null;
  /** Skip the one-v1-per-bike re-entry guard (a NEW setup on a bike that
   *  already has versions). Callers own their own idempotency then. */
  allowExisting?: boolean;
};

export async function autoCreateBaselineFromPendingTune(opts: AutoBaselineOptions = {}): Promise<AutoBaselineResult | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return null;

    const { tune: pending } = await readPendingTune();
    if (!pending) return null;

    // A pending tune migrated into a DIFFERENT account is not this user's
    // data — never baseline it here (and never let resolveBikeId's
    // newest-bike fallback graft someone else's tune values onto this
    // user's garage). Unstamped payloads (pre-latch builds) pass through.
    if (pending.migratedForUserId && pending.migratedForUserId !== userId) {
      return null;
    }

    let tune: ZeroTuneResult;
    let meta: any;
    try {
      tune = JSON.parse(decodeURIComponent(pending.r)) as ZeroTuneResult;
      meta = JSON.parse(decodeURIComponent(pending.meta));
    } catch (parseErr) {
      console.error("autoBaseline: pending tune unparseable", parseErr);
      return null;
    }
    if (!tune?.fork || !tune?.shock) {
      console.error("autoBaseline: pending tune missing fork/shock");
      return null;
    }

    const bikeId = await resolveBikeId(userId, pending.bikeId);
    if (!bikeId) {
      // Do not insert a bikeless/garbage row — every surface this feature
      // exists for (ActiveSetupCard, RunningSetupRow, Bike Home) keys on a
      // real bike_id.
      console.error(
        "autoBaseline: no uuid bike resolvable (pending bikeId:",
        pending.bikeId,
        ") — skipping auto-save"
      );
      return null;
    }

    // Re-entry guard: this runs from handleOnboardingSuccess, which several
    // paywall completion paths call. One v1 per bike, never duplicates.
    const { data: existing, error: existingErr } = await supabase
      .from("setup_versions")
      .select("id")
      .eq("bike_id", bikeId)
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      console.error("autoBaseline: existing-version check failed", {
        code: (existingErr as any)?.code,
        message: existingErr.message,
      });
      return null;
    }
    if (existing?.id && !opts.allowExisting) return null;

    const terrain: string | null = Array.isArray(meta?.context?.terrain)
      ? meta.context.terrain[0] ?? null
      : meta?.context?.terrain ?? null;

    // Engine-context capture: tune.tsx stores the resolved model + sag inputs
    // in the pending meta (meta.spec) and the spring check on the tune itself —
    // carry them into recommended_settings.context like the manual-save path.
    const spec = meta?.spec ?? null;
    const version = await createBaselineVersion({
      bikeId,
      tune,
      terrain,
      setupId: opts.setupId ?? null,
      parentVersionId: opts.parentVersionId ?? null,
      context: meta?.context ?? null,
      recommendedContext: {
        model_id: spec?.model_id ?? null,
        spec_verified: !!spec?.spec_verified,
        sag_target_mm: spec?.sag_target_mm ?? null,
        sag_bounds: spec?.sag_bounds ?? null,
        rider_weight_lbs: meta?.context?.rider_weight_lbs ?? null,
        spring_check: tune.spring_check
          ? {
              status: tune.spring_check.status,
              direction: tune.spring_check.direction,
            }
          : null,
        engine: "zero_baseline_v1",
      },
    });

    const { data: bike } = await supabase
      .from("bikes")
      .select("make, model, year, nickname")
      .eq("id", bikeId)
      .maybeSingle();
    const bikeTitle =
      bike?.nickname ||
      [bike?.year, bike?.make, bike?.model].filter(Boolean).join(" ") ||
      "your bike";

    // createBaselineVersion already logs version_created — no second event.
    return { version, bikeId, bikeTitle };
  } catch (err: any) {
    console.error("autoBaseline: failed", {
      code: err?.code,
      message: err?.message,
      details: err?.details,
    });
    return null;
  }
}
