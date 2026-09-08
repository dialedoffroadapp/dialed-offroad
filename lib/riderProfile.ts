// Rider profiles (device pass finding 4, 2026-09-08). A profile is a PERSON,
// not an account: weight, unit, skill, class, default discipline. The
// active one (profiles.active_rider_profile_id) pre-fills the quiz on every
// bike after the first, the Profile screen edits it, and tune payloads carry
// rider.profile_id. Reads fail open to the device cache (a project without
// migration 20260908100000 answers 42P01); writes throw (audit rule a).
// See docs/rider-profiles.md.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { engineClassForQuizSkill, SKILL_OPTIONS, type QuizAnswers, type QuizSkillId } from "./quizOnboarding";

export type RiderClass = "novice" | "c" | "b" | "a";
export type RiderProfile = {
  id: string;
  user_id: string;
  name: string;
  weight_lbs: number | null;
  unit: "lbs" | "kg";
  skill: QuizSkillId | null;
  class: RiderClass | null;
  discipline_default: "mx" | "offroad" | null;
  updated_at?: string | null;
};
export type RiderProfilePatch = Partial<Pick<RiderProfile, "name" | "weight_lbs" | "unit" | "skill" | "class" | "discipline_default">>;

const COLS = "id, user_id, name, weight_lbs, unit, skill, class, discipline_default, updated_at";
const CACHE_PREFIX = "rider_profile_active_v1:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CLASS_LABEL: Record<RiderClass, string> = { novice: "Novice", c: "C class", b: "B class", a: "A class" };
export const CLASS_OPTIONS: readonly RiderClass[] = ["novice", "c", "b", "a"];

function normalize(row: any): RiderProfile {
  const w = typeof row.weight_lbs === "number" ? row.weight_lbs : typeof row.weight_lbs === "string" ? Number(row.weight_lbs) : null;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: typeof row.name === "string" && row.name.trim() ? row.name : "Me",
    weight_lbs: typeof w === "number" && Number.isFinite(w) ? w : null,
    unit: row.unit === "kg" ? "kg" : "lbs",
    skill: SKILL_OPTIONS.some((o) => o.id === row.skill) ? (row.skill as QuizSkillId) : null,
    class: (CLASS_OPTIONS as readonly string[]).includes(row.class) ? (row.class as RiderClass) : null,
    discipline_default: row.discipline_default === "mx" || row.discipline_default === "offroad" ? row.discipline_default : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

async function sessionUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function readCache(uid: string): Promise<RiderProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof parsed.id === "string" ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

async function writeCache(uid: string, p: RiderProfile | null): Promise<void> {
  try {
    if (p) await AsyncStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(p));
    else await AsyncStorage.removeItem(CACHE_PREFIX + uid);
  } catch {
    // cache only
  }
}

/** The signed-in rider's active profile: profiles.active_rider_profile_id,
 *  else their oldest row. null for guests and riders with no row yet.
 *  Fails open to the device cache. */
export async function fetchActiveRiderProfile(): Promise<RiderProfile | null> {
  const uid = await sessionUserId();
  if (!uid) return null;
  try {
    const { data: prof, error: pe } = await supabase.from("profiles").select("active_rider_profile_id").eq("user_id", uid).maybeSingle();
    if (pe) throw pe;
    let row: any = null;
    const activeId = (prof as any)?.active_rider_profile_id;
    if (typeof activeId === "string" && UUID_RE.test(activeId)) {
      const { data, error } = await supabase.from("rider_profiles").select(COLS).eq("id", activeId).maybeSingle();
      if (error) throw error;
      row = data;
    }
    if (!row) {
      const { data, error } = await supabase.from("rider_profiles").select(COLS).eq("user_id", uid).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (error) throw error;
      row = data;
    }
    const p = row ? normalize(row) : null;
    await writeCache(uid, p);
    return p;
  } catch {
    return readCache(uid);
  }
}

/** The active profile's id for tune payloads (rider.profile_id): the device
 *  cache first, the server when the cache is empty. undefined for guests. */
export async function activeRiderProfileId(): Promise<string | undefined> {
  const uid = await sessionUserId();
  if (!uid) return undefined;
  const cached = await readCache(uid);
  if (cached) return cached.id;
  const fresh = await fetchActiveRiderProfile();
  return fresh?.id;
}

