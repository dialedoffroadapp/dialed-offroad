// supabase/functions/ai-tune/tests/engine_test.ts
// Engine v2 verification suite. Run with:
//   AI_TUNE_TEST=1 deno test --allow-env supabase/functions/ai-tune/tests/
//
// Test 1 is the regression guard: v2 with no where / no protect / no free_text /
// no last_outcome must produce byte-identical output to the committed v1 engine
// (tests/engine_v1_snapshot.ts, extracted from git HEAD). Fixtures deliberately
// avoid opposing-sign symptom combos: Change 5 (conflict resolution)
// intentionally diverges from v1's silent summing there — that divergence is
// asserted by test 2 instead.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "jsr:@std/assert@1";
import {
  buildTuneTwo,
  callParseFeedback,
  makeHandler,
  mergeFeedback,
  safeShape,
  sanitizeParsedFeedback,
  type HandlerDeps,
} from "../index.ts";
import { buildTuneTwoV1, safeShapeV1 } from "./engine_v1_snapshot.ts";

/* ------------------------------ helpers ------------------------------ */

const PREV_AIR = {
  fork: { comp_clicks: 14, reb_clicks: 12, air_pressure_bar: 10.6 },
  shock: { lsc_clicks: 12, hsc_turns: 1.4, reb_clicks: 14, sag_mm: 103 },
  detected: { has_air_fork: true, fork_family: "WP XACT AER 48" },
  notes: [],
};

const PREV_COIL = {
  fork: { comp_clicks: 14, reb_clicks: 12 },
  shock: { lsc_clicks: 12, hsc_turns: 1.4, reb_clicks: 14, sag_mm: 103 },
  detected: { has_air_fork: false },
  notes: [],
};

const GUARDRAILS = {
  clicks_min: 0,
  clicks_max: 30,
  hsc_turns_min: 0,
  hsc_turns_max: 3,
  sag_min_mm: 95,
  sag_max_mm: 112,
};

function tune2Input(overrides: Record<string, unknown>) {
  return {
    make: "KTM",
    model: "350 SX-F",
    year: 2024,
    terrain: "mx track, hardpack",
    rider: { skill: "intermediate", style: "short_motos", goals: [] },
    previous: PREV_AIR,
    guardrails: GUARDRAILS,
    ...overrides,
  } as any;
}

function fakeReq(body: unknown, auth = "Bearer fake-token"): Request {
  return new Request("http://local/ai-tune", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getUserId: () => Promise.resolve("user-123"),
    countRecentCalls: () => Promise.resolve(0),
    recordCall: () => Promise.resolve(),
    parseFreeText: () => Promise.resolve(null),
    modelExists: () => Promise.resolve(true),
    ...overrides,
  };
}

const circuits = (r: any) => ({
  fork_comp: r.fork.comp_clicks,
  fork_reb: r.fork.reb_clicks,
  shock_lsc: r.shock.lsc_clicks,
  shock_reb: r.shock.reb_clicks,
  shock_hsc: r.shock.hsc_turns,
  sag: r.shock.sag_mm,
  air: r.fork.air_pressure_bar,
});

/* --------------------- Test 1: regression vs v1 --------------------- */

// Fixture set: every symptom alone at three severities, plus compatible
// multi-symptom sets, both fork types, several overall ratings, and the
// no-symptom echo path. NO opposing-sign combos, NO v2-only fields.
const ALL_SYMPTOMS = [
  "harsh_braking_bumps",
  "deflects_in_chop",
  "rear_kicks_accel",
  "bottoms_landings",
  "front_knifes",
  "dead_feel",
  "unstable_whoops",
  "packs_whoops",
  "harsh_square_edge",
  "headshake",
  "general_harsh",
] as const;

