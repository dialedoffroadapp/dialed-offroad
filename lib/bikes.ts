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

/** Match a canonical make/model to the generation row whose [year_start,
 *  year_end] range contains `year` (year_end null = ongoing). Newest generation
 *  wins on any overlap. */
async function matchGeneration(
  make: string,
  model: string,
  year: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("bike_models")
    .select("id")
    .ilike("make", make)
    .ilike("model", model)
    .lte("year_start", year)
    .or(`year_end.is.null,year_end.gte.${year}`)
    .order("year_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !(data as any)?.id) return null;
  return (data as any).id as string;
}

/**
 * Resolve bikes.model_id from a make/model/year against the bike_models
 * generation table. Fail-open: returns null on any error or no match — never
 * throws, never blocks a bike save.
 *   1. Canonical: match make/model with year inside a generation's range.
 *   2. Alias fallback: a normalized user-entered variant (bike_model_aliases,
 *      stored lowercased) maps to a canonical model, then that model's
 *      generation is re-resolved by year — aliases carry no year, so year
 *      resolution lives here.
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
    const canon = await matchGeneration(mk, mo, year);
    if (canon) return canon;

    const { data: alias } = await supabase
      .from("bike_model_aliases")
      .select("model_id")
      .eq("alias_make", mk.toLowerCase())
      .eq("alias_model", mo.toLowerCase())
      .limit(1)
      .maybeSingle();
    const aliasModelId = (alias as any)?.model_id as string | undefined;
    if (aliasModelId) {
      const { data: row } = await supabase
        .from("bike_models")
        .select("make, model")
        .eq("id", aliasModelId)
        .maybeSingle();
      const cMake = (row as any)?.make as string | undefined;
      const cModel = (row as any)?.model as string | undefined;
      if (cMake && cModel) return await matchGeneration(cMake, cModel, year);
    }
    return null;
  } catch {
    return null;
  }
}
