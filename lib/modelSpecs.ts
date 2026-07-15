// lib/modelSpecs.ts
// Per-model spec lookup (sag bounds + spring rates + weight range) and the
// deterministic spring-rate legitimacy check. Client-resolved so the edge stays
// stateless. Everything here is fail-open: null/undefined = fall back to defaults
// and render nothing — a missing/ambiguous spec must never block tune generation.

import { resolveModelId } from "./bikes";
import { supabase } from "./supabase";
import { isUuid } from "./uuid";

export type ModelSpecs = {
  id: string;
  make: string;
  model: string;
  stock_sag_mm: number | null;
  sag_min: number | null;
  sag_max: number | null;
  stock_fork_spring_nmm: number | null;
  stock_shock_spring_nmm: number | null;
  rider_weight_min_lbs: number | null;
  rider_weight_max_lbs: number | null;
  fork_type: string | null;
  has_air_fork: boolean | null;
  spec_verified: boolean | null;
};

const SPEC_COLS =
  "id, make, model, stock_sag_mm, sag_min, sag_max, stock_fork_spring_nmm, " +
  "stock_shock_spring_nmm, rider_weight_min_lbs, rider_weight_max_lbs, " +
  "fork_type, has_air_fork, spec_verified";

// Per-bike, per-session cache (bikes barely change mid-session; keyed by uuid or
// the make|model|year identity for guest-local bikes).
const cache = new Map<string, ModelSpecs | null>();

export type SpecBike = {
  id?: string | null;
  model_id?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
};

const cacheKey = (b: SpecBike) =>
  (b.id && isUuid(b.id) ? b.id : null) ?? `${b.make ?? ""}|${b.model ?? ""}|${b.year ?? ""}`;

/**
 * The verified bike_models spec for a bike, or null. Uses bike.model_id when set,
 * else resolveModelId(make/model/year) — self-healing the bike row's model_id
 * when it resolves (only for a persisted uuid bike; guest-local ids aren't in
 * the DB). Gated on spec_verified. Cached per bike per session. Fail-open.
 */
export async function fetchModelSpecs(bike: SpecBike): Promise<ModelSpecs | null> {
  const key = cacheKey(bike);
  if (cache.has(key)) return cache.get(key) ?? null;

  let specs: ModelSpecs | null = null;
  try {
    let modelId = bike.model_id ?? null;
    if (!modelId && bike.make && bike.model) {
      modelId = await resolveModelId(bike.make, bike.model, bike.year ?? undefined);
      if (modelId && bike.id && isUuid(bike.id)) {
        // Self-heal pre-backfill bikes (best-effort; never awaited into the flow).
        void supabase.from("bikes").update({ model_id: modelId }).eq("id", bike.id);
      }
    }
    if (modelId) {
      const { data } = await supabase
        .from("bike_models")
        .select(SPEC_COLS)
        .eq("id", modelId)
        .maybeSingle();
      const row = (data as unknown as ModelSpecs) ?? null;
      // GATE: only trust verified rows (future-proofs unverified batch additions).
      specs = row && row.spec_verified === true ? row : null;
    }
  } catch {
    specs = null;
  }

  cache.set(key, specs);
  return specs;
}

/* ------------------------------ Spring check ------------------------------ */

export type SpringCheckStatus = "ok" | "marginal" | "out_of_range" | "unknown";

export type SpringCheck = {
  status: SpringCheckStatus;
  component: "fork" | "shock" | "both";
  direction?: "stiffer" | "softer";
  stock_fork_nmm?: number;
  stock_shock_nmm?: number;
  rider_weight_lbs: number;
  weight_range: [number, number];
};

const MARGINAL_LBS = 10;

/**
 * Deterministic spring-rate legitimacy check (NO exact-rate recommendation in v1
 * — flagging a mismatch is far lower liability than speccing a rate). Returns a
 * full check for ok/marginal/out_of_range; undefined when nothing can be said
 * (no specs, no rider weight, or no comparable spring — air fork w/ no shock, or
 * an SFF fork whose spring rate isn't comparable and no shock data). The caller
 * records status ?? "unknown" for the training context and renders nothing here.
 */
export function computeSpringCheck(
  specs: ModelSpecs | null | undefined,
  riderWeightLbs: number | null | undefined
): SpringCheck | undefined {
  if (
    !specs ||
    typeof riderWeightLbs !== "number" ||
    !Number.isFinite(riderWeightLbs) ||
    typeof specs.rider_weight_min_lbs !== "number" ||
    typeof specs.rider_weight_max_lbs !== "number"
  ) {
    return undefined;
  }

  // SFF forks: single-spring separate-function — fork rate isn't comparable, so
  // check the shock only on those.
  const isSFF = typeof specs.fork_type === "string" && /sff/i.test(specs.fork_type);
  const hasShock = typeof specs.stock_shock_spring_nmm === "number";
  const hasFork =
    typeof specs.stock_fork_spring_nmm === "number" && !isSFF && !specs.has_air_fork;

  if (!hasShock && !hasFork) return undefined; // air fork w/ no shock data, etc.

  const component: SpringCheck["component"] =
    hasShock && hasFork ? "both" : hasShock ? "shock" : "fork";

  const min = specs.rider_weight_min_lbs;
  const max = specs.rider_weight_max_lbs;
  const w = riderWeightLbs;

  let status: SpringCheckStatus;
  let direction: "stiffer" | "softer" | undefined;
  if (w >= min && w <= max) {
    status = "ok";
  } else {
    const outBy = w > max ? w - max : min - w;
    status = outBy <= MARGINAL_LBS ? "marginal" : "out_of_range";
    direction = w > max ? "stiffer" : "softer"; // heavier rider → stiffer spring
  }

  return {
    status,
    component,
    direction,
    stock_fork_nmm: hasFork ? (specs.stock_fork_spring_nmm as number) : undefined,
    stock_shock_nmm: hasShock ? (specs.stock_shock_spring_nmm as number) : undefined,
    rider_weight_lbs: w,
    weight_range: [min, max],
  };
}
