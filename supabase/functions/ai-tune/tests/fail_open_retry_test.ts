// One retry before failing open on the service-role gates (audit follow-up
// closed 2026-09-08): a dep that rejects once answers on the retry with no
// fail-open log; a dep that rejects twice fails open with the tagged log.
Deno.env.set("AI_TUNE_TEST", "1");
import { assert, assertEquals } from "jsr:@std/assert@1";
import { FAIL_OPEN_TAG, withOneRetry } from "../index.ts";

Deno.test("rejects once: one more call, the answer, no fail-open log", async () => {
  let calls = 0;
  const logs: string[] = [];
  const fn = () => {
    calls++;
    return calls === 1 ? Promise.reject(new Error("blip")) : Promise.resolve({ ok: true, reason: "pro" });
  };
  const out = await withOneRetry("server_claim_baseline", fn, 1, (m) => logs.push(m));
  assertEquals(out, { ok: true, reason: "pro" });
  assertEquals(calls, 2);
  assertEquals(logs, []);
});

Deno.test("rejects twice: fails open (null) with the greppable tag naming the gate and both errors", async () => {
  let calls = 0;
  const logs: string[] = [];
  const fn = () => {
    calls++;
    return Promise.reject(new Error(`down ${calls}`));
  };
  const out = await withOneRetry("server_refine_allowance", fn, 1, (m) => logs.push(m));
  assertEquals(out, null);
  assertEquals(calls, 2);
  assertEquals(logs.length, 1);
  assert(logs[0].startsWith(`${FAIL_OPEN_TAG} server_refine_allowance failed twice`), logs[0]);
  assert(logs[0].includes("down 1") && logs[0].includes("down 2"));
  assertEquals(FAIL_OPEN_TAG, "[ai-tune fail-open]");
});

Deno.test("answers first time: exactly one call", async () => {
  let calls = 0;
  const out = await withOneRetry("x", () => { calls++; return Promise.resolve(7); }, 1);
  assertEquals(out, 7);
  assertEquals(calls, 1);
});
