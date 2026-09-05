// lib/quizOnboarding.ts
// Quiz onboarding (3.0 first-run): pure logic + local persistence. No React,
// no native modules — unit-tested in __tests__/quizOnboarding.test.ts.
//
// Architecture rule (spec, 2026-09-02): the quiz is a RESKIN of the existing
// onboarding state machine (lib/onboarding.tsx). It replaces the garage
// add-bike sheet + Tune-tab input UI with one question per screen; the step
// transitions underneath (intro → garage_locked → tune → results_locked →
// signup → trial → complete) are untouched, and every answer maps onto an
// EXISTING engine input (lib/ai.ts ZeroTuneInput). No ai-tune changes.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { BIKE_BRANDS, BIKE_CATALOG } from "../constants/bike-catalog";
import type { ZeroTuneInput } from "./ai";
import { getOrCreateFunnelId, logEvent, type UsageEvent } from "./usage";

/* ------------------------------- Questions ------------------------------- */

export type QuizDiscipline = "mx" | "offroad";
export type QuizSkillId = "learning" | "comfortable" | "fast" | "pro";
export type QuizStepId = "discipline" | "bike" | "skill" | "terrain" | "weight";

/** Progress order. Five segments, always visible. */
export const QUIZ_STEPS: readonly QuizStepId[] = [
  "discipline",
  "bike",
  "skill",
  "terrain",
  "weight",
] as const;
export const QUIZ_TOTAL_STEPS = QUIZ_STEPS.length;

/** 1-based segment index for the progress bar. */
export function quizStepIndex(step: QuizStepId): number {
  return QUIZ_STEPS.indexOf(step) + 1;
}

export type QuizOption<Id extends string> = {
  id: Id;
  label: string;
  subtitle: string;
};

export const DISCIPLINE_OPTIONS: readonly QuizOption<QuizDiscipline>[] = [
  { id: "mx", label: "Motocross track", subtitle: "Jumps, braking bumps, motos" },
  {
    id: "offroad",
    label: "Off-road and trail",
    subtitle: "Singletrack, enduro, desert",
  },
] as const;

export const SKILL_OPTIONS: readonly QuizOption<QuizSkillId>[] = [
  {
    id: "learning",
    label: "Still learning it",
    subtitle: "First seasons. Building speed and confidence.",
  },
  {
    id: "comfortable",
    label: "Comfortable",
    subtitle: "Most weekends. Clearing most of the track.",
  },
  {
    id: "fast",
    label: "Fast",
    subtitle: "Race pace. Attacking braking bumps, not surviving them.",
  },
  {
    id: "pro",
    label: "Pro pace",
    subtitle: "Racing seriously. Fastest guys at the track.",
  },
] as const;

/** Drumroll line: "Balancing for {phrase}". */
export const SKILL_PHRASE: Record<QuizSkillId, string> = {
  learning: "a rider still learning it",
  comfortable: "a comfortable weekend pace",
  fast: "race pace",
  pro: "pro pace",
};

export type TerrainOption = { id: string; label: string };

/** Discipline-conditional terrain sets (Q4). The label is ALSO the engine
 *  terrain string (ZeroTuneInput.terrain) — the edge keys its MX/enduro
 *  inference off keywords like "supercross", "singletrack", "rocks",
 *  "roots", "enduro", so these labels were chosen to hit them where the
 *  terrain alone is ambiguous; rider.style carries the discipline otherwise. */
export const TERRAIN_OPTIONS: Record<QuizDiscipline, readonly TerrainOption[]> = {
  mx: [
    { id: "hardpack", label: "Hardpack" },
    { id: "loam", label: "Loam" },
    { id: "sand", label: "Sand" },
    { id: "rutted_clay", label: "Rutted clay" },
    { id: "supercross", label: "Supercross" },
    { id: "mud", label: "Mud" },
  ],
  offroad: [
    { id: "singletrack", label: "Singletrack" },
    { id: "rocks_roots", label: "Rocks and roots" },
    { id: "desert", label: "Desert" },
    { id: "dunes", label: "Dunes" },
    { id: "mud", label: "Mud" },
    { id: "hard_enduro", label: "Hard enduro" },
  ],
};

