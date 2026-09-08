// The Adjust reason line comes from the symptom table row (finding 8, 2026-09-08).
import { ALL_SYMPTOMS, LEGACY_TO_V3 } from "../lib/rideSymptoms";
import { symptomReason } from "../lib/symptomReasons";
import { forkFamilyFor, shockFamilyFor, shortLocation } from "../lib/adjusterLocations";

test("every chip and every legacy id has a table-row reason with no em dash; qualifier tags that change the route get their own sentence", () => {
  for (const id of [...ALL_SYMPTOMS.map((c) => c.id), ...Object.keys(LEGACY_TO_V3)]) {
    const r = symptomReason(id);
    expect(typeof r).toBe("string");
    expect(r).not.toContain("\u2014");
    expect(r!.endsWith(".")).toBe(true);
  }
  expect(symptomReason("front_pushes")).toMatch(/^The front pushes/);
  expect(symptomReason("front_knifes")).toBe(symptomReason("front_pushes"));
  expect(symptomReason("harsh_small_bumps", "big_hits")).toMatch(/bottoming problem/);
  expect(symptomReason("harsh_small_bumps", "small_chop")).toBe(symptomReason("harsh_small_bumps"));
  expect(symptomReason("rear_kicks", "jump_face")).toMatch(/quarter turn of high speed/);
  expect(symptomReason("rear_kicks", "Jump face")).toBe(symptomReason("rear_kicks", "jump_face"));
  expect(symptomReason(null)).toBeNull();
});

test("the adjuster location is one short line from the walkthrough copy; DRAFT rows say nothing", () => {
  const fork = forkFamilyFor("WP XACT air", true);
  const shock = shockFamilyFor("WP linkage");
  expect(shortLocation("fork_comp", fork, shock)).toBe("Compression: right fork leg, top cap");
  expect(shortLocation("fork_reb", fork, shock)).toBe("Rebound: right fork leg, top cap");
  expect(shortLocation("fork_comp", "kyb_psf2", shock)).toBeNull();
});
