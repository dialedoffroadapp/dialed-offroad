// rider.profile_id (rider profiles, 2026-09-08): a uuid rides through to the
// stored input, anything else is stripped, absent stays absent. Generation
// never reads it.
import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeRiderProfileId } from "../index.ts";

Deno.test("sanitizeRiderProfileId keeps a uuid, strips anything else, leaves absent alone", () => {
  const ok = { input: { rider: { profile_id: "11111111-2222-4333-8444-555555555555", skill: "intermediate" } } };
  sanitizeRiderProfileId(ok);
  assertEquals(ok.input.rider.profile_id, "11111111-2222-4333-8444-555555555555");

  const bad = { input: { rider: { profile_id: "me", skill: "intermediate" } } } as { input: { rider: { profile_id?: unknown; skill: string } } };
  sanitizeRiderProfileId(bad);
  assertEquals(bad.input.rider.profile_id, undefined);
  assertEquals(bad.input.rider.skill, "intermediate");

  const num = { input: { rider: { profile_id: 42 } } } as { input: { rider: { profile_id?: unknown } } };
  sanitizeRiderProfileId(num);
  assertEquals("profile_id" in num.input.rider, false);

  const none = { input: { rider: { skill: "pro" } } } as { input: { rider: { profile_id?: unknown; skill: string } } };
  sanitizeRiderProfileId(none);
  assertEquals(none.input.rider, { skill: "pro" });

  const noRider = { input: {} } as { input: { rider?: { profile_id?: unknown } } };
  sanitizeRiderProfileId(noRider);
  assertEquals(noRider.input.rider, undefined);
});
