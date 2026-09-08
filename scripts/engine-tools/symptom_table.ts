// @ts-nocheck — Deno script (engine tooling), not part of the app build
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

// Research 2026-09-07 (docs/open-questions-resolution-2026-09-07.md, item 11):
// what published tuner guidance (Vital MX, Click Suspension, Race Tech,
// Teknik, MXA, as compiled in the 2026-09-07 research report, Section 9) says
// about each row. "agree" = same direction on the circuits both name;
// "disagree" = opposite direction on a named circuit; "partial" = agrees on
// one circuit and names a different one for the other; "silent" = the report
// has no guidance for that symptom or qualifier. River's call stands on all.
const RESEARCH: Record<string, string> = {
  harsh_small_bumps: "agree: arm pump or harsh small chop, soften low-speed compression and lower air pressure; the report is silent on rebound",
  bottoming: "agree: bottoming rear, add HSC or preload; bottoming front, add compression or air or oil height. The report separates the ends, which supports question 1.5 (ask which end)",
  rear_kicks: "ambiguous: rear kicking on square edges is often too STIFF (soften HSC an eighth to a quarter turn) or bottoming if too soft, determine which; on whoops kicking usually means too soft, on small chop usually too stiff. Our default slows shock rebound, which the report names only for braking bumps. Supports the qualifier design",
  front_pushes: "silent on suspension: the report's only push guidance is tire pressure in tacky mud",
  packs_in_chop: "agree: packing means rebound too slow, speed it up",
  wallows_dives: "agree on the fork: wallowing or diving front means insufficient compression (or rebound), increase fork compression and check sag; silent on the shock LSC click",
  headshake: "disagree in part: headshake or deflection, increase fork rebound damping 2 clicks at a time (slower, which agrees with our fork move) and check fork height and sag; the report does not name shock rebound",
  rear_swaps: "ambiguous: the report treats swapping with kicking (too stiff on chop, soften HSC; too soft in whoops). Our softer LSC agrees with the too-stiff reading; the report names HSC rather than LSC and does not name rebound",
  deflects: "agree: deflection, increase fork rebound damping 2 clicks at a time (slower)",
  rear_squats: "agree: rear squatting on acceleration, increase low-speed compression and check sag",
  too_stiff: "agree: harshness on small bumps, reduce compression (and the report adds slightly faster rebound, which we leave alone)",
  too_soft: "agree by inference: heavier or faster riders take more compression and stiffer springs; the report has no too-soft row of its own",
  arm_pump: "agree on compression and air (soften low-speed compression, lower air pressure, lower oil height); silent on the rebound click",
  chatters: "partial: chatter or harshness on small bumps, reduce compression (agrees) and slightly FASTER rebound (our row slows it). Direction on rebound is the open call",
  "harsh_small_bumps+big_hits": "agree: harsh on big hits is bottoming; front add compression or air, rear add HSC",
  "rear_kicks+jump_face": "agree in spirit: kicking on jump faces and whoops usually means too soft, so holding the rear up with HSC matches",
  "rear_kicks+braking_bumps": "partial: rear kicking under braking bumps, slow rebound slightly or soften compression; the report reads it as the rear's rebound, our route slows the FORK rebound on top of the shock move",
  "rear_kicks+logs_ledges": "silent",
  "packs_in_chop+rocks": "silent on the extra compression click; agrees on faster rebound",
  "packs_in_chop+whoops": "agree: faster rebound",
  "harsh_small_bumps+small_chop": "agree: soften low-speed compression, lower air",
  "harsh_small_bumps+under_braking": "agree: soften compression; the report also names slower rebound for front diving under braking, which we do not touch here",
};
const research = (key: string, id: string) => RESEARCH[key] ?? RESEARCH[id] ?? "silent";

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
const row = (label: string, sev: number | string, r: ReturnType<typeof run>, authorship: string, note = "") =>
  `| ${label} | ${sev} | ${f(r.deltas.fork_comp)} | ${f(r.deltas.fork_reb)} | ${f(r.deltas.fork_air)} | ${f(r.deltas.shock_lsc)} | ${f(r.deltas.shock_hsc)} | ${f(r.deltas.shock_reb)} | ${authorship} | ${note} | ${r.notes.map((n) => n.replace(/\|/g, "/")).join(" ⏎ ")} |`;
