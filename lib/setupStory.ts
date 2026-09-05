// lib/setupStory.ts
// Pure derivations for the Home "Setup story" mini timeline, the last-ride
// recap card, and the Garage history timeline: one honest line per version
// from the rows we actually have (source, producing feedback, outcome
// recorded on the ride that followed, server-computed settings_delta).
import { SYMPTOM_PHRASES, type Tune2SymptomId } from "./ai";
import { shortDate } from "./homeCopy";
import type {
  FeedbackEntry,
  FeedbackOutcome,
  RideFeedbackRow,
  SettingsDelta,
  VersionWithFeedback,
} from "./setupVersions";

/** Short noun labels for "X solved" / "X: gone" lines. */
export const SYMPTOM_LABELS: Record<Tune2SymptomId, string> = {
  harsh_braking_bumps: "Braking-bump harshness",
  deflects_in_chop: "Deflection",
  rear_kicks_accel: "Rear kicks",
  bottoms_landings: "Bottoming",
  front_knifes: "Front tuck",
  dead_feel: "Dead feel",
  unstable_whoops: "Whoop instability",
  packs_whoops: "Packing",
  harsh_square_edge: "Square-edge harshness",
  headshake: "Headshake",
  general_harsh: "Harshness",
  // v3 taxonomy (contract v3, 2026-09-05)
  harsh_small_bumps: "Small-bump harshness",
  bottoming: "Bottoming",
  rear_kicks: "Rear kicks",
  front_pushes: "Front push",
  packs_in_chop: "Packing",
  wallows_dives: "Wallowing",
  rear_swaps: "Rear swap",
  deflects: "Deflection",
  rear_squats: "Rear squat",
  too_stiff: "Stiffness",
  too_soft: "Softness",
  arm_pump: "Arm pump",
  chatters: "Chatter",
};

export const CIRCUIT_LABELS: Record<keyof SettingsDelta & string, string> = {
  fork_comp: "fork comp",
  fork_reb: "fork rebound",
  fork_air: "fork air",
  shock_lsc: "shock LSC",
  shock_hsc: "shock HSC",
  shock_reb: "shock rebound",
  shock_sag: "sag",
};

export function isSymptom(e: FeedbackEntry): e is Extract<FeedbackEntry, { id: string }> {
  return typeof (e as any)?.id === "string" && !(e as any)?.protect;
}

/** Highest-severity reported symptom on a feedback row, if any. */
export function primarySymptom(fb: RideFeedbackRow | null | undefined): Tune2SymptomId | null {
  if (!fb || !Array.isArray(fb.symptoms)) return null;
  let best: { id: string; severity: number } | null = null;
  for (const e of fb.symptoms) {
    if (!isSymptom(e)) continue;
    const sev = typeof (e as any).severity === "number" ? (e as any).severity : 0;
    if (!best || sev > best.severity) best = { id: (e as any).id, severity: sev };
  }
  return best && best.id in SYMPTOM_LABELS ? (best.id as Tune2SymptomId) : null;
}

export function outcomeWord(o: FeedbackOutcome | null | undefined): string | null {
  if (o === "improved") return "Better";
  if (o === "same") return "Same";
  if (o === "worse") return "Worse";
  return null;
}

/** Largest change in a delta, as "+2 shock rebound" / "−1 fork comp". */
export function biggestDelta(delta: SettingsDelta | null | undefined): { circuit: keyof SettingsDelta; value: number; text: string } | null {
  if (!delta) return null;
  let best: { circuit: keyof SettingsDelta; value: number } | null = null;
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
    if (!best || Math.abs(v) > Math.abs(best.value)) best = { circuit: k as keyof SettingsDelta, value: v };
  }
  if (!best) return null;
  const sign = best.value > 0 ? "+" : "−";
  const mag = Number.isInteger(best.value) ? String(Math.abs(best.value)) : Math.abs(best.value).toFixed(1);
  return { ...best, text: `${sign}${mag} ${CIRCUIT_LABELS[best.circuit] ?? best.circuit}` };
}

/** "fork comp 13 → 14" for the history timeline (first changed circuit). */
export function deltaChangeLine(v: VersionWithFeedback, parent: VersionWithFeedback | null): string | null {
  if (!parent || !v.settings_delta) return null;
  const b = biggestDelta(v.settings_delta);
  if (!b) return "no change";
  const field: Record<string, keyof VersionWithFeedback> = {
    fork_comp: "fork_comp_clicks",
    fork_reb: "fork_reb_clicks",
    fork_air: "fork_air_bar",
    shock_lsc: "shock_lsc_clicks",
    shock_hsc: "shock_hsc_turns",
    shock_reb: "shock_reb_clicks",
    shock_sag: "sag_mm",
  };
  const f = field[b.circuit];
  const from = parent[f];
  const to = v[f];
  return `${CIRCUIT_LABELS[b.circuit]} ${from ?? "—"} → ${to ?? "—"}`;
}

