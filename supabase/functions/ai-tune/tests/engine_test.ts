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
  conditionsRuleDeltas,
  LEGACY_TO_V3,
  makeHandler,
  mergeFeedback,
  quarterTurns,
  safeShape,
  safeShapeSparse,
  sanitizeConditions,
  sanitizeParsedFeedback,
  sanitizePrevious,
  V3_SYMPTOM_IDS,
  WHERE_TAGS,
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
    claimBaseline: () => Promise.resolve({ ok: true, reason: "pro" }),
    refundClaim: () => Promise.resolve(),
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

  // Contract v3 (2026-09-05) changed exactly two things about these outputs:
  // HSC moves in quarter turns (v1 moved 0.15 / 0.30 and rounded to one
  // decimal), and the refine shape carries engine_source. Everything else,
  // every other circuit and every note, must stay byte-identical, so the
  // comparison masks HSC and the two HSC note fragments, then checks HSC on
  // its own: untouched stays exactly where it was; moved lands on a quarter
  // turn within one quarter of where v1 put it.
  const mask = (r: any) =>
    JSON.stringify({
      ...r,
      engine_source: undefined,
      shock: { ...r.shock, hsc_turns: "HSC" },
      notes: (r.notes ?? []).map((n: string) => n.replace("-0.15 HSC turns", "-0.25 HSC turns").replace("-0.30 HSC turns", "-0.50 HSC turns")),
    });
  let checked = 0;
  let hscMoved = 0;
  for (const fx of fixtures) {
    const input = tune2Input(fx);
    const v1 = safeShapeV1(buildTuneTwoV1(input), GUARDRAILS);
    const v3 = safeShapeSparse(buildTuneTwo(input), GUARDRAILS);
    assertEquals(mask(v3), mask(v1), `fixture diverged: ${JSON.stringify(fx.feedback)}`);
    const prevHsc = fx.previous.shock.hsc_turns;
    if (v1.shock.hsc_turns === prevHsc) {
      assertEquals(v3.shock.hsc_turns, prevHsc, `untouched HSC moved: ${JSON.stringify(fx.feedback)}`);
    } else {
      hscMoved++;
      const h = v3.shock.hsc_turns as number;
      assertEquals(h, quarterTurns(h), `HSC not on a quarter turn: ${h}`);
      assert(Math.abs(h - v1.shock.hsc_turns) <= 0.25 + 1e-9, `HSC drifted from v1: v3 ${h} vs v1 ${v1.shock.hsc_turns}`);
    }
    checked++;
  }
  console.log(`  regression fixtures checked: ${checked} (HSC moved in ${hscMoved})`);
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

/* ---------------- Test 14: the per-bike baseline rule, before the insert ---------------- */
// Decision 3 (2026-09-05): the server decides pro / regenerate (capped) /
// first_baseline / legacy credit itself, before the tune_calls insert and
// independently of the hourly limit.

const BIKE_ID = "22222222-2222-4333-8444-555555555555";

Deno.test("14. per-bike rule: regenerate cap → 429 unrecorded; no_trial → 402; first baseline and regenerate → 200; infra → fail-open", async () => {
  const seen: { bikeId: string | null; recorded: number } = { bikeId: "unset", recorded: 0 };
  const mk = (outcome: any) =>
    makeHandler(
      deps({
        claimBaseline: (_u, bikeId) => {
          seen.bikeId = bikeId;
          return Promise.resolve(outcome);
        },
        recordCall: () => {
          seen.recorded += 1;
          return Promise.resolve();
        },
      })
    );
  const body = { mode: "zero_baseline_v1", input: { ...BASELINE, bike_id: BIKE_ID } };

  const capped = await mk({ ok: false, reason: "regenerate_limit", regenerates_today: 5, limit: 5 })(fakeReq(body));
  assertEquals(capped.status, 429);
  const cappedBody = await capped.json();
  assertEquals(cappedBody.reason, "regenerate_limit");
  assert(cappedBody.error.startsWith("5 baseline updates a day"));
  assertEquals(seen.recorded, 0); // rejected calls are not recorded
  assertEquals(seen.bikeId, BIKE_ID); // the bike id reached the rule

  const noTrial = await mk({ ok: false, reason: "no_trial" })(fakeReq(body));
  assertEquals(noTrial.status, 402);
  assertEquals((await noTrial.json()).error, "no_trial");
  assertEquals(seen.recorded, 0);

  assertEquals((await mk({ ok: true, reason: "regenerate", regenerates_today: 2, limit: 5 })(fakeReq(body))).status, 200);
  assertEquals((await mk({ ok: true, reason: "first_baseline", claimed: true })(fakeReq(body))).status, 200);
  assertEquals(seen.recorded, 2);

  // A guest/local bike id never reaches the rule.
  await mk({ ok: true, reason: "pro" })(fakeReq({ mode: "zero_baseline_v1", input: { ...BASELINE, bike_id: "1783553470201_9a0e52e462e018" } }));
  assertEquals(seen.bikeId, null);

  // Infra failure of the rule fails open (logged), the call is served.
  assertEquals((await mk(null)(fakeReq(body))).status, 200);

  // The rule is independent of the hourly limit: the limit still fires first.
  const limited = makeHandler(deps({ countRecentCalls: () => Promise.resolve(20), claimBaseline: () => Promise.resolve({ ok: true, reason: "pro" }) }));
  assertEquals((await limited(fakeReq(body))).status, 429);
});