const HEAD = "| Symptom | Severity | Fork comp | Fork reb | Fork air (bar) | Shock LSC | Shock HSC (turns) | Shock reb | Authorship | Research 2026-09-07 | Engine notes |\n|---|---|---|---|---|---|---|---|---|---|---|";

const lines: string[] = [];
lines.push("# Symptom table draft (contract v3, for River's review)");
lines.push("");
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} by scripts/engine-tools/symptom_table.ts from the engine on feat/engine-contract-v3. Every row is the engine's actual answer for that symptom alone, on an air-fork previous tune of fork 14 / 12 at 10.6 bar and shock LSC 12, HSC 1.5, rebound 14, sag 103, overall rating 6 (global scale 1.0). Deltas are clicks out from closed (positive = softer or faster), bar for air, turns for HSC. Severity 3 / 6 / 9 are the regression suite's mild / moderate / bad. "Inherited from X" means the row mirrors the byte-frozen legacy row X; "NEW" means authored on 2026-09-05 and awaiting correction. Sag never moves.`);
lines.push("");
lines.push("How to review: change the numbers or the direction in this file (or say so in the PR); the PR then implements the corrected table and its tests. Rows you leave alone ship as shown.");
lines.push("");
lines.push("The \"Research 2026-09-07\" column says what published tuner guidance (Vital MX, Click Suspension, Race Tech, Teknik, MXA, compiled in the 2026-09-07 research report, Section 9) says about the row: agree, disagree, partial, ambiguous, or silent. It annotates; it changes nothing. The rear-kicks rows are the clearest case for the qualifiers: the report reads kicking as too stiff on chop and too soft in whoops.");
lines.push("");
lines.push("## The 14 ids at three severities");
lines.push("");
lines.push(HEAD);
for (const id of V3_SYMPTOM_IDS) {
  const authorship = INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)";
  for (const sev of SEVERITIES) lines.push(row(id, sev, run([{ id, severity: sev }]), authorship, research(id, id)));
}
lines.push("");
lines.push("## Qualifier pairs (severity 6)");
lines.push("");
lines.push("The three chips with a mandatory qualifier. A route marked NEW changes the move; the others keep the chip's default move and only mention the location in the note.");
lines.push("");
lines.push(HEAD);
for (const [id, tags] of Object.entries(QUALIFIERS)) {
  lines.push(row(`${id} (no qualifier)`, 6, run([{ id, severity: 6 }]), INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)", research(id, id)));
  for (const tag of tags) {
    const key = `${id}+${tag}`;
    lines.push(row(`${id} + ${tag}`, 6, run([{ id, severity: 6, where: tag }]), NEW_ROUTES.has(key) ? "NEW route (sign-off)" : "default move + note", research(key, id)));
  }
}
lines.push("");
lines.push("## Legacy ids, for reference (byte-frozen; severity 6)");
lines.push("");
lines.push(HEAD);
for (const id of Object.keys(LEGACY_TO_V3)) {
  const m = LEGACY_TO_V3[id];
  lines.push(row(id, 6, run([{ id, severity: 6 }]), `frozen; reads as ${m.id}${m.where ? ` + ${m.where}` : ""}`, "frozen row; see its v3 twin"));
}
lines.push("");
lines.push("## Legacy tags on the v3 ids (severity 6)");
lines.push("");
lines.push("The four v2 location tags still route on the inherited rows exactly as they did on the legacy ids.");
lines.push("");
lines.push(HEAD);
for (const [id, tag] of [["harsh_small_bumps", "landings"], ["harsh_small_bumps", "corners"], ["harsh_small_bumps", "whoops"], ["bottoming", "whoops"], ["deflects", "braking"], ["front_pushes", "corners"]]) {
  lines.push(row(`${id} + ${tag}`, 6, run([{ id, severity: 6, where: tag }]), INHERITED[id] ? `inherited from ${INHERITED[id]}` : "NEW (sign-off)", research(`${id}+${tag}`, id)));
}
lines.push("");
await Deno.writeTextFile("docs/symptom-table-draft.md", lines.join("\n"));
console.log(`wrote docs/symptom-table-draft.md (${lines.length} lines)`);
