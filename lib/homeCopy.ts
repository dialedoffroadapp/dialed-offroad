// lib/homeCopy.ts
// Copy templates for the Home + Garage v3 screens. The static lines are the
// mockups' verbatim (design/mockups/01, 02); the dynamic ones follow the
// same voice. Pure and testable. NO em dashes in user-facing copy (CLAUDE.md).

import { formatSetting, formatValue } from "./format";
const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Saturday · Sep 12 · 9 days since OMC" / "Saturday · Sep 12" */
export function homeEyebrow(now: Date, lastRide?: { date: Date; place?: string | null } | null): string {
  const base = `${WEEKDAYS[now.getDay()]} · ${shortDate(now)}`;
  if (!lastRide) return base;
  const days = daysBetween(lastRide.date, now);
  const where = lastRide.place?.trim();
  if (days <= 0) return `${base} · rode today`;
  const since = days === 1 ? "1 day since" : `${days} days since`;
  return `${base} · ${since} ${where && where.length > 0 ? where : "your last ride"}`;
}

/** "Day one · Thu Sep 3" */
export function dayOneEyebrow(now: Date): string {
  return `Day one · ${WEEKDAYS_SHORT[now.getDay()]} ${shortDate(now)}`;
}

/** Short model handle for headlines: "250 SX-F" → "250", "YZ450F" → "YZ450F". */
export function bikeShortName(model: string | null | undefined): string {
  if (!model) return "bike";
  const m = model.trim();
  const displacement = m.match(/^(\d{2,3})\b/);
  if (displacement) return displacement[1];
  return m.split(/\s+/)[0];
}

/** "YOUR 250 IS READY TO RIDE" / "LET'S GET YOUR 250 DIALED" */
export function homeHeadline(model: string | null | undefined, dayOne: boolean): string {
  const short = bikeShortName(model);
  return dayOne ? `Let's get your ${short} dialed` : `Your ${short} is ready to ride`;
}

/** "Fork 13/12 · Shock 11/1.0/15 · Sag 105" */
export function valuesSummary(v: {
  fork_comp?: number | null;
  fork_reb?: number | null;
  shock_lsc?: number | null;
  shock_hsc?: number | null;
  shock_reb?: number | null;
  shock_sag?: number | null;
}): string {
  const n = (x: number | null | undefined, digits = 0) => formatValue(x, digits);
  const hsc = formatSetting(v.shock_hsc, "shock_hsc");
  return `Fork ${n(v.fork_comp)}/${n(v.fork_reb)} · Shock ${n(v.shock_lsc)}/${hsc}/${n(v.shock_reb)} · Sag ${n(v.shock_sag)}`;
}

/** "250 SX-F · MX setup · v5" / "250 SX-F · Baseline · v1" */
export function setupEyebrow(model: string | null | undefined, setupName: string | null | undefined, version: number | null | undefined): string {
  return [model ?? "Your bike", setupName ?? "Baseline", version ? `v${version}` : null].filter(Boolean).join(" · ");
}

/* ---------------------------- Season goal ------------------------------- */

export type SeasonGoalType = "ride_days" | "engine_hours" | "race";

export function goalTitle(type: SeasonGoalType, target: number, raceName?: string | null): string {
  if (type === "race") return raceName?.trim() ? raceName.trim() : "A race";
  if (type === "engine_hours") return `${target} engine hours`;
  return `${target} ride days`;
}

/** "14 down, 11 to go." with a month nudge when the season has months left. */
export function goalProgressLine(type: SeasonGoalType, done: number, target: number, now: Date, raceDate?: Date | null): string {
  if (type === "race") {
    if (!raceDate) return "Set the date and count it down.";
    const d = daysBetween(now, raceDate);
    if (d < 0) return "Race day is behind you. Log how it went.";
    if (d === 0) return "Race day. Go.";
    return `${d} ${d === 1 ? "day" : "days"} out. Every ride counts.`;
  }
  const left = Math.max(0, target - done);
  if (left === 0) return "Done. Set the next one.";
  const doneStr = type === "engine_hours" ? done.toFixed(1) : String(done);
  const leftStr = type === "engine_hours" ? left.toFixed(1) : String(left);
  const month = now.getMonth();
  const nudge = month <= 8 ? ` ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month + 1]}'s yours.` : "";
  return `${doneStr} down, ${leftStr} to go.${nudge}`;
}

/* ---------------------------- Maintenance -------------------------------- */

export const DEFAULT_OIL_INTERVAL_HOURS = 15;

/** Hours line under the season stats, only once hours exist. */
export function maintenanceLine(hours: number, intervalHours: number, lastServiceHours = 0): string | null {
  if (!(hours > 0)) return null;
  const sinceService = Math.max(0, hours - lastServiceHours);
  const next = lastServiceHours + intervalHours;
  const left = next - hours;
  if (sinceService >= intervalHours) return `Past ${intervalHours} hours. Fresh oil before the next ride day.`;
  if (left <= intervalHours * 0.2) return `${intervalHours} hours is close. Fresh oil before the next ride day.`;
  return `${left.toFixed(1)} hours until oil at ${next}.`;
}

/* ------------------------------ Next ride -------------------------------- */

export function nextRideLine(now: Date, date: Date | null): { big: string; text: string; state: "today" | "future" | "past" | "empty" } {
  if (!date) return { big: "", text: "When's the first one?", state: "empty" };
  const d = daysBetween(now, date);
  if (d === 0) return { big: "TODAY", text: "Today. Bike's ready, numbers are set. Go.", state: "today" };
  if (d < 0) return { big: "", text: "That day came and went. Pick the next one.", state: "past" };
  return { big: `${d}d`, text: d === 1 ? "Tomorrow. Numbers are set." : `${shortDate(date)}. ${d} days out.`, state: "future" };
}

/* --------------------------- Season boundaries --------------------------- */

/** Riding season = calendar year for now (rider-set seasons come later). */
export function seasonYear(now: Date): number {
  return now.getFullYear();
}
export function seasonStart(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}
