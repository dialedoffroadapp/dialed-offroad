// lib/rideSymptoms.ts
// Log-moto vocabulary (design/mockups/ride/08; plan 4.3 taxonomy, contract v3
// 2026-09-05): 8 first-screen chips + 6 under "More symptoms", with a
// MANDATORY qualifier on the three ambiguous chips (harsh, rear kicks, packs).
// Ids are the engine's v3 ids; qualifiers are sent as the engine's `where`
// TAGS (never labels: the edge drops what it does not know). This maps
// NOTHING to adjusters; the change set comes from the engine
// (app/ride/adjust.tsx). Discipline-localized labels are a follow-up.
import type { Tune2LegacySymptomId, Tune2SymptomId, Tune2WhereTag } from "./ai";

export type SymptomQualifier = { tag: Tune2WhereTag; label: string };
export type SymptomChip = { id: Tune2SymptomId; label: string; qualifierPrompt?: string; qualifiers?: SymptomQualifier[] };

export const PRIMARY_SYMPTOMS: SymptomChip[] = [
  {
    id: "harsh_small_bumps",
    label: "Harsh (small bumps)",
    qualifierPrompt: "Where was it harsh?",
    qualifiers: [
      { tag: "small_chop", label: "Small chop" },
      { tag: "under_braking", label: "Under braking" },
      { tag: "big_hits", label: "Big hits" },
    ],
  },
  { id: "bottoming", label: "Bottoming" },
  {
    id: "rear_kicks",
    label: "Rear kicks",
    qualifierPrompt: "Where did it kick?",
    qualifiers: [
      { tag: "jump_face", label: "Jump face" },
      { tag: "braking_bumps", label: "Braking bumps" },
      { tag: "logs_ledges", label: "Logs and ledges" },
    ],
  },
  { id: "front_pushes", label: "Front pushes" },
  {
    id: "packs_in_chop",
    label: "Packs in chop",
    qualifierPrompt: "Where does it pack?",
    qualifiers: [
      { tag: "whoops", label: "Whoops" },
      { tag: "rocks", label: "Rocks" },
    ],
  },
  { id: "wallows_dives", label: "Wallows / dives" },
  { id: "headshake", label: "Headshake" },
  { id: "rear_swaps", label: "Rear swaps" },
];

export const MORE_SYMPTOMS: SymptomChip[] = [
  { id: "deflects", label: "Deflects" },
  { id: "rear_squats", label: "Rear squats" },
  { id: "too_stiff", label: "Too stiff" },
  { id: "too_soft", label: "Too soft" },
  { id: "arm_pump", label: "Arm pump" },
  { id: "chatters", label: "Chatters" },
];

export const ALL_SYMPTOMS: SymptomChip[] = [...PRIMARY_SYMPTOMS, ...MORE_SYMPTOMS];

export function symptomById(id: string): SymptomChip | undefined {
  return ALL_SYMPTOMS.find((s) => s.id === id);
}

const QUALIFIER_LABELS: Record<Tune2WhereTag, string> = {
  braking: "Braking",
  corners: "Corners",
  whoops: "Whoops",
  landings: "Landings",
  small_chop: "Small chop",
  under_braking: "Under braking",
  big_hits: "Big hits",
  jump_face: "Jump face",
  braking_bumps: "Braking bumps",
  logs_ledges: "Logs and ledges",
  rocks: "Rocks",
};

/** Display label for a stored qualifier tag (legacy rows carry labels already). */
export function qualifierLabel(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return (QUALIFIER_LABELS as Record<string, string>)[tag] ?? tag;
}

/** Legacy engine id → how it reads today (display of historical
 *  ride_feedback rows and analytics). Three legacy ids have no clean v3
 *  equivalent and keep their own row on the engine. Mirrors LEGACY_TO_V3 in
 *  supabase/functions/ai-tune/index.ts. */
export const LEGACY_TO_V3: Record<Tune2LegacySymptomId, { id: Tune2SymptomId; where?: Tune2WhereTag }> = {
  harsh_braking_bumps: { id: "harsh_small_bumps", where: "under_braking" },
  deflects_in_chop: { id: "deflects" },
  rear_kicks_accel: { id: "rear_kicks" },
  bottoms_landings: { id: "bottoming" },
  front_knifes: { id: "front_pushes" },
  dead_feel: { id: "dead_feel" },
  unstable_whoops: { id: "unstable_whoops" },
  packs_whoops: { id: "packs_in_chop", where: "whoops" },
  harsh_square_edge: { id: "harsh_square_edge" },
  headshake: { id: "headshake" },
  general_harsh: { id: "too_stiff" },
};

const LEGACY_ONLY_LABELS: Record<string, string> = {
  dead_feel: "Dead / no pop",
  unstable_whoops: "Unstable",
  harsh_square_edge: "Harsh on edges",
};

/** Chip label for any symptom id, legacy rows included. */
export function symptomLabel(id: string): string {
  const chip = symptomById(id);
  if (chip) return chip.label;
  const mapped = (LEGACY_TO_V3 as Record<string, { id: string }>)[id]?.id;
  const viaMap = mapped ? symptomById(mapped) : undefined;
  return viaMap?.label ?? LEGACY_ONLY_LABELS[id] ?? id;
}

/* ---- The full taxonomy on the refine screen (device pass finding 7, 2026-09-08) ---- */

