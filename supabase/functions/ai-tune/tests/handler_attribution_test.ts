// supabase/functions/ai-tune/tests/handler_attribution_test.ts
// Workstream C: the handler stamps body.anon_id onto the recorded tune_calls
// row for ANON callers only, and only when it is a strict uuid. Run with the
// engine suite:
//   AI_TUNE_TEST=1 deno test --allow-env supabase/functions/ai-tune/tests/

import { assertEquals } from "jsr:@std/assert@1";
import { makeHandler, type HandlerDeps } from "../index.ts";

const ANON_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getUserId: () => Promise.resolve("user-123"),
    countRecentCalls: () => Promise.resolve(0),
    recordCall: () => Promise.resolve(),
    parseFreeText: () => Promise.resolve(null),
    ...overrides,
  };
}

function fakeReq(body: unknown): Request {
  return new Request("http://local/ai-tune", {
    method: "POST",
    headers: {
      Authorization: "Bearer fake-token",
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify(body),
  });
}

const BASELINE_INPUT = {
  terrain: "mx",
  rider: { skill: "intermediate", style: "short_motos", goals: [] },
  has_zeroed_clickers: true,
};

type Recorded = Parameters<HandlerDeps["recordCall"]>[0];

async function recordedFor(
  body: Record<string, unknown>,
  userId: string | null
): Promise<Recorded> {
  let row: Recorded | null = null;
  const h = makeHandler(
    deps({
      getUserId: () => Promise.resolve(userId),
      recordCall: (r) => {
        row = r;
        return Promise.resolve();
      },
    })
  );
  const resp = await h(fakeReq({ mode: "zero_baseline_v1", input: BASELINE_INPUT, ...body }));
  // Anon baseline completes fully offline. The AUTHENTICATED baseline path
  // hits enforceBaselineCredit, whose service client isn't dep-injected and
  // can't run under the offline test env (same pre-existing limitation that
  // fails engine_test #10's authenticated leg on main) — recordCall fires
  // BEFORE that gate, so the attribution capture is asserted either way.
  if (!userId) assertEquals(resp.status, 200);
  if (!row) throw new Error("recordCall was not invoked");
  return row;
}

Deno.test("anon caller's valid anon_id is stamped on the recorded row", async () => {
  const row = await recordedFor({ anon_id: ANON_ID }, null);
  assertEquals(row.anonId, ANON_ID);
  assertEquals(row.userId, null);
  assertEquals(row.ip, "203.0.113.7");
});

Deno.test("anon_id is normalized to lowercase", async () => {
  const row = await recordedFor({ anon_id: ANON_ID.toUpperCase() }, null);
  assertEquals(row.anonId, ANON_ID);
});

Deno.test("authenticated caller's anon_id is IGNORED (row already attributed)", async () => {
  const row = await recordedFor({ anon_id: ANON_ID }, "user-123");
  assertEquals(row.anonId, null);
  assertEquals(row.userId, "user-123");
  assertEquals(row.ip, null);
});

Deno.test("garbage anon_id never reaches the row", async () => {
  for (const garbage of [
    "not-a-uuid",
    "1783553470201_9a0e52e462e018", // legacy local bike-id shape
    "",
    42,
    { evil: true },
  ]) {
    const row = await recordedFor({ anon_id: garbage }, null);
    assertEquals(row.anonId, null, `should reject: ${JSON.stringify(garbage)}`);
  }
});

Deno.test("absent anon_id records null (pre-v2.3.0 clients unchanged)", async () => {
  const row = await recordedFor({}, null);
  assertEquals(row.anonId, null);
});
