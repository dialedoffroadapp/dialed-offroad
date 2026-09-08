// Second report (2026-09-07): BFRC turns shock (section 4) and the capped
// weight slope plus skill offset behind app_config (sub-task 2).
Deno.env.set("AI_TUNE_TEST", "1");
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildTuneTwo, classStepsFor, ENGINE_TUNING_DEFAULTS, formulaBaseline, makeHandler, safeShape, safeShapeSparse, type HandlerDeps } from "../index.ts";

const G = { clicks_min: 0, clicks_max: 30, hsc_turns_min: 0, hsc_turns_max: 3, sag_min_mm: 95, sag_max_mm: 112, has_air_fork: false };
const BFRC = { ...G, shock_adjust_unit: "turns" as const, has_shock_hsc: false };
const rider = (over: Record<string, unknown> = {}) => ({ weight_lbs: 180, skill: "intermediate", style: "short_motos", goals: [], ...over });
const base = (over: Record<string, unknown> = {}) => ({ terrain: "mx", rider: rider(), has_zeroed_clickers: true, guardrails: G, ...over });

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getUserId: () => Promise.resolve("user-123"),
    countRecentCalls: () => Promise.resolve(0),
    recordCall: () => Promise.resolve(),
    parseFreeText: () => Promise.resolve(null),
    modelExists: () => Promise.resolve(true),
    claimBaseline: () => Promise.resolve({ ok: true, reason: "pro" }),
    refundClaim: () => Promise.resolve(),
    baselineEngine: () => Promise.resolve("deterministic" as const),
    explain: () => Promise.resolve(null),
    refineAllowance: () => Promise.resolve({ entitled: true, used: 0, free: 1, remaining: 1 }),
    ...overrides,
  };
}
const req = (body: unknown) => new Request("http://local/ai-tune", { method: "POST", headers: { Authorization: "Bearer fake", "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" }, body: JSON.stringify(body) });

Deno.test("BFRC baseline: shock LSC and rebound in quarter turns, no HSC; the shape keeps the null", () => {
  const f = formulaBaseline(base({ guardrails: BFRC }) as any);
  const shock = f.partial.shock!;
  assertEquals(shock.hsc_turns, null);
  assert(typeof shock.lsc_clicks === "number" && shock.lsc_clicks * 4 === Math.round(shock.lsc_clicks * 4), `lsc ${shock.lsc_clicks}`);
  assert(typeof shock.reb_clicks === "number" && shock.reb_clicks * 4 === Math.round(shock.reb_clicks * 4), `reb ${shock.reb_clicks}`);
  assert(shock.lsc_clicks! <= 4 && shock.reb_clicks! <= 4);
  const shaped = safeShape(f.partial, BFRC);
  assertEquals(shaped.shock.hsc_turns, null);
  assertEquals(shaped.shock.lsc_clicks, shock.lsc_clicks);
  // A clicks shock is untouched: integers, HSC present.
  const g = formulaBaseline(base() as any);
  assert(Number.isInteger(g.partial.shock!.lsc_clicks));
  assert(typeof g.partial.shock!.hsc_turns === "number");
});

Deno.test("BFRC refinement: a click delta lands as a quarter turn, values snap to quarters, HSC stays null", () => {
  const prev = { fork: { comp_clicks: 14, reb_clicks: 12 }, shock: { lsc_clicks: 2.5, hsc_turns: null, reb_clicks: 3, sag_mm: 103 }, notes: [] };
  const out = safeShapeSparse(buildTuneTwo({ terrain: "mx", rider: rider(), previous: prev as any, feedback: { overall_rating: 6, symptoms: [{ id: "rear_squats", severity: 6 }] }, guardrails: BFRC } as any), BFRC);
  // rear_squats at 6 = -1 shock LSC (firmer) on a clicks shock; a quarter turn here.
  assertEquals(out.shock.lsc_clicks, 2.25);
  assertEquals(out.shock.hsc_turns, null);
  assertEquals(out.shock.reb_clicks, 3);
  const kick = safeShapeSparse(buildTuneTwo({ terrain: "mx", rider: rider(), previous: prev as any, feedback: { overall_rating: 6, symptoms: [{ id: "rear_kicks", severity: 6 }] }, guardrails: BFRC } as any), BFRC);
  assertEquals(kick.shock.reb_clicks, 2.5); // -2 clicks = -0.5 turn
  assertEquals(kick.shock.hsc_turns, null);
  // rear_squats at 9 asks for HSC too: no HSC value appears on a BFRC shock.
  const bad = safeShapeSparse(buildTuneTwo({ terrain: "mx", rider: rider(), previous: prev as any, feedback: { overall_rating: 4, symptoms: [{ id: "rear_squats", severity: 9 }] }, guardrails: BFRC } as any), BFRC);
  assertEquals(bad.shock.hsc_turns, null);
});

Deno.test("BFRC through the handler: both modes answer turns and a null HSC", async () => {
  const h = makeHandler(deps());
  const b = await (await h(req({ mode: "zero_baseline_v1", input: base({ guardrails: BFRC }) }))).json();
  assertEquals(b.shock.hsc_turns, null);
  assert(b.shock.lsc_clicks * 4 === Math.round(b.shock.lsc_clicks * 4));
  const prev = { fork: { comp_clicks: 14, reb_clicks: 12 }, shock: { lsc_clicks: 2.5, hsc_turns: null, reb_clicks: 3, sag_mm: 103 }, notes: [] };
  const r = await (await h(req({ mode: "tune2_v1", input: { ...base({ guardrails: BFRC }), previous: prev, feedback: { overall_rating: 6, symptoms: [{ id: "rear_squats", severity: 6 }] } } }))).json();
  assertEquals(r.shock.lsc_clicks, 2.25);
  assertEquals(r.shock.hsc_turns, null);
});

