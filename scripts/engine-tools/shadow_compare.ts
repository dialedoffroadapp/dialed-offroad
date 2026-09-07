// @ts-nocheck — Deno script (session eval tooling), not part of the app build
// scripts/engine-tools/shadow_compare.ts
// The PERMANENT regression script for the deterministic baseline (decision 1,
// 2026-09-07; born as the decision-8 shadow comparison): replays every
// captured baseline call through the formula and reports it against the
// shipped gpt-4o-mini output, the formula's own distribution by rider weight
// band and skill, and every input that lands on a formula clamp (decision 2).
// Each captured input is replayed through the REAL handler with no
// OPENAI_API_KEY, so buildFallback → safeShape runs exactly as the fallback
// would in production (fork type per today's rule: catalog flag, else the
// rider's toggle), and the result is compared per circuit to the captured
// output. Writes results/shadow-<date>.md and .json.
//
// Usage: deno run --allow-env --allow-read --allow-write scripts/engine-tools/shadow_compare.ts
// Requires results/captured_baselines.json (scripts/engine-tools/pull_captured.sh);
// results/ is gitignored (it holds rider free text).

Deno.env.set("AI_TUNE_TEST", "1");
Deno.env.delete("OPENAI_API_KEY"); // the formula, never the model

const { makeHandler, formulaBaseline } = await import("../../supabase/functions/ai-tune/index.ts");
const here = new URL(".", import.meta.url).pathname;
const rows = JSON.parse(await Deno.readTextFile(`${here}results/captured_baselines.json`));

const handler = makeHandler({
  getUserId: () => Promise.resolve(null),
  countRecentCalls: () => Promise.resolve(0),
  recordCall: () => Promise.resolve(null),
  parseFreeText: () => Promise.resolve(null),
  modelExists: () => Promise.resolve(true),
  claimBaseline: () => Promise.resolve({ ok: true, reason: "pro" }),
  refundClaim: () => Promise.resolve(),
  baselineEngine: () => Promise.resolve("llm"),
  explain: () => Promise.resolve(null),
});

type Circuit = "fork_comp" | "fork_reb" | "shock_lsc" | "shock_hsc" | "shock_reb" | "shock_sag" | "fork_air";
const CIRCUITS: Circuit[] = ["fork_comp", "fork_reb", "shock_lsc", "shock_hsc", "shock_reb", "shock_sag", "fork_air"];
const pick = (r: any): Record<Circuit, number | null> => ({
  fork_comp: r?.fork?.comp_clicks ?? null,
  fork_reb: r?.fork?.reb_clicks ?? null,
  shock_lsc: r?.shock?.lsc_clicks ?? null,
  shock_hsc: r?.shock?.hsc_turns ?? null,
  shock_reb: r?.shock?.reb_clicks ?? null,
  shock_sag: r?.shock?.sag_mm ?? null,
  fork_air: typeof r?.fork?.air_pressure_bar === "number" ? r.fork.air_pressure_bar : null,
});
// "Close enough to be the same call": one click, a tenth of a turn, a tenth of a bar, two mm.
const TOL: Record<Circuit, number> = { fork_comp: 1, fork_reb: 1, shock_lsc: 1, shock_hsc: 0.1, shock_reb: 1, shock_sag: 2, fork_air: 0.1 };

const runs: any[] = [];
for (const row of rows) {
  const req = new Request("http://local/ai-tune", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ mode: "zero_baseline_v1", input: row.input }),
  });
  const resp = await handler(req);
  if (resp.status !== 200) {
    runs.push({ id: row.id, error: `HTTP ${resp.status}` });
    continue;
  }
  const formula = pick(await resp.json());
  const llm = pick(row.output);
  const fb = formulaBaseline(row.input);
  const diffs: Partial<Record<Circuit, number>> = {};
  for (const c of CIRCUITS) {
    if (typeof formula[c] === "number" && typeof llm[c] === "number") diffs[c] = Math.round((llm[c]! - formula[c]!) * 100) / 100;
  }
  runs.push({
    id: row.id,
    skill: row.input?.rider?.skill ?? "unknown",
    style: row.input?.rider?.style ?? "unknown",
    air: typeof llm.fork_air === "number",
    formula_air: typeof formula.fork_air === "number",
    spec_flag: row.input?.guardrails?.has_air_fork ?? null,
    weight: row.input?.rider?.weight_lbs ?? null,
    sag_target: typeof row.input?.guardrails?.sag_target_mm === "number" ? row.input.guardrails.sag_target_mm : null,
    discipline: fb.discipline,
    clampHits: fb.clampHits,
    formula,
    llm,
    diffs,
  });
}

