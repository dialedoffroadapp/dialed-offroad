// The Adjust reason line comes from the symptom table row (finding 8, 2026-09-08).
import { SYMPTOM_PHRASES } from "../lib/ai";
import { symptomReason } from "../lib/symptomReasons";
import { forkFamilyFor, shockFamilyFor, shortLocation } from "../lib/adjusterLocations";

test("every engine id has a table-row reason with no em dash; qualifier routes get their own sentence", () => {
  for (const id of Object.keys(SYMPTOM_PHRASES) as (keyof typeof SYMPTOM_PHRASES)[]) {
    const r = symptomReason(id);
    expect(typeof r).toBe("string");
    expect(r).not.toContain("\u2014");
    expect(r!.endsWith(".")).toBe(true);
  }
  expect(symptomReason("front_knifes")).toMatch(/^The front pushes/);
  expect(symptomReason("harsh_braking_bumps", "Big hits")).toMatch(/bottoming problem/);
  expect(symptomReason("harsh_braking_bumps", "Small chop")).toBe(symptomReason("harsh_braking_bumps"));
  expect(symptomReason("rear_kicks_accel", "Landings")).toMatch(/quarter turn of high speed/);
  expect(symptomReason(null)).toBeNull();
});

test("the adjuster location is one short line from the walkthrough copy; DRAFT rows say nothing", () => {
  const fork = forkFamilyFor("WP XACT air", true);
  const shock = shockFamilyFor("WP linkage");
  expect(shortLocation("fork_comp", fork, shock)).toBe("Compression: right fork leg, top cap");
  expect(shortLocation("fork_reb", fork, shock)).toBe("Rebound: right fork leg, top cap");
  expect(shortLocation("fork_comp", "kyb_psf2", shock)).toBeNull();
});