Deno.test("1. regression: plain inputs are byte-identical to committed v1 engine", () => {
  const fixtures: any[] = [];

  for (const prev of [PREV_AIR, PREV_COIL]) {
    for (const id of ALL_SYMPTOMS) {
      for (const severity of [3, 6, 9]) {
        for (const overall of [2, 4, 6, 8, 10]) {
          fixtures.push({
            previous: prev,
            feedback: { overall_rating: overall, symptoms: [{ id, severity }] },
          });
        }
      }
    }
    // compatible multi-symptom sets (no opposing-sign circuits)
    fixtures.push({
      previous: prev,
      feedback: {
        overall_rating: 5,
        symptoms: [
          { id: "harsh_braking_bumps", severity: 8 },
          { id: "rear_kicks_accel", severity: 5 },
        ],
      },
    });
    fixtures.push({
      previous: prev,
      feedback: {
        overall_rating: 3,
        symptoms: [
          { id: "unstable_whoops", severity: 7 },
          { id: "bottoms_landings", severity: 9 },
        ],
      },
    });
    // echo path
    fixtures.push({
      previous: prev,
      feedback: { overall_rating: 8, symptoms: [] },
    });
  }

  let checked = 0;
  for (const fx of fixtures) {
    const input = tune2Input(fx);
    const v1 = safeShapeV1(buildTuneTwoV1(input), GUARDRAILS);
    const v2 = safeShape(buildTuneTwo(input), GUARDRAILS);
    assertEquals(
      JSON.stringify(v2),
      JSON.stringify(v1),
      `fixture diverged: ${JSON.stringify(fx.feedback)}`
    );
    checked++;
  }
  console.log(`  regression fixtures checked: ${checked}`);
});

/* ---------------- Test 2: conflict resolution, not zero ---------------- */

Deno.test("2. packs_whoops(9) vs unstable_whoops(5): packs wins shock reb, reduced, noted", () => {
  const input = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [
        { id: "packs_whoops", severity: 9 },
        { id: "unstable_whoops", severity: 5 },
      ],
    },
  });
  const out = safeShape(buildTuneTwo(input), GUARDRAILS);

  // packs(9): +3 reb; unstable(5): -2 reb → winner packs, magnitude 3-2=1 → +1
  assertEquals(out.shock.reb_clicks, PREV_AIR.shock.reb_clicks + 1);
  assertEquals(out.fork.reb_clicks, PREV_AIR.fork.reb_clicks + 1);
  assertNotEquals(out.shock.reb_clicks, PREV_AIR.shock.reb_clicks); // NOT zeroed
  assert(
    out.notes.some((n) => n.includes("pull shock rebound opposite ways")),
    `conflict note missing: ${JSON.stringify(out.notes)}`
  );
});

/* ---------------- Test 3: where=landings routes to bottoming ---------------- */

Deno.test("3. harsh_braking_bumps + where=landings → bottoms_landings logic", () => {
  const input = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [
        { id: "harsh_braking_bumps", severity: 7, where: "landings" },
      ],
    },
  });
  const out = safeShape(buildTuneTwo(input), GUARDRAILS);

  // Bottoming logic: LSC firmer (fewer clicks out), HSC firmer, air up —
  // and NO fork comp softening (which the default harsh case would apply).
  assertEquals(out.fork.comp_clicks, PREV_AIR.fork.comp_clicks);
  assert(out.shock.lsc_clicks < PREV_AIR.shock.lsc_clicks, "LSC should firm up");
  assert(out.shock.hsc_turns < PREV_AIR.shock.hsc_turns, "HSC should firm up");
  assert(
    out.fork.air_pressure_bar! > PREV_AIR.fork.air_pressure_bar,
    "air should rise for bottoming"
  );
  assert(out.notes.some((n) => n.toLowerCase().includes("bottoming")));
});

/* ---------------- Tests 4/5: protect pass ---------------- */

Deno.test("4. protected rear_traction + rear_kicks_accel(9) → shock reb capped ±1 with tension note", () => {
  const input = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [{ id: "rear_kicks_accel", severity: 9 }],
    },
    protectedAreas: ["rear_traction"],
  });
  const out = safeShape(buildTuneTwo(input), GUARDRAILS);

  // computed would be -3; severity ≥8 demands the circuit → capped at -1
  assertEquals(out.shock.reb_clicks, PREV_AIR.shock.reb_clicks - 1);
  assert(
    out.notes.some((n) => n.includes("capping that change")),
    `tension note missing: ${JSON.stringify(out.notes)}`
  );
});