export function terrainLabel(discipline: QuizDiscipline, id: string): string {
  return TERRAIN_OPTIONS[discipline].find((t) => t.id === id)?.label ?? id;
}

/* ------------------------ Engine input mappings -------------------------- */
// Every mapping below targets an input the engine already reads. Decisions
// flagged to River in the 2026-09-02 status (see the plan's quiz section):
//   discipline → rider.style   (MX = short_motos, off-road = long_enduro)
//   skill (4)  → rider.skill (3): the engine has no "fast" level, so Fast
//                shares "intermediate" with Comfortable and the 4th level is
//                carried through rider.goals instead (below). The raw 4-level
//                answer is kept in the quiz store + event meta.
//   goals      → derived (the quiz never asks): learning/comfortable keep the
//                Tune-tab default ["stability","comfort"]; fast/pro swap
//                comfort for "jump support" (MX) or "grip" (off-road).

export function engineStyleForDiscipline(
  d: QuizDiscipline
): ZeroTuneInput["rider"]["style"] {
  return d === "mx" ? "short_motos" : "long_enduro";
}

export function engineSkillForQuizSkill(
  s: QuizSkillId
): ZeroTuneInput["rider"]["skill"] {
  switch (s) {
    case "learning":
      return "beginner";
    case "pro":
      return "pro";
    default:
      return "intermediate";
  }
}

export function engineGoalsFor(d: QuizDiscipline, s: QuizSkillId): string[] {
  if (s === "fast" || s === "pro") {
    return ["stability", d === "mx" ? "jump support" : "grip"];
  }
  return ["stability", "comfort"];
}

/* ------------------------------ Brand grid ------------------------------- */

/** The seven tiles on 2a, in grid order. Everything else sits under More. */
export const QUIZ_PRIMARY_BRANDS: readonly string[] = [
  "KTM",
  "Yamaha",
  "Honda",
  "Kawasaki",
  "Husqvarna",
  "GasGas",
  "Suzuki",
] as const;

export const QUIZ_MORE_BRANDS: readonly string[] = BIKE_BRANDS.filter(
  (b) => !QUIZ_PRIMARY_BRANDS.includes(b)
);

/** Brand accent colors — ACCENTS ONLY. Selection is always Dialed Blue.
 *  KTM #FF6600 and Husqvarna white are per spec; the rest reuse the garage's
 *  BRAND_ACCENTS values (readable on Carbon). */
export const QUIZ_BRAND_COLORS: Record<string, string> = {
  KTM: "#FF6600",
  Yamaha: "#3F7FFF",
  Honda: "#FF4D4F",
  Kawasaki: "#46C25B",
  Husqvarna: "#F5F7FC",
  GasGas: "#E53131",
  Suzuki: "#F2D13D",
  Beta: "#E62B2B",
  Sherco: "#2B61FF",
  "TM Racing": "#2B9CFF",
  Stark: "#E6342A",
};

export const QUIZ_BRAND_FALLBACK_COLOR = "#F5F7FC";

export function brandColor(make: string | null | undefined): string {
  if (!make) return QUIZ_BRAND_FALLBACK_COLOR;
  return QUIZ_BRAND_COLORS[make] ?? QUIZ_BRAND_FALLBACK_COLOR;
}

/* --------------------------- Model classification ------------------------ */
// Q1 drives the 2b ordering: the chosen discipline's bikes list first. The
// catalog carries no discipline field, so this derives it from the model
// naming conventions each make uses. Unit-tested against the whole catalog.

export type ModelDiscipline = "mx" | "offroad" | "other" | "mini";

const MINI_GENERIC = /(^|\D)(50|65|85)(\D|$)/;