export type SymptomEnd = "front" | "rear" | "both";
export type SymptomGroup = { end: SymptomEnd; title: string; chips: SymptomChip[] };
export type RideDiscipline = "mx" | "offroad";

/** Every chip id once, with the end it lives on and a label per discipline.
 *  UI vocabulary over the contract's v3 ids; legacy ids read through
 *  LEGACY_TO_V3. */
const TAXONOMY: Record<string, { end: SymptomEnd; mx: string; offroad: string }> = {
  front_pushes: { end: "front", mx: "Front pushes", offroad: "Front washes out" },
  deflects: { end: "front", mx: "Deflects in chop", offroad: "Deflects off rocks" },
  wallows_dives: { end: "front", mx: "Wallows / dives", offroad: "Dives on the brakes" },
  chatters: { end: "front", mx: "Chatters", offroad: "Chatters on hardpack" },
  arm_pump: { end: "front", mx: "Arm pump", offroad: "Arm pump" },
  headshake: { end: "front", mx: "Headshake", offroad: "Headshake" },
  rear_kicks: { end: "rear", mx: "Rear kicks", offroad: "Rear kicks" },
  packs_in_chop: { end: "rear", mx: "Packs in chop", offroad: "Packs in rocks" },
  rear_swaps: { end: "rear", mx: "Rear swaps", offroad: "Rear steps out" },
  rear_squats: { end: "rear", mx: "Rear squats on the gas", offroad: "Rear squats on the gas" },
  harsh_small_bumps: { end: "both", mx: "Harsh on small bumps", offroad: "Harsh on roots and rocks" },
  bottoming: { end: "both", mx: "Bottoms on landings", offroad: "Bottoms on drops" },
  too_stiff: { end: "both", mx: "Too stiff all over", offroad: "Too stiff all over" },
  too_soft: { end: "both", mx: "Too soft all over", offroad: "Too soft all over" },
  dead_feel: { end: "both", mx: "Dead / no pop", offroad: "Dead / no pop" },
  unstable_whoops: { end: "both", mx: "Unstable in whoops", offroad: "Unstable at speed" },
  harsh_square_edge: { end: "both", mx: "Harsh on square edges", offroad: "Harsh on roots and rocks" },
};

const GROUP_TITLE: Record<SymptomEnd, string> = { front: "Front", rear: "Rear", both: "Both ends" };

export function symptomLabelFor(id: string, discipline: RideDiscipline | null | undefined): string {
  const t = TAXONOMY[id] ?? TAXONOMY[(LEGACY_TO_V3 as Record<string, { id: string }>)[id]?.id ?? ""];
  if (!t) return symptomLabel(id);
  return discipline === "offroad" ? t.offroad : t.mx;
}

/** Front, Rear, Both ends: every chip (ALL_SYMPTOMS) once, with its
 *  discipline label and the existing qualifier prompt where the id asks. */
export function symptomGroupsFor(discipline: RideDiscipline | null | undefined): SymptomGroup[] {
  const ends: SymptomEnd[] = ["front", "rear", "both"];
  return ends.map((end) => ({
    end,
    title: GROUP_TITLE[end],
    chips: ALL_SYMPTOMS.filter((c) => (TAXONOMY[c.id]?.end ?? "both") === end).map((c) => ({ ...c, label: symptomLabelFor(c.id, discipline) })),
  }));
}

/** Tap once = mild, twice = bad, a third tap clears. */
export function cycleLevel(current: SymptomLevel | null | undefined): SymptomLevel | null {
  return !current ? "mild" : current === "mild" ? "bad" : null;
}

/** A logged chip: the qualifier is the engine's where TAG. */
export type LoggedSymptom = { id: Tune2SymptomId; level: SymptomLevel; qualifier: string | null };

/** Save enables on Better / Same / Worse plus any chip or any text. A quick
 *  refine needs one of the two (there is nothing to refine otherwise); a
 *  ride-day moto is a record and saves on the sentiment alone. A picked chip
 *  that asks where still needs its answer. */
export function canSaveLog(p: { sentiment: "better" | "same" | "worse" | null; symptoms: LoggedSymptom[]; text: string; quick: boolean }): boolean {
  if (!p.sentiment) return false;
  for (const sym of p.symptoms) {
    const chip = symptomById(sym.id);
    if (chip?.qualifiers?.length && !sym.qualifier) return false;
  }
  if (!p.quick) return true;
  return p.symptoms.length > 0 || p.text.trim().length > 0;
}

/** Chip tap level (ported from the legacy debrief's 1-5 picker): one tap =
 *  mild, a second tap = bad, a third clears the chip. */
export type SymptomLevel = "mild" | "bad";

/** Engine severity (1-10): the chip's tap level when the rider set one
 *  (mild = 4, bad = 8: the debrief's 2 and 4 on its 1-5 scale, doubled
 *  once), else derived from the moto's sentiment. */
export function severityFor(sentiment: "better" | "same" | "worse", level?: SymptomLevel | null): number {
  if (level === "bad") return 8;
  if (level === "mild") return 4;
  return sentiment === "worse" ? 8 : sentiment === "same" ? 6 : 4;
}

/** Engine overall_rating (1-10) from the moto's sentiment. */
export function ratingFor(sentiment: "better" | "same" | "worse"): number {
  return sentiment === "better" ? 8 : sentiment === "same" ? 5 : 3;
}