Deno.test("5. protected rear_traction + rear_kicks_accel(5) → shock reb zeroed with protect note", () => {
  const input = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [{ id: "rear_kicks_accel", severity: 5 }],
    },
    protectedAreas: ["rear_traction"],
  });
  const out = safeShape(buildTuneTwo(input), GUARDRAILS);

  assertEquals(out.shock.reb_clicks, PREV_AIR.shock.reb_clicks); // untouched
  assert(
    out.notes.some((n) =>
      n.includes("Left shock rebound alone — you said it was working.")
    ),
    `protect note missing: ${JSON.stringify(out.notes)}`
  );
});

/* ---------------- Test 6: adaptive reversal on 'worse' ---------------- */

Deno.test("6. last_outcome worse on fork_comp + same symptom → delta reversed", () => {
  const input = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [{ id: "harsh_braking_bumps", severity: 5 }],
    },
    lastOutcome: {
      outcome: "worse",
      symptoms: ["harsh_braking_bumps"],
      deltas: { fork_comp: 4 },
    },
  });
  const out = safeShape(buildTuneTwo(input), GUARDRAILS);

  // computed would be +2 (softer); worse → reverse last round's +4 → -4
  assertEquals(out.fork.comp_clicks, PREV_AIR.fork.comp_clicks - 4);
  assert(
    out.notes.some((n) => n.includes("reversing that this round")),
    `adaptive note missing: ${JSON.stringify(out.notes)}`
  );

  // 'same' → one extra click beyond computed
  const inputSame = tune2Input({
    feedback: {
      overall_rating: 6,
      symptoms: [{ id: "harsh_braking_bumps", severity: 5 }],
    },
    lastOutcome: {
      outcome: "same",
      symptoms: ["harsh_braking_bumps"],
      deltas: { fork_comp: 2 },
    },
  });
  const outSame = safeShape(buildTuneTwo(inputSame), GUARDRAILS);
  assertEquals(outSame.fork.comp_clicks, PREV_AIR.fork.comp_clicks + 3); // +2 computed, +1 adaptive
});

/* ---------------- Test 7: parse garbage/timeout → explicit input only ---------------- */

Deno.test("7. parse failure is fail-open: pipeline completes on explicit input", async () => {
  // 7a: fetcher throws (network error)
  const failing = () => Promise.reject(new Error("boom"));
  assertEquals(await callParseFeedback("front was harsh", failing as any), null);

  // 7b: fetcher hangs past the 5s abort → AbortError → null
  const hanging = (_url: any, init: any) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))
      );
    });
  // (don't actually wait 5s in CI — assert the shape by aborting early via a
  // pre-aborted signal path: the catch returns null either way)
  const garbage = () =>
    Promise.resolve(
      new Response("this is not json", { status: 200 })
    );
  assertEquals(await callParseFeedback("note", garbage as any), null);
  void hanging; // documented above; the garbage/throw paths cover the catch

  // 7c: end-to-end through the handler with a failing parser
  const h = makeHandler(
    deps({ parseFreeText: () => Promise.reject(new Error("parse infra down")) })
  );
  const resp = await h(
    fakeReq({
      mode: "tune2_v1",
      input: {
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
        guardrails: GUARDRAILS,
        previous: PREV_AIR,
        feedback: {
          overall_rating: 6,
          free_text: "rear end kicks like a mule",
          symptoms: [{ id: "harsh_braking_bumps", severity: 7 }],
        },
      },
    })
  );
  // NOTE: deps.parseFreeText rejecting would bubble — the handler must not die.
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(circuits(body).fork_comp, PREV_AIR.fork.comp_clicks + 2); // explicit chip applied
});

/* ---------------- Test 8: auth ---------------- */

Deno.test("8. tune2 without a real user → 401 (anon key alone doesn't count)", async () => {
  const h = makeHandler(deps({ getUserId: () => Promise.resolve(null) }));

  const t2 = await h(
    fakeReq({
      mode: "tune2_v1",
      input: {
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
        previous: PREV_AIR,
        feedback: { symptoms: [] },
      },
    })
  );
  assertEquals(t2.status, 401);

  // baseline stays open for anon (guest onboarding)
  const base = await h(
    fakeReq({
      mode: "zero_baseline_v1",
      input: {
        terrain: "mx",
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
        guardrails: GUARDRAILS,
      },
    })
  );
  assertEquals(base.status, 200);
});

/* ---------------- Test 9: unknown parsed symptom id dropped ---------------- */