export function classifyModel(make: string, model: string): ModelDiscipline {
  const m = model.trim();
  if (
    MINI_GENERIC.test(m) ||
    /^KX100$/i.test(m) ||
    /^CRF1(10|25|50)/i.test(m) ||
    /^CR8[05]R/i.test(m)
  ) {
    return "mini";
  }
  switch (make) {
    case "KTM":
      return /\bSX(-F)?\b/i.test(m) ? "mx" : "offroad";
    case "Husqvarna":
      return /^(TC|FC)\b/i.test(m) ? "mx" : "offroad";
    case "GasGas":
      return /^MC\b/i.test(m) ? "mx" : "offroad";
    case "Yamaha":
      return /^YZ\d+F?$/i.test(m) ? "mx" : "offroad";
    case "Honda":
      return /^CRF\d+R(WE)?$/i.test(m) ? "mx" : "offroad";
    case "Kawasaki":
      return /^KX\d+$/i.test(m) ? "mx" : "offroad";
    case "Suzuki":
      return /^RM-?Z/i.test(m) ? "mx" : "offroad";
    case "Beta":
    case "Sherco":
      return "offroad";
    case "TM Racing":
      if (/^MX\b/i.test(m)) return "mx";
      if (/^EN\b/i.test(m)) return "offroad";
      return "other";
    case "Stark":
      if (/\bMX\b/i.test(m)) return "mx";
      if (/\bEX\b/i.test(m)) return "offroad";
      return "other";
    default:
      return "other";
  }
}

export type ModelGroupKey = "matched" | "all";
export type ModelGroup = { key: ModelGroupKey; label: string; models: string[] };

export function matchedSectionLabel(d: QuizDiscipline | null | undefined): string {
  return d === "offroad" ? "Trail bikes first" : "Track bikes first";
}

/** 2b sections: ORDER, never filter. Every catalog model for the brand is
 *  listed. The discipline-matched ones come first under "Track/Trail bikes
 *  first"; everything else (the other discipline, minis, unclassified) sits
 *  under "All <brand> models". Catalog order is preserved inside each
 *  section, and an empty section is simply not emitted. Nothing is hidden
 *  based on discipline. */
export function groupModelsForDiscipline(
  make: string,
  discipline: QuizDiscipline | null | undefined
): ModelGroup[] {
  const models = BIKE_CATALOG[make] ?? [];
  const d: QuizDiscipline = discipline ?? "mx";
  const matched: string[] = [];
  const rest: string[] = [];
  for (const m of models) (classifyModel(make, m) === d ? matched : rest).push(m);
  const out: ModelGroup[] = [];
  if (matched.length > 0) out.push({ key: "matched", label: matchedSectionLabel(d), models: matched });
  if (rest.length > 0) out.push({ key: "all", label: `All ${make} models`, models: rest });
  return out;
}

export function orderModelsForDiscipline(
  make: string,
  discipline: QuizDiscipline | null | undefined
): string[] {
  return groupModelsForDiscipline(make, discipline).flatMap((g) => g.models);
}

/* --------------------------------- Search -------------------------------- */
// Same case/space/hyphen-insensitive key as lib/bikes.ts canonKey, so what
// the search matches is exactly what normalizeBikeStrings will canonicalize.
const canon = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "");

export type CatalogHit = { make: string; model: string };

/** Search across every brand's models (and brand names). Ranked: exact model
 *  key, then model prefix, then substring anywhere in "make model". */