Deno.test("skill offset: class steps C to B to A firm compression 2 clicks and rebound 1 per step; novice = C; derived from skill when absent", () => {
  assertEquals(classStepsFor({ rider: { skill: "beginner" } }), 0);
  assertEquals(classStepsFor({ rider: { skill: "intermediate" } }), 0);
  assertEquals(classStepsFor({ rider: { skill: "pro" } }), 2);
  assertEquals(classStepsFor({ rider: { skill: "intermediate", class: "b" } }), 1);
  assertEquals(classStepsFor({ rider: { skill: "intermediate", class: "novice" } }), 0);
  const c = formulaBaseline(base({ rider: rider({ class: "c" }) }) as any).partial;
  const b = formulaBaseline(base({ rider: rider({ class: "b" }) }) as any).partial;
  const a = formulaBaseline(base({ rider: rider({ class: "a" }) }) as any).partial;
  assertEquals(c.fork!.comp_clicks - b.fork!.comp_clicks, 2);
  assertEquals(c.fork!.reb_clicks - b.fork!.reb_clicks, 1);
  assertEquals(c.shock!.lsc_clicks - b.shock!.lsc_clicks, 2);
  assertEquals(c.shock!.reb_clicks - b.shock!.reb_clicks, 1);
  assertEquals(b.fork!.comp_clicks - a.fork!.comp_clicks, 2);
  assertEquals(ENGINE_TUNING_DEFAULTS, { weight_slope_cap_clicks: 3, weight_slope_cap_hsc_quarter_turns: 2, skill_offset_comp_per_step: -2, skill_offset_reb_per_step: -1 });
  // Follow-up (2026-09-08): the intensity term carries no skill any more, so
  // beginner (novice) and intermediate (C) are the same tune at the same
  // weight and style, and a pro differs from a C rider by the offset alone.
  const beginner = formulaBaseline(base({ rider: rider({ skill: "beginner" }) }) as any).partial;
  const inter = formulaBaseline(base({ rider: rider({ skill: "intermediate" }) }) as any).partial;
  const pro = formulaBaseline(base({ rider: rider({ skill: "pro" }) }) as any).partial;
  assertEquals(beginner.fork, inter.fork);
  assertEquals(beginner.shock, inter.shock);
  assertEquals(inter.fork!.comp_clicks - pro.fork!.comp_clicks, 4);
  assertEquals(inter.fork!.reb_clicks - pro.fork!.reb_clicks, 2);
  assertEquals(inter.shock!.hsc_turns, pro.shock!.hsc_turns); // the offset moves clicks only
});

Deno.test("weight cap: the slope's contribution stops at the cap; app_config keys override the defaults", async () => {
  // 185 lb is the slope's zero; the engine's weight input tops out at 260 lb,
  // where the fork comp term is 7.5 * 0.4 = 3.0 clicks: exactly the default cap.
  const mid = formulaBaseline(base({ rider: rider({ weight_lbs: 185 }) }) as any).partial;
  const heavy = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any).partial;
  assertEquals(mid.fork!.comp_clicks - heavy.fork!.comp_clicks, 3);
  const tight = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any, { ...ENGINE_TUNING_DEFAULTS, weight_slope_cap_clicks: 1 }).partial;
  assertEquals(mid.fork!.comp_clicks - tight.fork!.comp_clicks, 1);
  assertEquals(mid.shock!.lsc_clicks - tight.shock!.lsc_clicks, 1);
  const none = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any, { ...ENGINE_TUNING_DEFAULTS, weight_slope_cap_clicks: 0 }).partial;
  assertEquals(none.fork!.comp_clicks, mid.fork!.comp_clicks);
  // Through the handler: a config cap of 0 makes weight a no-op on the clickers.
  const h = makeHandler(deps({ engineTuning: () => Promise.resolve({ weight_slope_cap_clicks: 0, skill_offset_comp_per_step: 0, skill_offset_reb_per_step: 0 }) }));
  const light = await (await h(req({ mode: "zero_baseline_v1", input: base({ rider: rider({ weight_lbs: 140 }) }) }))).json();
  const heavyH = await (await h(req({ mode: "zero_baseline_v1", input: base({ rider: rider({ weight_lbs: 260 }) }) }))).json();
  assertEquals(light.fork.comp_clicks, heavyH.fork.comp_clicks);
  assertEquals(light.shock.lsc_clicks, heavyH.shock.lsc_clicks);
});

Deno.test("HSC weight cap: the turn-scale weight term stops at the quarter-turn cap; a cap of 0 makes weight a no-op on HSC", () => {
  const mid = formulaBaseline(base({ rider: rider({ weight_lbs: 185 }) }) as any).partial.shock!;
  const heavy = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any).partial.shock!;
  // 7.5 * 0.03 = 0.225 turns at the engine's 260 lb ceiling: under the default 0.5 turn cap.
  assertEquals(Number(((mid.hsc_turns as number) - (heavy.hsc_turns as number)).toFixed(2)), 0.23);
  const tight = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any, { ...ENGINE_TUNING_DEFAULTS, weight_slope_cap_hsc_quarter_turns: 0 }).partial.shock!;
  assertEquals(tight.hsc_turns, mid.hsc_turns);
  // Half a quarter turn of cap (0.125 turn): 1.4 base, 0.125 weight, 0.025 style = 1.25.
  const half = formulaBaseline(base({ rider: rider({ weight_lbs: 260 }) }) as any, { ...ENGINE_TUNING_DEFAULTS, weight_slope_cap_hsc_quarter_turns: 0.5 }).partial.shock!;
  assertEquals(half.hsc_turns, 1.25);
});