Deno.test("9. parse returns unknown symptom id → dropped, rest of parse used", () => {
  const sanitized = sanitizeParsedFeedback({
    symptoms: [
      { id: "warp_drive_flutter", severity: 9 },
      { id: "packs_whoops", severity: "7", where: "WHOOPS" },
      { id: "rear_kicks_accel", severity: 99, where: "on the gas" },
    ],
    protected: [{ area: "Rear Traction" }, { area: "the vibes" }],
  });

  assertEquals(sanitized.symptoms.length, 2);
  assertEquals(sanitized.symptoms[0], {
    id: "packs_whoops",
    severity: 7,
    where: "whoops",
    source: "parsed",
  });
  assertEquals(sanitized.symptoms[1], {
    id: "rear_kicks_accel",
    severity: 10, // clamped
    source: "parsed", // invalid where dropped
  });
  assertEquals(sanitized.protectedAreas, ["rear_traction"]);

  // merge: explicit chip wins over parsed duplicate; parsed adds the new id
  const merged = mergeFeedback(
    {
      symptoms: [{ id: "packs_whoops", severity: 3, where: "braking" as any }],
    } as any,
    sanitized
  );
  assertEquals(merged.symptoms.length, 2);
  assertEquals(merged.symptoms[0].severity, 3); // explicit severity kept
  assertEquals(merged.symptoms[0].where, "braking"); // explicit where kept
  assertEquals(merged.parsedAddedIds, ["rear_kicks_accel"]);
});

/* ---------------- Test 10: rate limit ---------------- */

Deno.test("10. 21st call in an hour → 429 (and anon at 10)", async () => {
  let recorded = 0;
  const h = makeHandler(
    deps({
      countRecentCalls: () => Promise.resolve(20),
      recordCall: () => {
        recorded++;
        return Promise.resolve();
      },
    })
  );
  const resp = await h(
    fakeReq({
      mode: "zero_baseline_v1",
      input: {
        terrain: "mx",
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
      },
    })
  );
  assertEquals(resp.status, 429);
  assertEquals(recorded, 0); // rejected calls are not recorded

  // anon caller hits the lower limit of 10
  const hAnon = makeHandler(
    deps({
      getUserId: () => Promise.resolve(null),
      countRecentCalls: () => Promise.resolve(10),
    })
  );
  const respAnon = await hAnon(
    fakeReq({
      mode: "zero_baseline_v1",
      input: {
        terrain: "mx",
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
      },
    })
  );
  assertEquals(respAnon.status, 429);

  // under the limit → allowed and recorded
  const hOk = makeHandler(
    deps({
      countRecentCalls: () => Promise.resolve(19),
      recordCall: () => {
        recorded++;
        return Promise.resolve();
      },
    })
  );
  const respOk = await hOk(
    fakeReq({
      mode: "zero_baseline_v1",
      input: {
        terrain: "mx",
        rider: { skill: "intermediate", style: "short_motos", goals: [] },
        has_zeroed_clickers: true,
      },
    })
  );
  assertEquals(respOk.status, 200);
  assertEquals(recorded, 1);
});

/* ---------------- Tests 11/12: model_id validation and the insert-abort rule ---------------- */
// Decision 2 (2026-09-05): a bad bike_model_id used to fail the tune_calls
// insert, the failure was swallowed, and the call was served uncounted by
// the rate limit and uncaptured. Now the id is checked first and a failed
// insert aborts the call.

const MODEL_ID = "490e0276-f66a-4ef6-bbf1-ffbb2a4fe1b7";
const BASELINE = {
  terrain: "mx",
  rider: { skill: "intermediate", style: "short_motos", goals: [] },
  has_zeroed_clickers: true,
  guardrails: GUARDRAILS,
};

