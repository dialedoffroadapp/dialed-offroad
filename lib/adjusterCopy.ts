// lib/adjusterCopy.ts
// Setup sheet copy (design/mockups/05): "What it does" is static educational
// copy per adjuster (all eight, plus the two spring rows); "Why N for you" is
// a template over quiz inputs + version history (ai-explain output plugs in
// later); end labels sit under the range bar. Plain riding language, no
// engineering hedges. NO em dashes.
import type { SettingsSnapshot } from "./setupVersions";

export type AdjusterKey = keyof SettingsSnapshot | "fork_spring" | "shock_spring";

export type AdjusterMeta = {
  key: AdjusterKey;
  label: string;
  unit: string;
  /** Left / right ends of the range bar (only rendered when a range is known). */
  ends: [string, string] | null;
  what: string;
};

export const ADJUSTERS: Record<AdjusterKey, AdjusterMeta> = {
  fork_air: {
    key: "fork_air",
    label: "Spring · air",
    unit: "bar",
    ends: ["softer, more sag", "stiffer, more hold-up"],
    what: "Air pressure is the fork's spring. More pressure holds the front higher and resists bottoming; less lets it sink into the stroke and soak up small hits. Set it cold, check it every ride day.",
  },
  fork_spring: {
    key: "fork_spring",
    label: "Spring rate",
    unit: "N/mm",
    ends: null,
    what: "The coil spring rate is the fork's foundation. Right for your weight, the clickers do fine work. Too soft and you chase harshness with compression you don't need; too stiff and the front never settles.",
  },
  fork_comp: {
    key: "fork_comp",
    label: "Compression",
    unit: "clicks",
    ends: ["softer, more plush", "firmer, more hold-up"],
    what: "Controls how fast the fork can compress. More clicks out is softer: plusher over chop, easier to bottom. Fewer clicks out is firmer: more hold-up on jump faces and braking, harsher on small hits.",
  },
  fork_reb: {
    key: "fork_reb",
    label: "Rebound",
    unit: "clicks",
    ends: ["slow return", "fast return"],
    what: "Controls how fast the fork extends after it compresses. Too fast and the front pogos and pushes; too slow and it packs down through chop and feels harsh.",
  },
  shock_spring: {
    key: "shock_spring",
    label: "Spring rate",
    unit: "N/mm",
    ends: null,
    what: "The shock spring carries most of your weight. The right rate lands race sag inside the window with the preload near the middle of its range. Out of range, no clicker fixes it.",
  },
  shock_sag: {
    key: "shock_sag",
    label: "Race sag",
    unit: "mm",
    ends: ["less sag, higher rear", "more sag, lower rear"],
    what: "How far the rear settles with you on the bike, geared up. It sets the chassis attitude: less sag steers sharper and rides higher, more sag adds straight-line stability and rear grip.",
  },
  shock_lsc: {
    key: "shock_lsc",
    label: "Low speed comp",
    unit: "clicks",
    ends: ["softer, more squat", "firmer, less squat"],
    what: "Damping on slow shaft movement: squat under acceleration, rolling through G-outs, pumping through rollers. Fewer clicks out holds the rear higher and crisper; more clicks lets it squat and hook up.",
  },
  shock_hsc: {
    key: "shock_hsc",
    label: "High speed comp",
    unit: "turns",
    ends: ["softer on big hits", "firmer on big hits"],
    what: "Damping on fast shaft movement: square edges, hard landings, big braking bumps. Turned in (fewer turns out) resists bottoming and kicks; turned out soaks up sharp hits at the cost of some hold-up.",
  },
  shock_reb: {
    key: "shock_reb",
    label: "Rebound",
    unit: "clicks",
    ends: ["slow return", "fast return"],
    what: "Controls how fast the shock extends. Too fast and the rear kicks and bucks over braking bumps and on landings; too slow and it packs down in whoops and acceleration chop.",
  },
};

export type WhyContext = {
  riderWeightLbs?: number | null;
  terrain?: string | null;
  skill?: string | null; // engine skill or quiz skill id
  /** "v1 15 → v3 12" style history for this adjuster, if any. */
  history?: { fromVersion: number; fromValue: number; toVersion: number; toValue: number; reason?: string | null } | null;
};

const SKILL_PHRASE: Record<string, string> = {
  beginner: "while you're still building speed",
  intermediate: "at a steady weekend pace",
  pro: "at race pace",
  learning: "while you're still building speed",
  comfortable: "at a steady weekend pace",
  fast: "at race pace",
};

/** "Why 12 for you" body. Template now; ai-explain output later. */
export function whyForYou(key: AdjusterKey, value: number | null, ctx: WhyContext): string {
  const w = typeof ctx.riderWeightLbs === "number" ? `At ${Math.round(ctx.riderWeightLbs)} lbs` : "For your weight";
  const t = ctx.terrain ? ` on ${ctx.terrain.toLowerCase()}` : "";
  const s = ctx.skill && SKILL_PHRASE[ctx.skill] ? ` ${SKILL_PHRASE[ctx.skill]}` : "";
  const lead: Record<AdjusterKey, string> = {
    fork_air: `${w}${t}${s}, the fork needs enough pressure to hold up on the faces without spiking on small chop.`,
    fork_spring: `${w}, this rate keeps the fork in the plush part of its stroke without diving under braking.`,
    fork_comp: `${w}${t}${s}, the fork needs hold-up on the faces and under braking without turning square edges into hits.`,
    fork_reb: `${w}${t}${s}, the fork needs to recover quickly between braking bumps without kicking.`,
    shock_spring: `${w}, this rate lands race sag in the window with the preload where it belongs.`,
    shock_sag: `${w}${t}, this sag sets the chassis where the front steers and the rear still hooks up.`,
    shock_lsc: `${w}${t}${s}, the rear needs to squat enough to find grip on the gas without wallowing.`,
    shock_hsc: `${w}${t}${s}, the shock needs to take the big hits without kicking through the hard landings.`,
    shock_reb: `${w}${t}${s}, the rear needs to settle after each hit before the next one arrives.`,
  };
  const h = ctx.history;
  const tail = h
    ? h.toValue !== h.fromValue
      ? ` You went ${Math.abs(h.toValue - h.fromValue)} ${h.toValue > h.fromValue ? "clicks softer" : "clicks firmer"} in v${h.toVersion}${h.reason ? ` after "${h.reason}"` : ""}, and it's stayed there since.`
      : ` It's stayed at ${h.toValue} since v${h.fromVersion}.`
    : value !== null
      ? ` ${value} is the baseline's call; your first ride tells us if it moves.`
      : "";
  return lead[key] + tail;
}