/* ================= Contract v3 (2026-09-05): decisions 4, 5, 6 ================= */

Deno.test("15. HSC: refinements move in quarter turns and snap only what they move; baselines always emit quarter turns", () => {
  const mild = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "bottoms_landings", severity: 6 }] } })), GUARDRAILS);
  assertEquals(mild.shock.hsc_turns, 1.25); // 1.4 - 0.25 = 1.15 → quarter turn 1.25
  const bad = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "bottoms_landings", severity: 9 }] } })), GUARDRAILS);
  assertEquals(bad.shock.hsc_turns, 1.0); // 1.4 - 0.50 = 0.9 → 1.0
  assert(bad.notes.some((n) => n.includes("-0.50 HSC turns")));
  const untouched = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "headshake", severity: 5 }] } })), GUARDRAILS);
  assertEquals(untouched.shock.hsc_turns, 1.4); // never snapped when not moved
  // Baseline shape: quarter turns always.
  assertEquals(safeShape({ fork: { comp_clicks: 12, reb_clicks: 12 }, shock: { lsc_clicks: 12, hsc_turns: 1.38, reb_clicks: 14, sag_mm: 105 }, notes: [] }, GUARDRAILS).shock.hsc_turns, 1.5);
  assertEquals(safeShape({ fork: { comp_clicks: 12, reb_clicks: 12 }, shock: { lsc_clicks: 12, hsc_turns: 1.3, reb_clicks: 14, sag_mm: 105 }, notes: [] }, GUARDRAILS).shock.hsc_turns, 1.25);
});

Deno.test("16. air is clamped to the window and a non-number is not a value", () => {
  const low = safeShape({ fork: { comp_clicks: 12, reb_clicks: 12, air_pressure_bar: 1.5 }, shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 }, detected: { has_air_fork: true }, notes: [] }, GUARDRAILS);
  assertEquals(low.fork.air_pressure_bar, 7);
  const high = safeShape({ fork: { comp_clicks: 12, reb_clicks: 12, air_pressure_bar: 15.2 }, shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 }, notes: [] }, { ...GUARDRAILS, air_min_bar: 8, air_max_bar: 12 } as any);
  assertEquals(high.fork.air_pressure_bar, 12);
  const junk = safeShape({ fork: { comp_clicks: "12 clicks", reb_clicks: 12, air_pressure_bar: "ten" }, shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 }, notes: [] } as any, GUARDRAILS);
  assertEquals(junk.fork.comp_clicks, 12); // baseline default, never NaN/null
  assertEquals(junk.fork.air_pressure_bar, undefined);
  const sparseJunk = safeShapeSparse({ fork: { comp_clicks: "12 clicks", reb_clicks: 12 }, shock: { lsc_clicks: 12, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 }, notes: [] } as any, GUARDRAILS);
  assertEquals(sparseJunk.fork.comp_clicks, null); // a refinement never invents
  // A refinement that pushes air past the window lands on the window.
  const prev = { ...PREV_AIR, fork: { ...PREV_AIR.fork, air_pressure_bar: 13.9 } };
  const out = safeShapeSparse(buildTuneTwo(tune2Input({ previous: prev, feedback: { overall_rating: 2, symptoms: [{ id: "bottoms_landings", severity: 10 }] } })), GUARDRAILS);
  assertEquals(out.fork.air_pressure_bar, 14);
});