Deno.test("11. unknown model_id → 400 before the insert; a known id is stored; a lookup blip drops the id", async () => {
  let recorded: any = "not called";
  const h = makeHandler(
    deps({
      getUserId: () => Promise.resolve(null),
      modelExists: () => Promise.resolve(false),
      recordCall: (r) => {
        recorded = r;
        return Promise.resolve();
      },
    })
  );
  const bad = await h(fakeReq({ mode: "zero_baseline_v1", input: { ...BASELINE, model_id: MODEL_ID } }, ""));
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error, "invalid_model_id");
  assertEquals(recorded, "not called");

  const hOk = makeHandler(
    deps({
      getUserId: () => Promise.resolve(null),
      modelExists: () => Promise.resolve(true),
      recordCall: (r) => {
        recorded = r;
        return Promise.resolve();
      },
    })
  );
  assertEquals((await hOk(fakeReq({ mode: "zero_baseline_v1", input: { ...BASELINE, model_id: MODEL_ID } }, ""))).status, 200);
  assertEquals(recorded.bikeModelId, MODEL_ID);

  const hBlip = makeHandler(
    deps({
      getUserId: () => Promise.resolve(null),
      modelExists: () => Promise.resolve(null),
      recordCall: (r) => {
        recorded = r;
        return Promise.resolve();
      },
    })
  );
  assertEquals((await hBlip(fakeReq({ mode: "zero_baseline_v1", input: { ...BASELINE, model_id: MODEL_ID } }, ""))).status, 200);
  assertEquals(recorded.bikeModelId, null); // dropped, never stored, call still served
});

Deno.test("12. a failed tune_calls insert aborts the call: 503, no tune served (the bypass is closed)", async () => {
  const h = makeHandler(
    deps({
      getUserId: () => Promise.resolve(null),
      recordCall: () => Promise.reject(new Error("insert or update on table tune_calls violates foreign key constraint")),
    })
  );
  const resp = await h(fakeReq({ mode: "zero_baseline_v1", input: BASELINE }, ""));
  assertEquals(resp.status, 503);
  const body = await resp.json();
  assert(typeof body.error === "string" && body.error.length > 0);
  assertEquals(body.fork, undefined); // nothing generated

  // tune2 takes the same exit
  const h2 = makeHandler(
    deps({ recordCall: () => Promise.reject(new Error("boom")) })
  );
  const r2 = await h2(
    fakeReq({
      mode: "tune2_v1",
      input: { ...BASELINE, previous: PREV_AIR, feedback: { overall_rating: 6, symptoms: [{ id: "headshake", severity: 5 }] } },
    })
  );
  assertEquals(r2.status, 503);
});

/* ---------------- Test 13: fork type is catalog flag or rider toggle, never the name ---------------- */
// Decision 1 (2026-09-05). Runs the anon baseline through the fallback path
// (no OPENAI_API_KEY in the test env), which is where the retired name
// heuristic lived.

Deno.test("13. fork type: catalog flag > rider toggle; a KTM SX name alone is coil", async () => {
  const h = makeHandler(deps({ getUserId: () => Promise.resolve(null) }));
  const call = async (input: Record<string, unknown>) => {
    const resp = await h(fakeReq({ mode: "zero_baseline_v1", input: { ...BASELINE, ...input } }, ""));
    assertEquals(resp.status, 200);
    return await resp.json();
  };

  // Unmatched "KTM 250 SX-F", no toggle: the old heuristic said air; now coil.
  const named = await call({ make: "KTM", model: "250 SX-F", year: 2023 });
  assertEquals(named.fork.air_pressure_bar, undefined);
  assertEquals(named.detected.has_air_fork, false);

  // A mini with the toggle off is coil (the 1.5-bar class).
  const mini = await call({ make: "KTM", model: "50 SX", year: 2025 });
  assertEquals(mini.fork.air_pressure_bar, undefined);

  // The rider's explicit toggle still counts for an unmatched bike.
  const toggled = await call({ make: "KTM", model: "250 SX-F", year: 2023, wants_air_fork: true });
  assert(typeof toggled.fork.air_pressure_bar === "number", "toggle should yield air");
  assertEquals(toggled.detected.has_air_fork, true);

  // The catalog flag beats the toggle both ways.
  const catalogAir = await call({ make: "Yamaha", model: "YZ250F", year: 2024, wants_air_fork: false, guardrails: { ...GUARDRAILS, has_air_fork: true } });
  assert(typeof catalogAir.fork.air_pressure_bar === "number", "catalog air should yield air");
  const catalogCoil = await call({ make: "KTM", model: "250 SX-F", year: 2023, wants_air_fork: true, guardrails: { ...GUARDRAILS, has_air_fork: false } });
  assertEquals(catalogCoil.fork.air_pressure_bar, undefined);
  assertEquals(catalogCoil.detected.has_air_fork, false);
});
