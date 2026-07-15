// lib/bikes.ts
import { BIKE_CATALOG } from "../constants/bike-catalog";
import { supabase } from "./supabase";

/** Row shape we use in the app (nullable fields tolerated). */
export type BikeRow = {
  id: string;
  user_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  nickname: string | null;
  is_primary: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type BikeSelect =
  "id, user_id, make, model, year, nickname, is_primary, created_at, updated_at";

/** List the current user's bikes, primary first. */
export async function listBikes(): Promise<BikeRow[]> {
  const { data, error } = await supabase
    .from("bikes")
    .select<BikeSelect>( // just to help IDEs
      "id, user_id, make, model, year, nickname, is_primary, created_at, updated_at"
    )
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as BikeRow[];
}

export type NewBikeInput = {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  nickname?: string | null;
  is_primary?: boolean | null;
};

/** Create a bike. (RLS should ensure user_id = auth.uid()). */
export async function createBike(input: NewBikeInput): Promise<BikeRow> {
  const { data, error } = await supabase
    .from("bikes")
    .insert({
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      nickname: input.nickname ?? null,
      is_primary: input.is_primary ?? false,
    })
    .select(
      "id, user_id, make, model, year, nickname, is_primary, created_at, updated_at"
    )
    .single();

  if (error) throw error;
  return data as BikeRow;
}

/** Update a bike (partial). */
export async function updateBike(id: string, patch: NewBikeInput): Promise<BikeRow> {
  const { data, error } = await supabase
    .from("bikes")
    .update({
      make: patch.make ?? null,
      model: patch.model ?? null,
      year: patch.year ?? null,
      nickname: patch.nickname ?? null,
      is_primary: patch.is_primary ?? false,
    })
    .eq("id", id)
    .select(
      "id, user_id, make, model, year, nickname, is_primary, created_at, updated_at"
    )
    .single();

  if (error) throw error;
  return data as BikeRow;
}

/** Delete a bike. */
export async function deleteBike(id: string): Promise<void> {
  const { error } = await supabase.from("bikes").delete().eq("id", id);
  if (error) throw error;
}

/** Make one bike primary (set others false for this user). */
export async function setPrimary(id: string): Promise<void> {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  // turn off primary for all user's bikes, then enable for the chosen one
  const off = await supabase.from("bikes").update({ is_primary: false }).eq("user_id", userId);
  if (off.error) throw off.error;

  const on = await supabase.from("bikes").update({ is_primary: true }).eq("id", id);
  if (on.error) throw on.error;
}

/* ------------------ Bike string canonicalization + model_id ---------------- */
// Space/hyphen/case-insensitive key. Removing spaces AND hyphens keeps genuinely
// different models distinct ("XC"→xc, "XC-W"→xcw, "XC-F"→xcf, "XCF-W"→xcfw) while
// merging pure spacing/hyphen/case variants of the SAME model.
const canonKey = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "");
const collapseWs = (s: string) => s.trim().replace(/\s+/g, " ");

const MAKE_BY_KEY = new Map<string, string>();
const MODEL_KEY_BY_MAKE = new Map<string, Map<string, string>>();
for (const [make, models] of Object.entries(BIKE_CATALOG)) {
  MAKE_BY_KEY.set(canonKey(make), make);
  const mm = new Map<string, string>();
  for (const m of models) mm.set(canonKey(m), m);
  MODEL_KEY_BY_MAKE.set(make, mm);
}

/** Canonical make for the catalog, else the collapsed input if the brand is unknown. */
function canonicalMake(makeRaw: string): string {
  const m = collapseWs(makeRaw);
  return MAKE_BY_KEY.get(canonKey(m)) ?? m;
}

/**
 * Trim + collapse whitespace, uppercase-known-brand makes, and canonical-case the
 * model against the catalog when a space/hyphen/case-insensitive match exists.
 * Different models (XC vs XC-W vs XC-F vs XCF-W) have distinct keys, so this never
 * merges across genuinely different bikes. Unrecognized strings pass through
 * trimmed, never guessed.
 */
export function normalizeBikeStrings(
  makeRaw: string,
  modelRaw: string
): { make: string; model: string } {
  const make = canonicalMake(makeRaw);
  const modelCollapsed = collapseWs(modelRaw);
  const canonModel =
    (modelCollapsed &&
      MODEL_KEY_BY_MAKE.get(make)?.get(canonKey(modelCollapsed))) ||
    modelCollapsed;
  return { make, model: canonModel };
}

/** True when (make, model) resolves to a known catalog model (space/hyphen/case-insensitive). */
export function catalogHasModel(makeRaw: string, modelRaw: string): boolean {
  const make = canonicalMake(makeRaw);
  const model = collapseWs(modelRaw);
  return !!model && !!MODEL_KEY_BY_MAKE.get(make)?.has(canonKey(model));
}

/**
 * Resolve bikes.model_id from a canonical make/model/year against bike_models.
 * Fail-open: returns null on any error or no match — never throws, never blocks a
 * bike save. Tries a year_start/year_end RANGE match first (survives the planned
 * migration to year ranges); if those columns don't exist yet the range query
 * errors (42703) and we fall through to the current exact-year match.
 */
export async function resolveModelId(
  make: string,
  model: string,
  year: number | null | undefined
): Promise<string | null> {
  const mk = collapseWs(make);
  const mo = collapseWs(model);
  if (!mk || !mo || typeof year !== "number" || !Number.isFinite(year)) {
    return null;
  }
  try {
    // Range match (post-migration schema).
    const ranged = await supabase
      .from("bike_models")
      .select("id")
      .ilike("make", mk)
      .ilike("model", mo)
      .lte("year_start", year)
      .gte("year_end", year)
      .limit(1)
      .maybeSingle();
    if (!ranged.error && (ranged.data as any)?.id) {
      return (ranged.data as any).id as string;
    }

    // Exact-year match (current schema).
    const exact = await supabase
      .from("bike_models")
      .select("id")
      .ilike("make", mk)
      .ilike("model", mo)
      .eq("year", year)
      .limit(1)
      .maybeSingle();
    if (!exact.error && (exact.data as any)?.id) {
      return (exact.data as any).id as string;
    }
    return null;
  } catch {
    return null;
  }
}
