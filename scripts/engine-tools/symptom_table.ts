// scripts/engine-tools/symptom_table.ts
// Decision 12 (2026-09-07): generate docs/symptom-table-draft.md from the
// engine itself: the proposed move for each of the 14 v3 symptom ids at three
// severities and for every qualifier pair, marked inherited (the row mirrors a
// legacy row that is byte-frozen by the v1 regression) or NEW authorship.
// River corrects the table; the PR implements the corrected table.
//
// Usage: deno run --allow-env --allow-read --allow-write scripts/engine-tools/symptom_table.ts
Deno.env.set("AI_TUNE_TEST", "1");
const engine = await import("../../supabase/functions/ai-tune/index.ts");
const { buildTuneTwo, safeShapeSparse, V3_SYMPTOM_IDS, LEGACY_TO_V3 } = engine as any;

const PREV = {
  fork: { comp_clicks: 14, reb_clicks: 12, air_pressure_bar: 10.6 },
  shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 103 },
  detected: { has_air_fork: true, fork_family: "WP XACT AER 48" },
  notes: [],
};
const GUARDRAILS = { clicks_min: 0, clicks_max: 30, hsc_turns_min: 0, hsc_turns_max: 3, sag_min_mm: 95, sag_max_mm: 112, has_air_fork: true };
const SEVERITIES = [3, 6, 9];

const INHERITED: Record<string, string> = {
  harsh_small_bumps: "harsh_braking_bumps",
  bottoming: "bottoms_landings",
  rear_kicks: "rear_kicks_accel",
  front_pushes: "front_knifes",
  packs_in_chop: "packs_whoops",
  deflects: "deflects_in_chop",
  headshake: "headshake",
  too_stiff: "general_harsh",
};
const QUALIFIERS: Record<string, string[]> = {
  harsh_small_bumps: ["small_chop", "under_braking", "big_hits"],
  rear_kicks: ["jump_face", "braking_bumps", "logs_ledges"],
  packs_in_chop: ["whoops", "rocks"],
};
const NEW_ROUTES = new Set(["harsh_small_bumps+big_hits", "rear_kicks+jump_face", "rear_kicks+braking_bumps", "rear_kicks+logs_ledges", "packs_in_chop+rocks"]);

function run(symptoms: any[]) {
  const out = safeShapeSparse(buildTuneTwo({ make: "KTM", model: "350 SX-F", year: 2024, terrain: "hardpack", rider: { skill: "intermediate", style: "short_motos", goals: [] }, previous: PREV, feedback: { overall_rating: 6, symptoms }, guardrails: GUARDRAILS }), GUARDRAILS);
  const d = (a: number | null, b: number) => (typeof a === "number" ? Math.round((a - b) * 100) / 100 : null);
  const deltas = {
    fork_comp: d(out.fork.comp_clicks, PREV.fork.comp_clicks),
    fork_reb: d(out.fork.reb_clicks, PREV.fork.reb_clicks),
    fork_air: typeof out.fork.air_pressure_bar === "number" ? Math.round((out.fork.air_pressure_bar - PREV.fork.air_pressure_bar) * 100) / 100 : null,
    shock_lsc: d(out.shock.lsc_clicks, PREV.shock.lsc_clicks),
    shock_hsc: d(out.shock.hsc_turns, PREV.shock.hsc_turns),
    shock_reb: d(out.shock.reb_clicks, PREV.shock.reb_clicks),
  };
  const adjustNotes = (out.notes as string[]).filter((n: string) => !n.startsWith("Tune Two for") && !n.startsWith("Re-test"));
  return { deltas, notes: adjustNotes };
}
const f = (n: number | null) => (n === null ? "·" : n === 0 ? "0" : n > 0 ? `+${n}` : `${n}`);
const row = (label: string, sev: number | string, r: ReturnType<typeof run>, authorship: string) =>
  `| ${label} | ${sev} | ${f(r.deltas.fork_comp)} | ${f(r.deltas.fork_reb)} | ${f(r.deltas.fork_air)} | ${f(r.deltas.shock_lsc)} | ${f(r.deltas.shock_hsc)} | ${f(r.deltas.shock_reb)} | ${authorship} | ${r.notes.map((n) => n.replace(/\|/g, "/")).join(" ⏎ ")} |`;
const HEAD = "| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Engine notes |\n|---|---|---|---|---|---|---|---|---|---|";

const lines: string[] = [];
lines.push("# Symptom table draft (contract v3, for River's review)");
lines.push("");
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by scripts/engine-tools/symptom_table.ts from the engine on feat/engine-contract-v3. Every row is the engine's actual answer for that symptom alone, on an air-fork previous tune of fork 14 / 12 at 10.6 bar and shock LSC 12, HSC 1.5, rebound 14, sag 103, overall rating 6 (global scale 1.0). Deltas are clicks out from closed (positive = softer or faster), bar for air, turns for HSC. Severity 3 / 6 / 9 are the regression suite's mild / moderate / bad. "Inherited from X" means the row mirrors the byte-frozen legacy row X; "NEW" means authored on 2026-09-05 and awaiting correction. Sag never moves.`);
lines.push("");
lines.push("How to review: change the numbers or the direction in this file (or say so in the PR); the PR then implements the corrected table and its tests. Rows you leave alone ship as shown.");
lines.push("");
lines.push("## The 14 ids at three severities");
lines.push("");
lines.push(HEAD);
for (const id of V3_SYMPTOM_IDS) {
  const authorship = INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)";
  for (const sev of SEVERITIES) lines.push(row(id, sev, run([{ id, severity: sev }]), authorship));
}
lines.push("");
lines.push("## Qualifier pairs (severity 6)");
lines.push("");
lines.push("The three chips with a mandatory qualifier. A route marked NEW changes the move; the others keep the chip's default move and only mention the location in the note.");
lines.push("");
lines.push(HEAD);
for (const [id, tags] of Object.entries(QUALIFIERS)) {
  lines.push(row(`${id} (no qualifier)`, 6, run([{ id, severity: 6 }]), INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)"));
  for (const tag of tags) {
    const key = `${id}+${tag}`;
    lines.push(row(`${id} + ${tag}`, 6, run([{ id, severity: 6, where: tag }]), NEW_ROUTES.has(key) ? "NEW route (sign-off)" : "default move + note"));
  }
}
lines.push("");
lines.push("## Legacy ids, for reference (byte-frozen; severity 6)");
lines.push("");
lines.push(HEAD);
for (const id of Object.keys(LEGACY_TO_V3)) {
  const m = LEGACY_TO_V3[id];
  lines.push(row(id, 6, run([{ id, severity: 6 }]), `frozen; reads as ${m.id}${m.where ? ` + ${m.where}` : ""}`));
}
lines.push("");
lines.push("## Legacy tags on the v3 ids (severity 6)");
lines.push("");
lines.push("The four v2 location tags still route on the inherited rows exactly as they did on the legacy ids.");
lines.push("");
lines.push(HEAD);
for (const [id, tag] of [["harsh_small_bumps", "landings"], ["harsh_small_bumps", "corners"], ["harsh_small_bumps", "whoops"], ["bottoming", "whoops"], ["deflects", "braking"], ["front_pushes", "corners"]]) {
  lines.push(row(`${id} + ${tag}`, 6, run([{ id, severity: 6, where: tag }]), INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)"));
}
lines.push("");
await Deno.writeTextFile("docs/symptom-table-draft.md", lines.join("\n"));
console.log(`wrote docs/symptom-table-draft.md (${lines.length} lines)`);
