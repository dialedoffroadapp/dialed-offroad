// lib/profiles.ts
import { supabase } from "./supabase";

/** Matches your public.profiles table shape (nullable where appropriate). */
export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  experience: string | null;
  location: string | null;
  dark_mode: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Get the signed-in user's profile. Returns null if not found. */
export async function getProfile(): Promise<ProfileRow | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "user_id, display_name, avatar_url, experience, location, dark_mode, created_at, updated_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as ProfileRow) ?? null;
}

/** Create or update the profile for the signed-in user. */
export async function saveProfile(patch: Partial<ProfileRow>): Promise<ProfileRow> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const payload = {
    user_id: userId,
    display_name: patch.display_name ?? null,
    avatar_url: patch.avatar_url ?? null,
    experience: patch.experience ?? null,
    location: patch.location ?? null,
    dark_mode: patch.dark_mode ?? null,
    // created_at is defaulted in DB; updated_at maintained here for convenience
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select(
      "user_id, display_name, avatar_url, experience, location, dark_mode, created_at, updated_at"
    )
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

/** Optional: ensure a row exists (no-op if it already does). */
export async function ensureProfile(): Promise<ProfileRow> {
  const existing = await getProfile().catch(() => null);
  if (existing) return existing;
  return await saveProfile({});
}
