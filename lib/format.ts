// lib/format.ts
// THE display formatter for setting values (CLAUDE.md rule b, 2026-09-04):
// every screen shows the saved value exactly. Two decimals at most, trailing
// zeros trimmed, integers untouched (10 stays "10"), null shows the "—"
// data placeholder. The shipped air bug and the HSC 1.25 → "1.3" class both
// came from screen-local rounding; nothing outside this file should call
// toFixed on a setting.
import { CIRCUIT_STEPS, type CircuitKey } from "./currentSetup";

export const EMPTY_VALUE = "—";

export type SettingKey = CircuitKey | "fork_spring" | "shock_spring";

/** Decimals a value is DISPLAYED with. Air forks are set to 0.05 bar and the
 *  engine emits two decimals; HSC steps by quarter turns. */
export function displayDecimals(key: SettingKey): number {
  switch (key) {
    case "fork_air":
    case "shock_hsc":
      return 2;
    case "fork_spring":
    case "shock_spring":
      return 1;
    default:
      return 0;
  }
}

/** Format a number for display: at most `decimals` places, trailing zeros
 *  trimmed, integers untouched. */
export function formatValue(v: number | null | undefined, decimals: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return EMPTY_VALUE;
  if (decimals <= 0) return String(Math.round(v));
  const fixed = v.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

export function formatSetting(v: number | null | undefined, key: SettingKey): string {
  return formatValue(v, displayDecimals(key));
}

/** Round a value or delta to the circuit's step precision before STORING it
 *  (10.6 minus 0.2 is -0.1999999999999993 in floating point). */
export function roundToStep(v: number, key: CircuitKey): number {
  const d = Math.max(CIRCUIT_STEPS[key].decimals, displayDecimals(key));
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}
