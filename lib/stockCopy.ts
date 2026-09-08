// lib/stockCopy.ts
// The vs-stock line (second report, 2026-09-07): stock clickers carry a tag.
// factory = "factory stock", tuner = "tuner-published stock", inferred = not
// stock at all (treated as missing, logged stock_missing). Pure.
import type { ModelSpecs } from "./modelSpecs";

export type StockTag = "factory" | "tuner" | "inferred";

export function stockLabel(tag: StockTag | null | undefined): "factory stock" | "tuner-published stock" | null {
  if (tag === "factory") return "factory stock";
  if (tag === "tuner") return "tuner-published stock";
  return null;
}

export type StockDelta = { line: string | null; missing: boolean; tag: StockTag | null };

const word = (n: number, unit: "click" | "turn") => `${Math.abs(n)} ${unit}${Math.abs(n) === 1 ? "" : "s"}`;

/** "Fork comp 2 clicks softer, shock LSC 1 click firmer than factory stock."
 *  null (and missing) when the row has no surfaced stock clickers. */
export function stockDeltaLine(tune: { fork?: { comp_clicks?: number | null }; shock?: { lsc_clicks?: number | null } } | null | undefined, specs: ModelSpecs | null | undefined): StockDelta {
  const tag = (specs?.stock_clicker_tag ?? null) as StockTag | null;
  const label = stockLabel(tag);
  const stockComp = specs?.stock_fork_comp;
  const stockLsc = specs?.stock_shock_comp;
  if (!label || (typeof stockComp !== "number" && typeof stockLsc !== "number")) return { line: null, missing: true, tag };
  const parts: string[] = [];
  const comp = tune?.fork?.comp_clicks;
  if (typeof comp === "number" && typeof stockComp === "number") {
    const d = comp - stockComp;
    parts.push(d === 0 ? "Fork comp at stock" : `Fork comp ${word(d, "click")} ${d > 0 ? "softer" : "firmer"}`);
  }
  const lsc = tune?.shock?.lsc_clicks;
  if (typeof lsc === "number" && typeof stockLsc === "number") {
    const d = lsc - stockLsc;
    const unit = specs?.shock_adjust_unit === "turns" ? "turn" : "click";
    parts.push(d === 0 ? "shock LSC at stock" : `shock LSC ${word(Number(d.toFixed(2)), unit)} ${d > 0 ? "softer" : "firmer"}`);
  }
  if (!parts.length) return { line: null, missing: true, tag };
  return { line: `${parts.join(", ")} than ${label}.`, missing: false, tag };
}