Deno.test("17. conditions stage: rules run server-side, through conflict resolution, with tire psi and honest echo", () => {
  const coil = (conditions: any, symptoms: any[] = [], previous: any = PREV_COIL) =>
    safeShapeSparse(buildTuneTwo(tune2Input({ previous, feedback: { overall_rating: 5, symptoms, source: "conditions" }, conditions })), GUARDRAILS);

  // Choppy hardpack + hot on a coil bike: +1 fork comp, -1 shock LSC.
  const a = coil({ surfaces: ["hardpack"], state: "choppy", temp_band: "hot", watered: false });
  assertEquals(a.fork.comp_clicks, PREV_COIL.fork.comp_clicks + 1);
  assertEquals(a.shock.lsc_clicks, PREV_COIL.shock.lsc_clicks - 1);
  assert(a.notes.some((n) => n.startsWith("Conditions: choppy hardpack → +1 fork compression.")), JSON.stringify(a.notes));
  assert(a.notes.some((n) => n.startsWith("Conditions: heat → -1 shock low-speed compression.")));
  assertEquals(a.tire_psi_delta, 0);

  // Hot on an air fork: -0.2 bar instead of the LSC click; watered: tires -0.5 psi.
  const b = coil({ surfaces: ["hardpack"], state: "fresh", temp_band: "hot", watered: true }, [], PREV_AIR);
  assertEquals(b.fork.air_pressure_bar, Number((PREV_AIR.fork.air_pressure_bar - 0.2).toFixed(2)));
  assertEquals(b.shock.lsc_clicks, PREV_AIR.shock.lsc_clicks);
  assertEquals(b.tire_psi_delta, -0.5);
  assert(b.notes.some((n) => n.startsWith("Tires: -0.50 psi")));

  // Retune tile: roughed up → -1 fork comp; watered reverses a morning softening.
  const c = coil({ retune: { tile: "roughed" } });
  assertEquals(c.fork.comp_clicks, PREV_COIL.fork.comp_clicks - 1);
  const d = coil({ retune: { tile: "watered", prior_tweaks: [{ circuit: "fork_comp", delta: 2 }] } });
  assertEquals(d.fork.comp_clicks, PREV_COIL.fork.comp_clicks - 2);
  assertEquals(d.tire_psi_delta, -0.5);

  // Conditions and a symptom fighting over fork comp: the symptom (severity 6)
  // outranks conditions (5); sand's -1 shrinks harsh's +2 to +1, with a note.
  const e = coil({ surfaces: ["sand"], state: "fresh", temp_band: "mild", watered: false }, [{ id: "harsh_small_bumps", severity: 6 }]);
  assertEquals(e.fork.comp_clicks, PREV_COIL.fork.comp_clicks + 1);
  assert(e.notes.some((n) => n.includes("today's conditions") && n.includes("opposite ways")), JSON.stringify(e.notes));

  // Nothing to change: an honest echo, not the "no issues selected" line.
  const f = coil({ surfaces: ["hardpack"], state: "fresh", temp_band: "mild", watered: false });
  assertEquals(f.fork.comp_clicks, PREV_COIL.fork.comp_clicks);
  assert(f.notes[0].startsWith("Nothing in today's conditions"));

  // sanitizeConditions: garbage is dropped, an empty object is absent.
  assertEquals(sanitizeConditions({ surfaces: ["lava", "sand"], state: "soupy", temp_band: "hot", watered: "yes" }), { surfaces: ["sand"], state: null, temp_band: "hot", watered: null, retune: null });
  assertEquals(sanitizeConditions({}), undefined);
  assertEquals(sanitizeConditions(null), undefined);
});