/* ------------------------------- stats ------------------------------- */
const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
  return s[i];
};
const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");
function statsFor(subset: any[], c: Circuit) {
  const xs = subset.map((r) => r.diffs?.[c]).filter((x) => typeof x === "number") as number[];
  if (!xs.length) return null;
  const tol = TOL[c];
  return {
    n: xs.length,
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    p10: q(xs, 0.1),
    median: q(xs, 0.5),
    p90: q(xs, 0.9),
    equal: xs.filter((x) => Math.abs(x) < 1e-9).length / xs.length,
    within: xs.filter((x) => Math.abs(x) <= tol + 1e-9).length / xs.length,
    llm_softer: xs.filter((x) => x > 1e-9).length / xs.length, // more clicks out / more bar / more sag
    llm_firmer: xs.filter((x) => x < -1e-9).length / xs.length,
  };
}
function table(subset: any[], title: string): string {
  const lines = [
    `### ${title} (n = ${subset.length})`,
    "",
    "| Circuit | n | mean (LLM minus formula) | p10 | median | p90 | exactly equal | within tolerance | LLM higher | LLM lower |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const c of CIRCUITS) {
    const s = statsFor(subset, c);
    if (!s) continue;
    lines.push(`| ${c} | ${s.n} | ${fmt(s.mean)} | ${fmt(s.p10)} | ${fmt(s.median)} | ${fmt(s.p90)} | ${(s.equal * 100).toFixed(0)}% | ${(s.within * 100).toFixed(0)}% (±${TOL[c]}) | ${(s.llm_higher_pct ?? s.llm_softer * 100).toFixed(0)}% | ${(s.llm_firmer * 100).toFixed(0)}% |`);
  }
  return lines.join("\n");
}
const ok = runs.filter((r) => !r.error);
const errors = runs.filter((r) => r.error);
const airRows = ok.filter((r) => r.air);
const coilRows = ok.filter((r) => !r.air);
const bySkill = (s: string) => ok.filter((r) => r.skill === s);
const forkMismatch = ok.filter((r) => r.air !== r.formula_air);

const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: "under 150 lb", lo: 0, hi: 149 },
  { label: "150 to 169 lb", lo: 150, hi: 169 },
  { label: "170 to 189 lb", lo: 170, hi: 189 },
  { label: "190 to 209 lb", lo: 190, hi: 209 },
  { label: "210 lb and up", lo: 210, hi: 10_000 },
];
function distTable(subset: any[], title: string): string[] {
  const lines = [`### ${title} (n = ${subset.length})`, ``, `| Circuit | formula p10 / median / p90 | LLM median | inputs at a clamp |`, `|---|---|---|---|`];
  for (const c of CIRCUITS) {
    const f = subset.map((r) => r.formula[c]).filter((x) => typeof x === "number") as number[];
    const l = subset.map((r) => r.llm[c]).filter((x) => typeof x === "number") as number[];
    if (!f.length) continue;
    lines.push(`| ${c} | ${fmt(q(f, 0.1))} / ${fmt(q(f, 0.5))} / ${fmt(q(f, 0.9))} | ${l.length ? fmt(q(l, 0.5)) : "n/a"} | ${subset.filter((r) => r.clampHits.includes(c)).length} |`);
  }
  lines.push(``);
  return lines;
}
function bandTables(): string[] {
  const out: string[] = [];
  for (const b of BANDS) out.push(...distTable(ok.filter((r) => typeof r.weight === "number" && r.weight >= b.lo && r.weight <= b.hi), `Weight ${b.label}`));
  out.push(...distTable(ok.filter((r) => typeof r.weight !== "number"), "Weight not given"));
  return out;
}
function skillTables(): string[] {
  const out: string[] = [];
  for (const s of ["beginner", "intermediate", "pro"]) out.push(...distTable(ok.filter((r) => r.skill === s), `Skill: ${s}`));
  return out;
}

