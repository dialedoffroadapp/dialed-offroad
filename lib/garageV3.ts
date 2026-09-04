// lib/garageV3.ts
// Data for the v3 Garage: the bike list (2+ bikes) and the per-bike page.
// Same fail-open discipline as lib/homeV3.ts.
import { EMPTY_EXTRAS, readBikeExtras, type BikeExtras } from "./bikeExtras";
import { publicUrlForPath, readCachedBikePhotoUrl } from "./bikePhoto";
import { readNamedSetups, readVersionSetupMap, setupsForBike, type SetupWithVersions } from "./bikeSetups";
import { computeMeter, type MeterCategory, type MeterInputs } from "./dialedMeter";
import type { HomeBike } from "./homeV3";
import { fetchModelSpecs, type ModelSpecs } from "./modelSpecs";
import { deriveIsPro } from "./proUtils";
import { hasPurchasedThisSession } from "./purchases";
import { buildStory, type StoryEntry } from "./setupStory";
import { getHistoryWithFeedback, type RideFeedbackRow, type VersionWithFeedback } from "./setupVersions";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export type ClickRanges = {
  verified: boolean;
  fork_comp: number | null;
  fork_reb: number | null;
  shock_lsc: number | null;
  shock_reb: number | null;
  shock_hsc: number | null;
};

export const NO_RANGES: ClickRanges = { verified: false, fork_comp: null, fork_reb: null, shock_lsc: null, shock_reb: null, shock_hsc: null };

/** Range bars render only when bike_models.click_range_verified is true
 *  (the existing *_max columns are seed defaults on every row). */
export async function readClickRanges(modelId: string | null | undefined): Promise<ClickRanges> {
  if (!modelId || !isUuid(modelId)) return NO_RANGES;
  try {
    const { data, error } = await supabase
      .from("bike_models")
      .select("click_range_verified, fork_comp_max, fork_reb_max, shock_comp_max, shock_reb_max, shock_hsc_turns_max")
      .eq("id", modelId)
      .maybeSingle();
    const r = data as any;
    if (error || !r?.click_range_verified) return NO_RANGES;
    return {
      verified: true,
      fork_comp: r.fork_comp_max ?? null,
      fork_reb: r.fork_reb_max ?? null,
      shock_lsc: r.shock_comp_max ?? null,
      shock_reb: r.shock_reb_max ?? null,
      shock_hsc: r.shock_hsc_turns_max ?? null,
    };
  } catch {
    return NO_RANGES; // column missing pre-migration
  }
}

export async function loadUserAndPro(): Promise<{ userId: string | null; isPro: boolean }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  if (!userId) return { userId, isPro: false };
  try {
    const { data: prof } = await supabase.from("profiles").select("is_pro, pro_until").eq("user_id", userId).maybeSingle();
    return { userId, isPro: deriveIsPro(prof as any) || hasPurchasedThisSession() };
  } catch {
    return { userId, isPro: hasPurchasedThisSession() };
  }
}

export async function loadBikes(userId: string): Promise<HomeBike[]> {
  try {
    const { data } = await supabase
      .from("bikes")
      .select("id, make, model, year, nickname, model_id, is_primary")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    return ((data ?? []) as any[]).map((b) => ({
      id: b.id,
      make: b.make ?? null,
      model: b.model ?? null,
      year: b.year ?? null,
      nickname: b.nickname ?? null,
      model_id: b.model_id ?? null,
      is_primary: !!b.is_primary,
    }));
  } catch {
    return [];
  }
}

export type BikePageData = {
  userId: string | null;
  isPro: boolean;
  bike: HomeBike;
  specs: ModelSpecs | null;
  ranges: ClickRanges;
  extras: BikeExtras;
  photoUrl: string | null;
  versions: VersionWithFeedback[];
  feedback: RideFeedbackRow[];
  setups: SetupWithVersions[];
  meterInputs: MeterInputs;
  meterPct: number;
  meterCategories: MeterCategory[];
  story: StoryEntry[];
};

async function safeSessions(bikeId: string): Promise<{ id: string; sag_measured: boolean | null }[]> {
  try {
    const { data } = await supabase.from("sessions").select("id, sag_measured").eq("bike_id", bikeId);
    return (data ?? []) as { id: string; sag_measured: boolean | null }[];
  } catch {
    return [];
  }
}

async function safeHistory(bikeId: string): Promise<VersionWithFeedback[]> {
  try {
    return await getHistoryWithFeedback(bikeId);
  } catch {
    return [];
  }
}

async function safeSpecs(bike: HomeBike): Promise<ModelSpecs | null> {
  try {
    return await fetchModelSpecs({ id: bike.id, model_id: bike.model_id, make: bike.make, model: bike.model, year: bike.year });
  } catch {
    return null;
  }
}

export async function loadBikePage(bike: HomeBike): Promise<Omit<BikePageData, "userId" | "isPro">> {
  const [versions, extras, cachedPhoto, named, versionSetup, specs, sessions] = await Promise.all([
    safeHistory(bike.id),
    readBikeExtras(bike.id),
    readCachedBikePhotoUrl(bike.id),
    readNamedSetups(bike.id),
    readVersionSetupMap(bike.id),
    safeSpecs(bike),
    safeSessions(bike.id),
  ]);
  const ranges = await readClickRanges(specs?.id ?? bike.model_id);
  let feedback: RideFeedbackRow[] = [];
  if (versions.length) {
    try {
      const { data } = await supabase
        .from("ride_feedback")
        .select("*")
        .in("setup_version_id", versions.map((v) => v.id))
        .order("created_at", { ascending: false });
      feedback = (data ?? []) as unknown as RideFeedbackRow[];
    } catch {
      feedback = [];
    }
  }
  const feedbackByRidden = new Map<string, RideFeedbackRow>();
  for (const f of [...feedback].reverse()) feedbackByRidden.set(f.setup_version_id, f);
  const inputs: MeterInputs = {
    hasBaseline: versions.length > 0,
    sagMeasured: versions.some((v) => v.sag_measured) || sessions.some((s) => s.sag_measured === true),
    ridesLogged: feedback.length,
    refinements: versions.filter((v) => v.source === "refinement").length,
    outcomesRecorded: feedback.filter((f) => !!f.outcome).length,
  };
  const meter = computeMeter(inputs);
  return {
    bike,
    specs,
    ranges,
    extras,
    photoUrl: publicUrlForPath(extras.photoPath) ?? cachedPhoto,
    versions,
    feedback,
    setups: setupsForBike(bike.id, named, versions, versionSetup),
    meterInputs: inputs,
    meterPct: meter.pct,
    meterCategories: meter.categories,
    story: buildStory(versions, feedbackByRidden),
  };
}

export type BikeListItem = HomeBike & { pct: number; hours: number | null };

export async function loadBikeList(userId: string): Promise<BikeListItem[]> {
  const bikes = await loadBikes(userId);
  const items = await Promise.all(
    bikes.map(async (b) => {
      try {
        const page = await loadBikePage(b);
        return { ...b, pct: page.versions.length ? page.meterPct : 0, hours: page.extras.hours };
      } catch {
        return { ...b, pct: 0, hours: EMPTY_EXTRAS.hours };
      }
    })
  );
  return items;
}
