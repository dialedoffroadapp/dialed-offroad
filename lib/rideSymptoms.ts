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