export type StoryEntry = {
  id: string;
  v: number;
  text: string;
  date: string;
  current: boolean;
  source: VersionWithFeedback["source"];
};

/**
 * One line per version. `versions` newest-first (getHistoryWithFeedback);
 * `feedbackByVersion` maps a version id → the feedback recorded on the ride
 * of THAT version (its outcome tells whether the version solved what it was
 * built for).
 */
export function buildStory(
  versions: VersionWithFeedback[],
  feedbackByRidden: Map<string, RideFeedbackRow>
): StoryEntry[] {
  const byId = new Map(versions.map((v) => [v.id, v]));
  return versions.map((v, i) => {
    let text: string;
    const ridden = feedbackByRidden.get(v.id);
    const sym = primarySymptom(v.feedback);
    switch (v.source) {
      case "baseline":
        text = "Baseline tune";
        break;
      case "refinement":
        if (sym && ridden?.outcome === "improved") text = `${SYMPTOM_LABELS[sym]} solved`;
        else if (sym) text = `"${SYMPTOM_PHRASES[sym]}"`;
        else if (v.feedback?.free_text?.trim()) text = `"${v.feedback.free_text.trim().slice(0, 40)}"`;
        else text = "Refined after a ride";
        break;
      case "restore": {
        const from = v.restored_from_version_id ? byId.get(v.restored_from_version_id) : null;
        text = from ? `Restored from v${from.version_number}` : "Restored a past setup";
        break;
      }
      default:
        text = "Adjusted by hand";
    }
    return {
      id: v.id,
      v: v.version_number,
      text,
      date: shortDate(new Date(v.created_at)),
      current: i === 0,
      source: v.source,
    };
  });
}

export type LastRide = {
  label: string; // "Last ride · Sep 3 · OMC"
  text: string; // "Worse → Better" | "Better" | the symptom phrase
  sub: string; // "Rear kicks: gone. +2 shock rebound did it."
  date: Date;
  place: string | null;
  /** The ride reported a symptom and no refinement was applied for it. */
  unaddressedSymptom: Tune2SymptomId | null;
  feedbackId: string;
};

/**
 * Latest ride from ride_feedback (newest first) + the versions map. A ride
 * = a feedback row; its outcome (recorded later) describes how the
 * RESULTING version felt; place comes from the ridden version's context.
 */
export function lastRideRecap(
  feedbackDesc: RideFeedbackRow[],
  versionsById: Map<string, VersionWithFeedback>
): LastRide | null {
  const f = feedbackDesc[0];
  if (!f) return null;
  const prev = feedbackDesc[1] ?? null;
  const ridden = versionsById.get(f.setup_version_id) ?? null;
  const resulting = f.resulting_version_id ? versionsById.get(f.resulting_version_id) ?? null : null;
  const place = (ridden?.context as any)?.track ?? null;
  const date = new Date(f.created_at);
  const sym = primarySymptom(f);
  const now = outcomeWord(f.outcome);
  const before = outcomeWord(prev?.outcome);

  let text: string;
  if (before && now) text = `${before} → ${now}`;
  else if (now) text = now;
  else if (sym) text = `"${SYMPTOM_PHRASES[sym]}"`;
  else if (f.free_text?.trim()) text = `"${f.free_text.trim().slice(0, 60)}"`;
  else text = "Ride logged";

  const delta = biggestDelta(resulting?.settings_delta);
  let sub: string;
  if (sym && resulting && f.outcome === "improved") {
    sub = `${SYMPTOM_LABELS[sym]}: gone.${delta ? ` ${delta.text} did it.` : ""}`;
  } else if (sym && resulting && f.outcome === "worse") {
    sub = `${SYMPTOM_LABELS[sym]}: worse after ${delta ? delta.text : "the change"}. Next refine reverses it.`;
  } else if (sym && resulting && f.outcome === "same") {
    sub = `${SYMPTOM_LABELS[sym]}: still there.${delta ? ` ${delta.text} wasn't enough.` : ""}`;
  } else if (sym && resulting) {
    sub = `${delta ? `${delta.text} applied` : "Refined"} for ${SYMPTOM_LABELS[sym].toLowerCase()}. Tell us how it felt.`;
  } else if (sym) {
    sub = `${SYMPTOM_LABELS[sym]} logged. No change applied yet.`;
  } else if (resulting && delta) {
    sub = `${delta.text} applied.`;
  } else {
    sub = "Nothing to fix. Keep riding it.";
  }

  return {
    label: ["Last ride", shortDate(date), place].filter(Boolean).join(" · "),
    text,
    sub,
    date,
    place,
    unaddressedSymptom: sym && !resulting ? sym : null,
    feedbackId: f.id,
  };
}
