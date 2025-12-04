// lib/bikes.ts
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
