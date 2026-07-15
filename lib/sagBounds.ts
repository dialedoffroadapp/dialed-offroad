// lib/sagBounds.ts
// Single source of truth for rear-sag bounds. These historically lived in five
// places with mismatched windows — the client's final 90-120 clamp being the
// widest, which silently clobbered per-model values. Everything now resolves
// through here so the target + bounds that go out in guardrails are the same
// ones the final clamp enforces.

export type SagBounds = { target: number; min: number; max: number };

// Consolidated defaults for bikes with no verified per-model spec.
export const DEFAULT_SAG: SagBounds = { target: 105, min: 95, max: 112 };

// Loose shape of a bike_models row's sag fields (reference data; nullable).
export type ModelSagSpec =
  | { stock_sag_mm?: number | null; sag_min?: number | null; sag_max?: number | null }
  | null
  | undefined;

/**
 * Per-model sag bounds when a row supplies all three fields, else DEFAULT_SAG.
 * (Callers gate on spec_verified before passing a model in.)
 */
export function resolveSagBounds(model?: ModelSagSpec): SagBounds {
  if (
    model &&
    typeof model.stock_sag_mm === "number" &&
    typeof model.sag_min === "number" &&
    typeof model.sag_max === "number"
  ) {
    return { target: model.stock_sag_mm, min: model.sag_min, max: model.sag_max };
  }
  return DEFAULT_SAG;
}
