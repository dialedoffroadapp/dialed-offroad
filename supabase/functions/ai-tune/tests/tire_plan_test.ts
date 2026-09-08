// Tire pressure as an engine output (2026-09-07): the edge's port over the
// server table, its parity with the client's lib/tirePlanCore.ts over a case
// grid, the input sanitizer, the psi sanitizer on the explanation, and the
// handler end to end in both modes.
Deno.env.set("AI_TUNE_TEST", "1");
import { assert, assertEquals } from "jsr:@std/assert@1";
import { makeHandler, sanitizeTires, stripForeignPsi, surfaceFromTerrain, tirePlanFor, type HandlerDeps } from "../index.ts";
import { tirePlan, type TireTable } from "../../../../lib/tirePlanCore.ts";
import table from "../tire_defaults.json" with { type: "json" };

const T = table as TireTable;

Deno.test("tire rules: every discipline and surface, watered, rider-saved, mousse, tubliss", () => {
  const cases: [Parameters<typeof tirePlanFor>[0], number | null, number | null, string][] = [
    [{ discipline: "mx", surface: "hardpack" }, 12, 12.5, "dunlop_default"],
    [{ discipline: "mx", surface: "loam" }, 12, 12, "dunlop_default"],
    [{ discipline: "mx", surface: "sand" }, 12, 11.5, "dunlop_default"],
    [{ discipline: "mx", surface: "mud" }, 12, 10, "dunlop_default"],
    [{ discipline: "offroad", surface: "hardpack" }, 13, 14, "dunlop_default"],
    [{ discipline: "offroad", surface: "loam" }, 13, 14, "dunlop_default"],
    [{ discipline: "offroad", surface: "sand" }, 12, 12, "dunlop_default"],
    [{ discipline: "offroad", surface: "mud" }, 12, 10, "dunlop_default"],
    [{ discipline: "mx", surface: "hardpack", watered: true }, 11.5, 12, "conditions_adjusted"],
    [{ discipline: "mx", surface: "sand", savedFront: 14, savedRear: 13 }, 14, 13, "rider_saved"],
    [{ discipline: "mx", surface: "sand", savedFront: 14, savedRear: 13, psiDelta: -0.5 }, 13.5, 12.5, "conditions_adjusted"],
    [{ discipline: "mx", surface: "hardpack", systemRear: "mousse" }, 12, null, "dunlop_default"],
    [{ discipline: "offroad", surface: "loam", systemFront: "mousse", systemRear: "mousse" }, null, null, "mousse_none"],
    [{ discipline: "offroad", surface: "hardpack", systemRear: "tubliss" }, 13, 6, "dunlop_default"],
    [{ discipline: "offroad", surface: "hardpack", systemFront: "tubliss", watered: true }, 7.5, 13.5, "conditions_adjusted"],
    [{ discipline: "mx", surface: "mud", systemFront: "heavy_tube", systemRear: "heavy_tube" }, 12, 10, "dunlop_default"],
  ];
  for (const [input, front, rear, source] of cases) {
    const out = tirePlanFor(input);
    assertEquals([out.front, out.rear, out.source], [front, rear, source], JSON.stringify(input));
    assert(out.reason.length <= 200 && !out.reason.includes("—"));
  }
  assertEquals(tirePlanFor({ discipline: "offroad", surface: "loam", systemFront: "mousse", systemRear: "mousse" }).reason, "No pressure to set on a mousse. It rides like roughly 12 to 16 psi.");
  assert(tirePlanFor({ discipline: "offroad", surface: "hardpack", systemRear: "tubliss" }).reason.includes("Low pressure grips at crawl speed and gets vague at high speed."));
});

Deno.test("parity: the edge port and lib/tirePlanCore.ts agree over the case grid", () => {
  const systems = ["tube", "heavy_tube", "tubliss", "mousse", "unknown"] as const;
  let n = 0;
  for (const discipline of ["mx", "offroad", null] as const)
    for (const surface of ["hardpack", "loam", "sand", "mud", null] as const)
      for (const delta of [0, -0.5] as const)
        for (const sf of systems)
          for (const sr of systems)
            for (const saved of [null, { f: 14, r: 12 }] as const) {
              const input = { discipline, surface, psiDelta: delta, systemFront: sf, systemRear: sr, savedFront: saved?.f ?? null, savedRear: saved?.r ?? null };
              assertEquals(tirePlanFor(input), tirePlan(T, input), JSON.stringify(input));
              n++;
            }
  assertEquals(n, 3 * 5 * 2 * 5 * 5 * 2);
});

