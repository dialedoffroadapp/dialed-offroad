// lib/sagBounds.ts
// Single source of truth for rear-sag bounds. These historically lived in five
// places with mismatched windows — the client's final 90-120 clamp being the
// widest, which silently clobbered per-model values. Everything now resolves
// through here so the target + bounds that go out in guardrails are the same
// ones the final clamp enforces.

export type SagBounds = { target: number; min: number; max: number };

import { classifyModel } from "./discipline";

// Consolidated defaults for bikes with no verified per-model spec.
export const DEFAULT_SAG: SagBounds = { target: 105, min: 95, max: 112 };

export type PlatformSag = SagBounds & { source: string };

/** Manual or supplier sag for an UNMATCHED bike whose make and platform are
 *  known (research report 2026-09-07, section 1; shadow-report decision 12):
 *  better than DEFAULT_SAG, never shown as the model's own number. Null when
 *  the platform is unknown. */
export function platformSagBounds(make: string | null | undefined, model: string | null | undefined): PlatformSag | null {
  if (!make || !model) return null;
  const kind = classifyModel(make, model);
  if (kind === "mini" || kind === "other") return null;
  const wp = make === "KTM" || make === "Husqvarna" || make === "GasGas";
  if (wp && kind === "mx") return { target: 105, min: 102, max: 112, source: "KTM 250 SX-F Owner's Manual: riding sag 102 to 112 mm (platform value for an unmatched WP motocross bike)" };
  if (wp && kind === "offroad") return { target: 105, min: 100, max: 110, source: "KTM 250/350 EXC-F Owner's Manuals; Rust Sports: PDS riding sag about 100 to 110 mm (platform value for an unmatched WP enduro bike)" };
  if (make === "Yamaha") return { target: 97, min: 95, max: 105, source: "PulpMX 2023 YZ450F; MotoSport: Yamaha standard 97 to 98 mm, 95 to 105 mm target (platform value)" };
  if (make === "Sherco") return { target: 98, min: 95, max: 100, source: "Sherco 250-300 SEF Owner's Manual 2025: laden sag 95 to 100 mm (platform value, KYB era)" };
  if (make === "Beta") return { target: 100, min: 100, max: 115, source: "Beta Spring Rates Chart (Endurospec); MotoSport: rider sag 100, race trim 100 to 115 mm (platform value)" };
  return null;
}

// Loose shape of a bike_models row's sag fields (reference data; nullable).
export type ModelSagSpec =
  | { stock_sag_mm?: number | null; sag_min?: number | null; sag_max?: number | null }
  | null
  | undefined;

/**
 * Per-model sag bounds when a row supplies all three fields, else DEFAULT_SAG.
 * (Callers gate on spec_verified before passing a model in.)
 */
export function resolveSagBounds(model?: ModelSagSpec, platform?: SagBounds | null): SagBounds {
  if (
    model &&
    typeof model.stock_sag_mm === "number" &&
    typeof model.sag_min === "number" &&
    typeof model.sag_max === "number"
  ) {
    return { target: model.stock_sag_mm, min: model.sag_min, max: model.sag_max };
  }
  if (platform) return { target: platform.target, min: platform.min, max: platform.max };
  return DEFAULT_SAG;
}
