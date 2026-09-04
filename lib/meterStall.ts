// lib/meterStall.ts
// Meter stall (playbook §5 moment 3, §3 endowed progress): the meter hasn't
// moved across the last 2 ride days AND every remaining category is locked.
// Pure; ride history carries meterPct after each End ride.
import type { MeterCategory } from "./dialedMeter";

export type StallInput = {
  /** Newest first; meterPct recorded at End ride. */
  rideDayMeters: (number | null | undefined)[];
  categories: MeterCategory[];
  /** Categories the free tier cannot fill (Pro-only). */
  lockedKeys: MeterCategory["key"][];
  state: "trial_active" | "free" | "pro";
};

export function meterStalled(i: StallInput): boolean {
  if (i.state !== "free") return false;
  const last = i.rideDayMeters.filter((x): x is number => typeof x === "number").slice(0, 2);
  if (last.length < 2) return false;
  if (last[0] !== last[1]) return false;
  const remaining = i.categories.filter((c) => c.state !== "done");
  if (remaining.length === 0) return false;
  return remaining.every((c) => i.lockedKeys.includes(c.key));
}

/** "You're 45% dialed. The next 55% is Pro: first refinement, setup history." */
export function stallLine(pct: number, categories: MeterCategory[], lockedKeys: MeterCategory["key"][]): string {
  const locked = categories.filter((c) => c.state !== "done" && lockedKeys.includes(c.key));
  const rest = Math.max(0, 100 - pct);
  const names = locked.map((c) => c.label.toLowerCase()).slice(0, 2).join(" and ");
  return `You're ${pct}% dialed. The next ${rest}% is Pro: ${names}.`;
}