const date = new Date().toISOString().slice(0, 10);
const md = [
  `# Shadow comparison: deterministic formula vs shipped gpt-4o-mini output`,
  ``,
  `Generated ${date} by scripts/llm-eval/shadow_compare.ts over results/captured_baselines.json (${rows.length} captured zero_baseline_v1 calls with input and output, dev-3-0 clone of production). Each captured input was replayed offline through the real handler with no OpenAI key, so the formula path (buildFallback then safeShape, fork type by catalog flag or rider toggle) produced the "formula" tune; the captured output is what the model shipped. Differences are LLM minus formula: positive = the model chose more clicks out (softer or faster), more bar, or more sag than the formula. "Within tolerance" counts differences of at most one click, a tenth of a turn, a tenth of a bar, or two mm.`,
  ``,
  `Replayed: ${ok.length}. Errors: ${errors.length}. Rows where the model shipped air but today's rule says coil (or the reverse): ${forkMismatch.length} (air compared only where both sides have it).`,
  ``,
  table(ok, "All captured baselines"),
  ``,
  table(airRows, "Air-fork tunes (model output carried air)"),
  ``,
  table(coilRows, "Coil-fork tunes"),
  ``,
  ...["beginner", "intermediate", "pro"].flatMap((s) => [table(bySkill(s), `Skill: ${s}`), ``]),
  `## Value distributions`,
  ``,
  `| Circuit | formula p10 / median / p90 | LLM p10 / median / p90 |`,
  `|---|---|---|`,
  ...CIRCUITS.map((c) => {
    const f = ok.map((r) => r.formula[c]).filter((x) => typeof x === "number") as number[];
    const l = ok.map((r) => r.llm[c]).filter((x) => typeof x === "number") as number[];
    if (!f.length || !l.length) return `| ${c} | n/a | n/a |`;
    return `| ${c} | ${fmt(q(f, 0.1))} / ${fmt(q(f, 0.5))} / ${fmt(q(f, 0.9))} | ${fmt(q(l, 0.1))} / ${fmt(q(l, 0.5))} / ${fmt(q(l, 0.9))} |`;
  }),
  ``,
  `## The formula's own distribution (decision 2): by rider weight band`,
  ``,
  `Formula p10 / median / p90 per circuit, with the LLM median beside it. This is what deterministic-first will ship for each band.`,
  ``,
  ...bandTables(),
  `## The formula's own distribution: by skill`,
  ``,
  ...skillTables(),
  `## Inputs that land on a formula clamp (decision 2)`,
  ``,
  `A circuit is flagged when the formula's answer sits exactly on its floor or ceiling (fork 6 to 24, shock LSC 6 to 20, shock rebound 8 to 22, HSC 0.75 to 2.0, the sag window's edge away from the target, air at the discipline window). Inputs flagged: ${ok.filter((r) => r.clampHits.length).length} of ${ok.length}.`,
  ``,
  `| Circuit | inputs at the clamp |`,
  `|---|---|`,
  ...CIRCUITS.map((c) => `| ${c} | ${ok.filter((r) => r.clampHits.includes(c)).length} |`),
  ``,
  `| id | weight | skill | style | discipline | air | circuits at the clamp | formula value |`,
  `|---|---|---|---|---|---|---|---|`,
  ...ok.filter((r) => r.clampHits.length).slice(0, 80).map((r) => `| ${r.id} | ${r.weight ?? "?"} | ${r.skill} | ${r.style} | ${r.discipline} | ${r.formula_air ? "air" : "coil"} | ${r.clampHits.join(", ")} | ${r.clampHits.map((c: Circuit) => `${c}=${r.formula[c]}`).join(" ")} |`),
  ``,
  `## Anchoring on the prompt's example values`,
  ``,
  `The baseline prompt ends with an example JSON (fork 12 / 12, air 10.6, shock LSC 12, HSC 1.5, rebound 14, sag 105). How often each side returned exactly that number. The formula's sag equals the per-model target it was sent, which is 105 on most catalog rows, so its sag column is coincidence, not anchoring.`,
  ``,
  `| Circuit | example value | LLM equals example | formula equals example | LLM equals sent sag target |`,
  `|---|---|---|---|---|`,
  ...CIRCUITS.map((c) => {
    const EXAMPLE: Record<Circuit, number> = { fork_comp: 12, fork_reb: 12, fork_air: 10.6, shock_lsc: 12, shock_hsc: 1.5, shock_reb: 14, shock_sag: 105 };
    const l = ok.filter((r) => typeof r.llm[c] === "number");
    const f = ok.filter((r) => typeof r.formula[c] === "number");
    const eq = (xs: any[], side: "llm" | "formula") => (xs.length ? ((xs.filter((r) => Math.abs(r[side][c] - EXAMPLE[c]) < 1e-9).length / xs.length) * 100).toFixed(0) + "%" : "n/a");
    const target = c === "shock_sag"
      ? (() => { const t = ok.filter((r) => typeof r.sag_target === "number"); return t.length ? ((t.filter((r) => r.llm.shock_sag === r.sag_target).length / t.length) * 100).toFixed(0) + "%" : "n/a"; })()
      : "";
    return `| ${c} | ${EXAMPLE[c]} | ${eq(l, "llm")} (n=${l.length}) | ${eq(f, "formula")} (n=${f.length}) | ${target} |`;
  }),
  ``,
  `## Weight sensitivity (does either side move with rider weight?)`,
  ``,
  `| Circuit | corr(weight, formula) | corr(weight, LLM) |`,
  `|---|---|---|`,
  ...CIRCUITS.map((c) => {
    const pairs = ok.filter((r) => typeof r.weight === "number" && typeof r.formula[c] === "number" && typeof r.llm[c] === "number");
    const corr = (xs: number[], ys: number[]) => {
      const n = xs.length; if (n < 3) return NaN;
      const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
    };
    const w = pairs.map((r) => r.weight);
    return `| ${c} | ${fmt(corr(w, pairs.map((r) => r.formula[c])))} | ${fmt(corr(w, pairs.map((r) => r.llm[c])))} |`;
  }),
  ``,
].join("\n");

await Deno.writeTextFile(`${here}results/shadow-${date}.md`, md);
await Deno.writeTextFile(`${here}results/shadow-${date}.json`, JSON.stringify({ date, runs }, null, 2));
console.log(md);
console.log(`\nwrote results/shadow-${date}.md and .json`);
