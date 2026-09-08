// The llm-mode leg of the spend cap (research 2026-09-07, item 14): the
// module reads OPENAI_API_KEY at load, so this file sets it BEFORE importing
// the engine and stubs fetch to answer OpenAI's 429 spend-limit body. The
// formula's numbers ship tagged engine_source "spend_limited" with the
// "Tuning is paused" note, and the request is still recorded.
Deno.env.set("AI_TUNE_TEST", "1");
Deno.env.set("OPENAI_API_KEY", "sk-test-spend-limit");
import { assert, assertEquals } from "jsr:@std/assert@1";
const engine = await import("../index.ts");
const { makeHandler, formulaBaseline } = engine as any;

const GUARDRAILS = { clicks_min: 0, clicks_max: 30, hsc_turns_min: 0, hsc_turns_max: 3, sag_min_mm: 95, sag_max_mm: 112, has_air_fork: true };
const input = {
  make: "KTM",
  model: "250 SX-F",
  year: 2024,
  terrain: "mx",
  rider: { weight_lbs: 180, discipline: "mx", skill: "intermediate", style: "short_motos", goals: [] },
  has_zeroed_clickers: true,
  guardrails: GUARDRAILS,
  wants_air_fork: true,
};
const deps = (over: Record<string, unknown> = {}) => ({
  getUserId: () => Promise.resolve(null),
  countRecentCalls: () => Promise.resolve(0),
  recordCall: () => Promise.resolve(11),
  recordOutput: () => Promise.resolve(),
  parseFreeText: () => Promise.resolve(null),
  modelExists: () => Promise.resolve(true),
  claimBaseline: () => Promise.resolve({ ok: true, reason: "pro" }),
  refundClaim: () => Promise.resolve(),
  baselineEngine: () => Promise.resolve("llm"),
  explain: () => Promise.resolve(null),
  refineAllowance: () => Promise.resolve({ entitled: true, used: 0, free: 1, remaining: 1 }),
  ...over,
});
const req = (body: unknown) =>
  new Request("http://local/ai-tune", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(body) });

Deno.test("llm mode: OpenAI's spend-limit 429 ships the formula tagged spend_limited with the paused note", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    calls.push(u);
    if (u.includes("api.openai.com")) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Project spend limit exceeded", type: "insufficient_quota", code: "project_spend_limit_exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return realFetch(url as any, init);
  }) as typeof fetch;
  try {
    const formula = formulaBaseline(input);
    const metas: any[] = [];
    const h = makeHandler(deps({ recordOutput: (_id: number, _out: unknown, meta: unknown) => { metas.push(meta); return Promise.resolve(); } }));
    const res = await h(req({ mode: "zero_baseline_v1", input }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(calls.some((c) => c.includes("api.openai.com")), "the model was called");
    assertEquals(body.engine_source, "spend_limited");
    assertEquals(body.notes_source, "formula");
    assertEquals(body.fork.comp_clicks, formula.partial.fork.comp_clicks);
    assertEquals(body.shock.lsc_clicks, formula.partial.shock.lsc_clicks);
    assert(body.notes.some((n: string) => n.startsWith("Tuning is paused")));
    assertEquals(metas[0].engine_source, "spend_limited");

    // A 429 that is a plain rate limit is still the generic fallback.
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("api.openai.com")) return Promise.resolve(new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), { status: 429 }));
      return realFetch(url as any, init);
    }) as typeof fetch;
    const b2 = await (await makeHandler(deps())(req({ mode: "zero_baseline_v1", input }))).json();
    assertEquals(b2.engine_source, "fallback_error");
    assert(b2.notes.some((n: string) => n.startsWith("AI fallback used")));
  } finally {
    globalThis.fetch = realFetch;
  }
});
