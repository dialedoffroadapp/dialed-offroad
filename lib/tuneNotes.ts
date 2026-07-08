// lib/tuneNotes.ts
// Pure helpers for interpreting the ai-tune engine's notes[] strings.
// The markers here MUST track the literal note templates in
// supabase/functions/ai-tune/index.ts (buildTuneTwo) — if a template changes
// there, update the matching marker here. Unrecognized notes always fall
// through to `routine`, so classification can never crash rendering.

export type ClassifiedTuneNotes = {
  /** Echo path ("No specific issues were selected…") — render as-is. */
  isEcho: boolean;
  /** "Tune Two for {bike} on {terrain}: …" — the section lead-in. */
  summaryLead: string | null;
  /** "Goals: …" — optional summary line. */
  goals: string | null;
  /** "Re-test on the same section…" — rendered as the section footer. */
  retest: string | null;
  /** Adaptive-step decisions (reversals / bigger steps) — rare, important. */
  adaptive: string[];
  /** Protect-pass decisions (left alone / capped at ±1). */
  protect: string[];
  /** Conflict resolutions ("You reported both X and Y…"). */
  conflict: string[];
  /** Free-text parse additions ("From your written note, I also picked up…"). */
  parse: string[];
  /** Per-symptom adjustment notes and anything unrecognized. */
  routine: string[];
};

export function classifyTuneNotes(
  notes: string[] | null | undefined
): ClassifiedTuneNotes {
  const out: ClassifiedTuneNotes = {
    isEcho: false,
    summaryLead: null,
    goals: null,
    retest: null,
    adaptive: [],
    protect: [],
    conflict: [],
    parse: [],
    routine: [],
  };

  const list = (Array.isArray(notes) ? notes : []).filter(
    (n): n is string => typeof n === "string" && n.length > 0
  );

  if (list.length && list[0].startsWith("No specific issues were selected")) {
    out.isEcho = true;
    out.routine = list;
    return out;
  }

  for (const n of list) {
    if (n.startsWith("Tune Two for ") && !out.summaryLead) {
      out.summaryLead = n;
    } else if (n.startsWith("Re-test on the same section") && !out.retest) {
      out.retest = n;
    } else if (n.startsWith("Goals: ") && !out.goals) {
      out.goals = n;
    } else if (
      n.includes("reversing that this round") ||
      n.includes("slightly bigger step this round")
    ) {
      out.adaptive.push(n);
    } else if (
      n.includes("alone — you said it was working") ||
      n.includes("capping that change at")
    ) {
      out.protect.push(n);
    } else if (n.includes("opposite ways")) {
      out.conflict.push(n);
    } else if (n.startsWith("From your written note")) {
      out.parse.push(n);
    } else {
      out.routine.push(n);
    }
  }

  return out;
}

/** Note fragments that identify each circuit inside engine notes. */
export const NOTE_HINTS = {
  fork_comp: ["fork compression", "fork comp"],
  fork_reb: ["fork rebound", "fork reb"],
  fork_air: ["aer", "air"],
  shock_lsc: ["shock lsc", "shock low-speed"],
  shock_hsc: ["hsc"],
  shock_reb: ["shock rebound", "shock reb"],
  sag: ["sag"],
} as const;

/**
 * reasonFromNotes — mine the "why" for a changed circuit from the version's
 * engine notes. Engine notes read "Harsh on braking bumps → +4 fork
 * compression clicks…"; the part before the arrow is the reason.
 * (Extracted from setup-history so both screens share one implementation.)
 */
export function reasonFromNotes(
  notes: string[] | null | undefined,
  hints: readonly string[]
): string | null {
  for (const note of notes ?? []) {
    if (typeof note !== "string") continue;
    const lower = note.toLowerCase();
    if (hints.some((h) => lower.includes(h))) {
      const arrow = note.indexOf("→");
      if (arrow > 0) {
        const why = note.slice(0, arrow).trim().replace(/[.:]$/, "");
        if (why.length > 2 && why.length < 60) return why;
      }
    }
  }
  return null;
}