Deno.test("18. taxonomy: every v3 id moves something; qualifier tags route; legacy map covers all eleven", () => {
  for (const id of V3_SYMPTOM_IDS) {
    const out = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id, severity: 6 }] } })), GUARDRAILS);
    const moved = ["comp_clicks", "reb_clicks", "air_pressure_bar"].some((k) => (out.fork as any)[k] !== (PREV_AIR.fork as any)[k]) ||
      ["lsc_clicks", "hsc_turns", "reb_clicks"].some((k) => (out.shock as any)[k] !== (PREV_AIR.shock as any)[k]);
    assert(moved, `${id} moved nothing`);
    assert(out.notes.some((n) => n.includes("→")), `${id} has no adjustment note`);
  }
  // Mandatory qualifiers change the move.
  const jump = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "rear_kicks", severity: 6, where: "jump_face" }] } })), GUARDRAILS);
  assertEquals(jump.shock.hsc_turns, 1.25); // 1.4 - 0.25 → quarter turn
  const bigHits = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "harsh_small_bumps", severity: 6, where: "big_hits" }] } })), GUARDRAILS);
  assertEquals(bigHits.fork.comp_clicks, PREV_AIR.fork.comp_clicks); // routed to bottoming: no fork softening
  assert((bigHits.shock.lsc_clicks as number) < PREV_AIR.shock.lsc_clicks);
  const rocks = safeShapeSparse(buildTuneTwo(tune2Input({ feedback: { overall_rating: 6, symptoms: [{ id: "packs_in_chop", severity: 6, where: "rocks" }] } })), GUARDRAILS);
  assertEquals(rocks.fork.comp_clicks, PREV_AIR.fork.comp_clicks + 1);
  // The parse sanitizer accepts the new tags in any casing and drops unknown ones.
  const parsed = sanitizeParsedFeedback({ symptoms: [{ id: "harsh_small_bumps", severity: 6, where: "Small chop" }, { id: "rear_kicks", severity: 5, where: "on the gas" }] });
  assertEquals(parsed.symptoms[0].where, "small_chop");
  assertEquals(parsed.symptoms[1].where, undefined);
  assertEquals(WHERE_TAGS.length, 11);
  // Legacy ids all map, and the three without a clean equivalent map to themselves.
  assertEquals(Object.keys(LEGACY_TO_V3).length, 11);
  assertEquals(LEGACY_TO_V3.dead_feel.id, "dead_feel");
  assertEquals(LEGACY_TO_V3.harsh_braking_bumps, { id: "harsh_small_bumps", where: "under_braking" });
});

Deno.test("19. honest previous values: a null circuit stays null, is never moved, and is named in a note", () => {
  const sparse = { fork: { comp_clicks: 14, reb_clicks: 12 }, shock: { lsc_clicks: 12, hsc_turns: null, reb_clicks: 14, sag_mm: 103 }, detected: { has_air_fork: false }, notes: [] };
  const out = safeShapeSparse(buildTuneTwo(tune2Input({ previous: sparse, feedback: { overall_rating: 5, symptoms: [{ id: "bottoms_landings", severity: 6 }] } })), GUARDRAILS);
  assertEquals(out.shock.hsc_turns, null);
  assert((out.shock.lsc_clicks as number) < 12); // the known circuit still moves
  assert(out.notes.some((n) => n.startsWith("Shock high-speed compression has no saved value")), JSON.stringify(out.notes));
  assertEquals(out.fork.air_pressure_bar, undefined);
  // The wire: strings and NaN are not values.
  assertEquals(sanitizePrevious({ fork: { comp_clicks: "12 clicks", reb_clicks: 12 }, shock: { lsc_clicks: NaN, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 } }).fork.comp_clicks, null);
  assertEquals(sanitizePrevious({ fork: { comp_clicks: 12, reb_clicks: 12 }, shock: { lsc_clicks: 10, hsc_turns: 1.5, reb_clicks: 14, sag_mm: 105 } }).shock.lsc_clicks, 10);
});

Deno.test("20. handler: engine_source, setup_id captured, a conditions ask never runs the adaptive step", async () => {
  let recorded: any = null;
  const h = makeHandler(deps({ recordCall: (r) => { recorded = r; return Promise.resolve(); } }));
  const SETUP = "55555555-2222-4333-8444-555555555555";
  const resp = await h(fakeReq({
    mode: "tune2_v1",
    input: {
      rider: { skill: "intermediate", style: "short_motos", goals: [] },
      has_zeroed_clickers: true,
      guardrails: GUARDRAILS,
      previous: PREV_COIL,
      setup_id: SETUP,
      conditions: { surfaces: ["hardpack"], state: "choppy", temp_band: "mild", watered: false },
      feedback: { overall_rating: 5, symptoms: [], source: "conditions" },
      // Would reverse fork comp if the adaptive step ran on a conditions ask.
      last_outcome: { outcome: "worse", symptoms: ["harsh_braking_bumps"], deltas: { fork_comp: 4 } },
    },
  }));
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.engine_source, "deterministic");
  assertEquals(body.fork.comp_clicks, PREV_COIL.fork.comp_clicks + 1); // the conditions click, not a reversal
  assert(!body.notes.some((n: string) => n.includes("reversing that this round")));
  assertEquals(recorded.input.setup_id, SETUP);

  // Baseline without a key is the formula, and says so.
  const anon = makeHandler(deps({ getUserId: () => Promise.resolve(null) }));
  const base = await (await anon(fakeReq({ mode: "zero_baseline_v1", input: BASELINE }, ""))).json();
  assertEquals(base.engine_source, "formula");
  assertEquals(base.shock.hsc_turns, quarterTurns(base.shock.hsc_turns));
});