Deno.test("sanitizeTires whitelists systems and psi; nothing said = undefined", () => {
  assertEquals(sanitizeTires(undefined), undefined);
  assertEquals(sanitizeTires({}), undefined);
  assertEquals(sanitizeTires({ system_front: "unknown", system_rear: "unknown" }), undefined);
  assertEquals(sanitizeTires({ system_front: "mousse", saved_rear_psi: 12.3 }), { system_front: "mousse", system_rear: "unknown", saved_front_psi: null, saved_rear_psi: 12.5 });
  assertEquals(sanitizeTires({ system_front: "bananas", saved_front_psi: 99 }), undefined);
  assertEquals(surfaceFromTerrain("Hardpack"), "hardpack");
  assertEquals(surfaceFromTerrain("mx"), null);
});

Deno.test("stripForeignPsi drops the sentence that carries a psi the engine did not set", () => {
  const tires = { tire_front_psi: 12, tire_rear_psi: 12.5, tire_reason: "x", tire_source: "dunlop_default" as const };
  assertEquals(stripForeignPsi(["Run 12 psi front and 12.5 psi rear. Feel for the fork on the faces."], tires), ["Run 12 psi front and 12.5 psi rear. Feel for the fork on the faces."]);
  assertEquals(stripForeignPsi(["Drop to 10 psi in the rear for grip. Feel for the fork on the faces."], tires), ["Feel for the fork on the faces."]);
  assertEquals(stripForeignPsi(["Try 14 PSI up front."], tires), []);
  assertEquals(stripForeignPsi(["Try 14 PSI up front."], null), ["Try 14 PSI up front."]);
  assertEquals(stripForeignPsi(["Nothing about tires here."], tires), ["Nothing about tires here."]);
});

const GUARDRAILS = { clicks_min: 0, clicks_max: 30, hsc_turns_min: 0, hsc_turns_max: 3, sag_min_mm: 95, sag_max_mm: 112, has_air_fork: true };
const PREV = { fork: { comp_clicks: 14, reb_clicks: 12, air_pressure_bar: 10.6 }, shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 103 }, detected: { has_air_fork: true }, notes: [] };
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

Deno.test("handler: baselines carry tire fields from the terrain word and the tire systems; the explanation's foreign psi is stripped", async () => {
  const h = makeHandler(deps({ explain: () => Promise.resolve(["Built for a 180 lb intermediate on hardpack.", "Try 15 psi in the rear if it spins.", "Feel for hold-up on the faces."]) }));
  const body = await (await h(req({ mode: "zero_baseline_v1", input: { terrain: "hardpack", rider: { weight_lbs: 180, skill: "intermediate", style: "short_motos", goals: [] }, has_zeroed_clickers: true, guardrails: GUARDRAILS, wants_air_fork: true, tires: { system_front: "tube", system_rear: "mousse" } } }))).json();
  assertEquals(body.tire_front_psi, 12);
  assertEquals(body.tire_rear_psi, null);
  assertEquals(body.tire_source, "dunlop_default");
  assert(body.tire_reason.includes("Rear is a mousse"));
  assertEquals(body.notes, ["Built for a 180 lb intermediate on hardpack.", "Feel for hold-up on the faces."]);

  // No terrain word and nothing about tires: no tire fields at all.
  const b2 = await (await makeHandler(deps())(req({ mode: "zero_baseline_v1", input: { terrain: "mx", rider: { skill: "intermediate", style: "short_motos", goals: [] }, has_zeroed_clickers: true, guardrails: GUARDRAILS } }))).json();
  assertEquals(b2.tire_front_psi, undefined);
  assertEquals(b2.tire_reason, undefined);
});

Deno.test("handler: a conditions ask answers tires from the surface, watered and the saved pressure; a symptom-only refine says nothing about tires", async () => {
  const h = makeHandler(deps());
  const b1 = await (await h(req({ mode: "tune2_v1", input: { rider: { skill: "intermediate", style: "short_motos", goals: [], discipline: "offroad" }, has_zeroed_clickers: true, guardrails: GUARDRAILS, previous: PREV, feedback: { overall_rating: 5, symptoms: [], source: "conditions", free_text: "slick" }, conditions: { surfaces: ["hardpack"], state: "fresh", temp_band: "mild", watered: true }, tires: { system_front: "tube", system_rear: "tubliss", saved_front_psi: 13 } } }))).json();
  assertEquals(b1.tire_front_psi, 12.5); // saved 13, watered half out
  assertEquals(b1.tire_rear_psi, 5.5); // tubliss default 6, half out, inside 3 to 8
  assertEquals(b1.tire_source, "conditions_adjusted");
  assertEquals(b1.tire_psi_delta, -0.5);
  const b2 = await (await h(req({ mode: "tune2_v1", input: { rider: { skill: "intermediate", style: "short_motos", goals: [] }, has_zeroed_clickers: true, guardrails: GUARDRAILS, previous: PREV, feedback: { overall_rating: 6, symptoms: [{ id: "harsh_braking_bumps", severity: 7 }] } } }))).json();
  assertEquals(b2.tire_front_psi, undefined);
  assertEquals(b2.tire_source, undefined);
});