export function searchCatalog(query: string, limit = 12): CatalogHit[] {
  const q = canon(query);
  if (!q) return [];
  const ranked: { hit: CatalogHit; rank: number }[] = [];
  for (const [make, models] of Object.entries(BIKE_CATALOG)) {
    const mk = canon(make);
    for (const model of models) {
      const mo = canon(model);
      let rank = -1;
      if (mo === q) rank = 0;
      else if (mo.startsWith(q)) rank = 1;
      else if ((mk + mo).includes(q) || mo.includes(q)) rank = 2;
      else if (mk.includes(q)) rank = 3;
      if (rank >= 0) ranked.push({ hit: { make, model }, rank });
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.hit);
}

/** 2b search always covers the FULL catalog: hits from every other brand,
 *  ranked like searchCatalog, with the current brand's own rows excluded
 *  (those are matched separately by filterModels so they list first). */
export function crossBrandModelHits(make: string | null, query: string, limit = 12): CatalogHit[] {
  if (!query.trim()) return [];
  return searchCatalog(query, limit + 24).filter((h) => h.make !== make).slice(0, limit);
}

export function filterModels(models: readonly string[], query: string): string[] {
  const q = canon(query);
  if (!q) return [...models];
  return models.filter((m) => canon(m).includes(q));
}

export function searchBrands(query: string): string[] {
  const q = canon(query);
  if (!q) return [...BIKE_BRANDS];
  return BIKE_BRANDS.filter((b) => canon(b).includes(q));
}

/* ------------------------------- Year chips ------------------------------ */

export const QUIZ_YEAR_CHIPS: readonly number[] = [2026, 2025, 2024] as const;
/** "Older" expands inline to these (never its own screen). */
export const QUIZ_OLDER_YEARS: readonly number[] = Array.from(
  { length: 2023 - 2000 + 1 },
  (_, i) => 2023 - i
);

/* ---------------------------------- Copy --------------------------------- */

export function disciplineEcho(d: QuizDiscipline): string {
  return d === "mx" ? "Track it is" : "Trail it is";
}

export function skillEcho(s: QuizSkillId): string {
  const label = SKILL_OPTIONS.find((o) => o.id === s)?.label ?? "Got it";
  return `${label}. Noted.`;
}

export function bikeDisplayName(a: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): string {
  return [a.year, a.make, a.model]
    .filter((p) => p !== undefined && p !== null && String(p).length > 0)
    .join(" ");
}

export function modelListSubline(d: QuizDiscipline | null | undefined): string {
  return d === "offroad"
    ? "Every model is here. Trail bikes are up top."
    : "Every model is here. Track bikes are up top.";
}

/* ------------------------------ Answers store ---------------------------- */

export type QuizFlow = "add_bike" | "new_setup";

export type QuizAnswers = {
  version: 1;
  discipline?: QuizDiscipline;
  make?: string;
  model?: string;
  year?: number;
  /** Guest-store local id (or bikes uuid when signed in) of the bike the
   *  quiz created, so re-answering Q2 replaces it instead of adding another. */
  bikeLocalId?: string;
  /** Garage flows reuse the quiz screens post-onboarding (2026-09-04):
   *  "add_bike" = picker → drumroll → reveal for a new bike's baseline;
   *  "new_setup" = terrain tiles → drumroll → reveal for a named setup on
   *  an existing bike. Absent = the first-run onboarding quiz. */
  flow?: QuizFlow;
  flowBikeId?: string;
  flowFromVersionId?: string;
  flowFromLabel?: string;
  /** True when make/model came from the catalog (vs free text). */
  catalogMatch?: boolean;
  skill?: QuizSkillId;
  terrainMain?: string;
  terrainSecondary?: string[];
  weightLbs?: number;
  weightUnit?: "lbs" | "kg";
  freeText?: string;
  /** Assumption-of-risk sheet accepted during this quiz run (guests have no
   *  per-user key; signed-in riders also get the Tune tab's key). */
  riskAcceptedAt?: string;
  lastStep?: QuizStepId;
  startedAt: string;
  updatedAt: string;
};

export const QUIZ_ANSWERS_STORAGE_KEY = "dialed_quiz_answers_v1";

export function emptyQuizAnswers(now = new Date()): QuizAnswers {
  const iso = now.toISOString();
  return { version: 1, startedAt: iso, updatedAt: iso };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const isDiscipline = (v: unknown): v is QuizDiscipline =>
  v === "mx" || v === "offroad";
const isSkill = (v: unknown): v is QuizSkillId =>
  v === "learning" || v === "comfortable" || v === "fast" || v === "pro";
const isStep = (v: unknown): v is QuizStepId =>
  (QUIZ_STEPS as readonly string[]).includes(v as string);
const optStr = (v: unknown) =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const optNum = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Tolerant parse: unknown/invalid fields drop, never throws. */
export function parseQuizAnswers(raw: string | null): QuizAnswers {
  if (!raw) return emptyQuizAnswers();
  try {
    const p = JSON.parse(raw);
    if (!isRecord(p)) return emptyQuizAnswers();
    const base = emptyQuizAnswers();
    return {
      version: 1,
      discipline: isDiscipline(p.discipline) ? p.discipline : undefined,
      make: optStr(p.make),
      model: optStr(p.model),
      year: optNum(p.year),
      bikeLocalId: optStr(p.bikeLocalId),
      flow: p.flow === "add_bike" || p.flow === "new_setup" ? p.flow : undefined,
      flowBikeId: optStr(p.flowBikeId),
      flowFromVersionId: optStr(p.flowFromVersionId),
      flowFromLabel: optStr(p.flowFromLabel),
      catalogMatch: typeof p.catalogMatch === "boolean" ? p.catalogMatch : undefined,
      skill: isSkill(p.skill) ? p.skill : undefined,
      terrainMain: optStr(p.terrainMain),
      terrainSecondary: Array.isArray(p.terrainSecondary)
        ? p.terrainSecondary.filter((t: unknown): t is string => typeof t === "string")
        : undefined,
      weightLbs: optNum(p.weightLbs),
      weightUnit: p.weightUnit === "kg" ? "kg" : p.weightUnit === "lbs" ? "lbs" : undefined,
      freeText: optStr(p.freeText),
      riskAcceptedAt: optStr(p.riskAcceptedAt),
      lastStep: isStep(p.lastStep) ? p.lastStep : undefined,
      startedAt: optStr(p.startedAt) ?? base.startedAt,
      updatedAt: optStr(p.updatedAt) ?? base.updatedAt,
    };
  } catch {
    return emptyQuizAnswers();
  }
}

export async function readQuizAnswers(): Promise<QuizAnswers> {
  try {
    return parseQuizAnswers(await AsyncStorage.getItem(QUIZ_ANSWERS_STORAGE_KEY));
  } catch {
    return emptyQuizAnswers();
  }
}

export async function writeQuizAnswers(a: QuizAnswers): Promise<void> {
  await AsyncStorage.setItem(QUIZ_ANSWERS_STORAGE_KEY, JSON.stringify(a));
}

export async function clearQuizAnswers(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUIZ_ANSWERS_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

/** End of a run (reveal CTA): keep the RIDER facts (discipline, skill,
 *  weight, risk acceptance) so Garage flows can build a baseline without
 *  re-asking; clear the bike, terrain, free text and any flow. */
export async function resetQuizForNextRun(): Promise<void> {
  try {
    const a = await readQuizAnswers();
    const now = new Date().toISOString();
    await writeQuizAnswers({
      version: 1,
      discipline: a.discipline,
      skill: a.skill,
      weightLbs: a.weightLbs,
      weightUnit: a.weightUnit,
      riskAcceptedAt: a.riskAcceptedAt,
      startedAt: now,
      updatedAt: now,
    });
  } catch {
    // best-effort
  }
}

/** Enter a Garage flow. Writes storage directly (the QuizProvider hydrates
 *  from it on mount), then the caller pushes the flow's first screen. */
export async function startGarageQuizFlow(
  flow: QuizFlow,
  p: { bikeId?: string; make?: string; model?: string; year?: number; fromVersionId?: string | null; fromLabel?: string | null }
): Promise<string> {
  const a = await readQuizAnswers();
  const now = new Date().toISOString();
  await writeQuizAnswers({
    ...a,
    flow,
    flowBikeId: p.bikeId,
    flowFromVersionId: p.fromVersionId ?? undefined,
    flowFromLabel: p.fromLabel ?? undefined,
    make: p.make,
    model: p.model,
    year: p.year,
    bikeLocalId: p.bikeId,
    catalogMatch: undefined,
    freeText: undefined,
    terrainMain: flow === "new_setup" ? undefined : a.terrainMain,
    terrainSecondary: flow === "new_setup" ? [] : a.terrainSecondary,
    lastStep: undefined,
    startedAt: now,
    updatedAt: now,
  });
  return flow === "add_bike" ? "/quiz/bike" : "/quiz/terrain";
}

/** "Dunes" for the new-setup name ("Dunes setup"), from the main terrain tile. */
export function defaultSetupTerrainLabel(a: QuizAnswers): string | null {
  if (!a.terrainMain) return null;
  return terrainLabel(a.discipline ?? "mx", a.terrainMain);
}

export type QuizRouteStep = "bike" | "skill" | "terrain" | "weight" | "building" | "reveal";

/** Where a screen goes next. Onboarding is the fixed sequence. Garage flows
 *  ask only what is missing (rider facts persist across runs), never the
 *  account gate (the rider is signed in), and land on the bike page. */
export function nextQuizRoute(from: QuizRouteStep, a: QuizAnswers): string {
  if (!a.flow) {
    switch (from) {
      case "bike": return "/quiz/skill";
      case "skill": return "/quiz/terrain";
      case "terrain": return "/quiz/weight";
      case "weight": return "/quiz/building";
      case "building": return "/quiz/gate";
      case "reveal": return "/(tabs)";
    }
  }
  const order: QuizRouteStep[] = a.flow === "add_bike" ? ["bike", "skill", "terrain", "weight"] : ["terrain", "skill", "weight"];
  const needed = (step: QuizRouteStep) =>
    step === "skill" ? !a.skill : step === "terrain" ? !a.terrainMain : step === "weight" ? typeof a.weightLbs !== "number" : false;
  if (from === "building") return "/quiz/reveal";
  if (from === "reveal") {
    const id = a.flowBikeId ?? a.bikeLocalId;
    return id ? `/garage-bike?bikeId=${encodeURIComponent(id)}` : "/(tabs)/garage";
  }
  const idx = order.indexOf(from);
  for (const step of order.slice(idx + 1)) if (needed(step)) return `/quiz/${step}`;
  return "/quiz/building";
}

/* --------------------------- Engine input builder ------------------------ */

/* --------------------------------- Weight -------------------------------- */

export const WEIGHT_MIN_LBS = 80;
export const WEIGHT_MAX_LBS = 350;
export const WEIGHT_DEFAULT_LBS = 175;
export const WEIGHT_STEP_LBS = 5;
export const WEIGHT_STEP_KG = 2;
const KG_PER_LB = 0.45359237;

export function lbsToKg(lbs: number): number {
  return Math.round(lbs * KG_PER_LB);
}
export function kgToLbs(kg: number): number {
  return Math.round(kg / KG_PER_LB);
}
export function clampWeightLbs(lbs: number): number {
  const stepped = Math.round(lbs / WEIGHT_STEP_LBS) * WEIGHT_STEP_LBS;
  return Math.min(WEIGHT_MAX_LBS, Math.max(WEIGHT_MIN_LBS, stepped));
}

/** Dial ticks for a unit: every tick is a haptic step. */
export function weightTicks(unit: "lbs" | "kg"): number[] {
  if (unit === "lbs") {
    const out: number[] = [];
    for (let v = WEIGHT_MIN_LBS; v <= WEIGHT_MAX_LBS; v += WEIGHT_STEP_LBS) out.push(v);
    return out;
  }
  const min = Math.ceil(lbsToKg(WEIGHT_MIN_LBS) / WEIGHT_STEP_KG) * WEIGHT_STEP_KG;
  const max = Math.floor(lbsToKg(WEIGHT_MAX_LBS) / WEIGHT_STEP_KG) * WEIGHT_STEP_KG;
  const out: number[] = [];
  for (let v = min; v <= max; v += WEIGHT_STEP_KG) out.push(v);
  return out;
}

/* ----------------------------- Tune rows (UI) ---------------------------- */
// One label vocabulary for the locked card (gate), the values card (reveal)
// and the drumroll. Same circuit order as ZeroTuneResult / setup_versions.

export type TuneRowKey =
  | "fork_comp"
  | "fork_reb"
  | "fork_air"
  | "shock_lsc"
  | "shock_hsc"
  | "shock_reb"
  | "shock_sag";

export type TuneRow = { key: TuneRowKey; label: string; unit: string };

export const TUNE_ROWS: readonly TuneRow[] = [
  { key: "fork_comp", label: "Fork compression", unit: "clicks" },
  { key: "fork_reb", label: "Fork rebound", unit: "clicks" },
  { key: "shock_lsc", label: "Shock low-speed comp", unit: "clicks" },
  { key: "shock_hsc", label: "Shock high-speed comp", unit: "turns" },
  { key: "shock_reb", label: "Shock rebound", unit: "clicks" },
  { key: "shock_sag", label: "Race sag", unit: "mm" },
] as const;

export const FORK_AIR_ROW: TuneRow = { key: "fork_air", label: "Fork air", unit: "bar" };

/** Minimal shape of the engine result the cards need (ZeroTuneResult). */
export type TuneLike = {
  fork: { comp_clicks: number; reb_clicks: number; air_pressure_bar?: number };
  shock: { lsc_clicks: number; hsc_turns: number; reb_clicks: number; sag_mm: number };
};

export function tuneRowValue(tune: TuneLike, key: TuneRowKey): number | null {
  switch (key) {
    case "fork_comp":
      return tune.fork.comp_clicks;
    case "fork_reb":
      return tune.fork.reb_clicks;
    case "fork_air":
      return typeof tune.fork.air_pressure_bar === "number" ? tune.fork.air_pressure_bar : null;
    case "shock_lsc":
      return tune.shock.lsc_clicks;
    case "shock_hsc":
      return tune.shock.hsc_turns;
    case "shock_reb":
      return tune.shock.reb_clicks;
    case "shock_sag":
      return tune.shock.sag_mm;
  }
}

/** Rows to render for a tune: the six core rows, plus fork air after fork
 *  rebound when the tune carries an air reading (air-fork bikes). */
export function tuneRowsFor(tune: TuneLike | null): TuneRow[] {
  const rows = [...TUNE_ROWS];
  if (tune && typeof tune.fork.air_pressure_bar === "number") {
    rows.splice(2, 0, FORK_AIR_ROW);
  }
  return rows;
}

export function formatTuneValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "bar") return value.toFixed(1);
  if (unit === "turns") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return String(Math.round(value));
}

/* --------------------------------- Drumroll ------------------------------ */
// Six staged circuits; each "solves" onto the REAL value from the engine
// result. Timing: the clicker cycles until the result arrives, then snaps
// circuit by circuit. Every checklist line derives from real data or falls
// back to honest generic copy — never a fake detail.

export const DRUMROLL_CIRCUITS: readonly { key: TuneRowKey; title: string; cycleMax: number }[] = [
  { key: "fork_comp", title: "FORK COMPRESSION", cycleMax: 30 },
  { key: "fork_reb", title: "FORK REBOUND", cycleMax: 30 },
  { key: "shock_lsc", title: "SHOCK LOW-SPEED", cycleMax: 30 },
  { key: "shock_hsc", title: "SHOCK HIGH-SPEED", cycleMax: 4 },
  { key: "shock_reb", title: "SHOCK REBOUND", cycleMax: 30 },
  { key: "shock_sag", title: "RACE SAG", cycleMax: 120 },
] as const;

/** Milliseconds per circuit once the result is in (6 × 500 ≈ 3 s). */
export const DRUMROLL_STAGE_MS = 500;

export type DrumrollFacts = {
  forkType?: string | null;
  shockType?: string | null;
  weightLbs?: number | null;
  terrainLabel?: string | null;
  skill?: QuizSkillId | null;
};

export function drumrollChecklist(f: DrumrollFacts): string[] {
  const fork = f.forkType?.trim();
  const shock = f.shockType?.trim();
  const specLine =
    fork && shock
      ? `Read your ${fork} fork and ${shock} shock specs`
      : fork
        ? `Read your ${fork} fork and shock specs`
        : "Read your fork and shock baseline specs";
  const weightLine =
    typeof f.weightLbs === "number" && Number.isFinite(f.weightLbs)
      ? `Set spring rates for ${Math.round(f.weightLbs)} lbs geared up`
      : "Set spring rates for your geared-up weight";
  const terrainLine = f.terrainLabel
    ? `Dialing clickers for ${f.terrainLabel.toLowerCase()}...`
    : "Dialing clickers for your terrain...";
  const skillLine = f.skill
    ? `Balancing for ${SKILL_PHRASE[f.skill]}`
    : "Balancing for your pace";
  return [
    specLine,
    weightLine,
    "Cross-checked thousands of real rider tunes",
    terrainLine,
    skillLine,
    "Setting your race sag target",
  ];
}

/* ---------------------------------- Meter -------------------------------- */
// The dialed meter's first appearance (reveal): endowed at 20% WITH the
// reason stated. Locked rows are the Pro categories (action-gated paywall
// world: refine / history are Pro). Categories only appear when their
// feature exists — no zero bars for unshipped features.

export const METER_ENDOWED_PCT = 20;
export const METER_REASON = "Baseline done. Ride it, then refine from real laps.";

export type MeterCategory = {
  key: string;
  label: string;
  state: "done" | "open" | "locked_pro";
  /** Contribution when complete (sums to 100 with the endowment). */
  pct: number;
};

export const METER_CATEGORIES: readonly MeterCategory[] = [
  { key: "baseline", label: "Baseline tune", state: "done", pct: METER_ENDOWED_PCT },
  { key: "sag_measured", label: "Sag measured", state: "open", pct: 15 },
  { key: "first_ride", label: "First ride logged", state: "open", pct: 15 },
  { key: "first_refinement", label: "First refinement", state: "locked_pro", pct: 25 },
  { key: "setup_history", label: "Setup history", state: "locked_pro", pct: 25 },
] as const;

export function meterPct(categories: readonly MeterCategory[] = METER_CATEGORIES): number {
  return categories.filter((c) => c.state === "done").reduce((n, c) => n + c.pct, 0);
}

/** Answers → the SAME ZeroTuneInput the Tune tab builds. null until every
 *  required answer is in. temp_f / elev_ft are deliberately absent (the quiz
 *  never asks; both are optional inputs). wants_air_fork is a placeholder the
 *  generation step overrides with the verified spec exactly like tune.tsx;
 *  unmatched bikes fall through to the edge's own name heuristic. */
export function buildQuizTuneInput(a: QuizAnswers): ZeroTuneInput | null {
  if (!a.discipline || !a.skill || !a.terrainMain || !a.weightLbs) return null;
  const issues = a.freeText?.trim();
  return {
    make: a.make,
    model: a.model,
    year: a.year,
    terrain: terrainLabel(a.discipline, a.terrainMain),
    rider: {
      weight_lbs: a.weightLbs,
      skill: engineSkillForQuizSkill(a.skill),
      style: engineStyleForDiscipline(a.discipline),
      goals: engineGoalsFor(a.discipline, a.skill),
      issues: issues && issues.length > 0 ? issues : undefined,
    },
    has_zeroed_clickers: true,
    wants_air_fork: false,
  };
}

/* -------------------------------- Analytics ------------------------------ */
// ⚠️ ANALYTICS-DARK until 20260902100000_usage_events_quiz_event_types.sql
// is pushed: every quiz event queues pre-auth (the rider is a guest), and one
// unwhitelisted queued type rejects the ENTIRE pre-auth flush batch at signup
// (lib/usage.ts queue-poison rule). No store build with the flag ON may ship
// before that migration lands.

export type QuizUsageEvent = Extract<
  UsageEvent,
  | "quiz_step_viewed"
  | "quiz_step_answered"
  | "quiz_abandoned"
  | "quiz_gate_viewed"
  | "quiz_signin_method_chosen"
  | "quiz_reveal_viewed"
  | "quiz_freetext_expanded"
  | "quiz_freetext_filled"
>;

export async function logQuizEvent(
  type: QuizUsageEvent,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const funnelId = await getOrCreateFunnelId();
    await logEvent(
      type,
      { funnel_id: funnelId, ...meta },
      { allowAnonymous: true, queueIfAnonymous: true }
    );
  } catch {
    // analytics never block the flow
  }
}
