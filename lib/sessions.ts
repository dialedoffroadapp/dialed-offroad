// lib/sessions.ts
import { supabase } from "./supabase";

/** Minimal shapes */
export type BikeRow = {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  nickname: string | null; // unused for now
  is_primary: boolean | null;
};

export async function listBikes(): Promise<BikeRow[]> {
  const { data, error } = await supabase
    .from("bikes")
    .select("id, make, model, year, is_primary")
    .order("is_primary", { ascending: false })
    .order("id", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((b: any) => ({
    id: String(b.id),
    make: b.make ?? null,
    model: b.model ?? null,
    year: b.year ?? null,
    nickname: null,
    is_primary: b.is_primary ?? null,
  }));
}

/** Sessions CRUD (simple, tolerant) */
export async function listSessions() {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      `
      id, user_id, bike_id, rode_on, track, surface, weather,
      fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, notes,
      created_at, updated_at,
      bikes:bike_id ( id, make, model, year, is_primary )
    `
    )
    .order("rode_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getSession(id: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      `
      id, user_id, bike_id, rode_on, track, surface, weather,
      fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, notes,
      created_at, updated_at,
      bikes:bike_id ( id, make, model, year, is_primary )
    `
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function createSession(input: {
  bike_id: string;
  rode_on?: string;
  track?: string | null;
  surface?: string | null;
  weather?: any;
  fork_comp?: number | null;
  fork_reb?: number | null;
  shock_comp?: number | null;
  shock_reb?: number | null;
  sag_mm?: number | null;
  /** true ONLY when the rider measured/entered sag themselves (v2.4.0). */
  sag_measured?: boolean;
  notes?: string | null;
}) {
  const payload = {
    bike_id: input.bike_id,
    rode_on: input.rode_on ?? new Date().toISOString().slice(0, 10),
    track: input.track ?? null,
    surface: input.surface ?? null,
    weather: input.weather ?? null,
    fork_comp: input.fork_comp ?? null,
    fork_reb: input.fork_reb ?? null,
    shock_comp: input.shock_comp ?? null,
    shock_reb: input.shock_reb ?? null,
    sag_mm: input.sag_mm ?? null,
    sag_measured: input.sag_measured ?? false,
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase
    .from("sessions")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateSession(id: string, input: any) {
  const { data, error } = await supabase
    .from("sessions")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSession(id: string) {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
  return true;
}