/** Update the active profile, or create it (and make it active) when the
 *  rider has none. null for guests (nothing to write); THROWS on a failed
 *  write so the caller can surface it. */
export async function saveRiderProfile(patch: RiderProfilePatch): Promise<RiderProfile | null> {
  const uid = await sessionUserId();
  if (!uid) return null;
  const clean: RiderProfilePatch = {};
  if (typeof patch.weight_lbs === "number" && Number.isFinite(patch.weight_lbs)) clean.weight_lbs = Math.round(patch.weight_lbs * 10) / 10;
  if (patch.weight_lbs === null) clean.weight_lbs = null;
  if (patch.unit === "lbs" || patch.unit === "kg") clean.unit = patch.unit;
  if (patch.skill === null || SKILL_OPTIONS.some((o) => o.id === patch.skill)) clean.skill = patch.skill;
  if (patch.class === null || (CLASS_OPTIONS as readonly string[]).includes(patch.class as string)) clean.class = patch.class;
  if (patch.discipline_default === null || patch.discipline_default === "mx" || patch.discipline_default === "offroad") clean.discipline_default = patch.discipline_default;
  if (typeof patch.name === "string" && patch.name.trim()) clean.name = patch.name.trim();

  const current = await fetchActiveRiderProfile();
  let row: any;
  if (current) {
    const { data, error } = await supabase.from("rider_profiles").update(clean).eq("id", current.id).select(COLS).single();
    if (error) throw error;
    row = data;
  } else {
    const { data, error } = await supabase.from("rider_profiles").insert({ user_id: uid, name: "Me", ...clean }).select(COLS).single();
    if (error) throw error;
    row = data;
    const { error: ae } = await supabase.from("profiles").update({ active_rider_profile_id: row.id }).eq("user_id", uid);
    if (ae) throw ae;
  }
  const p = normalize(row);
  await writeCache(uid, p);
  return p;
}

/** The quiz's rider facts as a profile patch (class derives from the skill). */
export function profilePatchFromQuiz(a: Pick<QuizAnswers, "weightLbs" | "weightUnit" | "skill" | "discipline">): RiderProfilePatch {
  const patch: RiderProfilePatch = {};
  if (typeof a.weightLbs === "number" && Number.isFinite(a.weightLbs)) patch.weight_lbs = a.weightLbs;
  if (a.weightUnit === "lbs" || a.weightUnit === "kg") patch.unit = a.weightUnit;
  if (a.skill) {
    patch.skill = a.skill;
    patch.class = engineClassForQuizSkill(a.skill);
  }
  if (a.discipline === "mx" || a.discipline === "offroad") patch.discipline_default = a.discipline;
  return patch;
}

export function weightLabel(p: Pick<RiderProfile, "weight_lbs" | "unit">): string | null {
  if (typeof p.weight_lbs !== "number") return null;
  return p.unit === "kg" ? `${Math.round(p.weight_lbs / 2.2046)} kg` : `${Math.round(p.weight_lbs)} lb`;
}

export function classOf(p: Pick<RiderProfile, "skill" | "class">): RiderClass | null {
  return p.class ?? (p.skill ? engineClassForQuizSkill(p.skill) : null);
}

/** A profile the quiz can collapse to a confirmation: weight and skill known. */
export function canConfirmProfile(p: RiderProfile | null | undefined): p is RiderProfile {
  return Boolean(p && typeof p.weight_lbs === "number" && p.skill);
}

/** "Still 160 lb, C class?" (the quiz's collapsed skill + weight step). */
export function confirmLine(p: RiderProfile): string {
  const w = weightLabel(p);
  const c = classOf(p);
  if (w && c) return `Still ${w}, ${CLASS_LABEL[c]}?`;
  if (w) return `Still ${w}?`;
  return c ? `Still ${CLASS_LABEL[c]}?` : "Same rider as last time?";
}

/** The quiz answers a confirmed profile supplies. */
export function answersFromProfile(p: RiderProfile): Pick<QuizAnswers, "weightLbs" | "weightUnit" | "skill"> {
  return {
    ...(typeof p.weight_lbs === "number" ? { weightLbs: p.weight_lbs, weightUnit: p.unit } : {}),
    ...(p.skill ? { skill: p.skill } : {}),
  };
}
