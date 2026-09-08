// The refine screen's taxonomy (device pass finding 7, 2026-09-08).
import { SYMPTOM_PHRASES } from "../lib/ai";
import { canSaveLog, cycleLevel, symptomGroupsFor, symptomLabelFor } from "../lib/rideSymptoms";

const ALL_IDS = Object.keys(SYMPTOM_PHRASES).sort();

test("every engine id appears exactly once, grouped Front / Rear / Both ends, for both disciplines", () => {
  for (const d of ["mx", "offroad"] as const) {
    const groups = symptomGroupsFor(d);
    expect(groups.map((g) => g.title)).toEqual(["Front", "Rear", "Both ends"]);
    const ids = groups.flatMap((g) => g.chips.map((c) => c.id)).sort();
    expect(ids).toEqual(ALL_IDS);
    for (const g of groups) expect(g.chips.length).toBeGreaterThan(0);
  }
});

test("labels follow the discipline; the where qualifiers survive on the three chips that ask", () => {
  expect(symptomLabelFor("front_knifes", "mx")).toBe("Front pushes");
  expect(symptomLabelFor("front_knifes", "offroad")).toBe("Front washes out");
  expect(symptomLabelFor("harsh_square_edge", "offroad")).toBe("Harsh on roots and rocks");
  expect(symptomLabelFor("headshake", null)).toBe("Headshake");
  const chips = symptomGroupsFor("offroad").flatMap((g) => g.chips);
  expect(chips.find((c) => c.id === "rear_kicks_accel")?.qualifiers).toEqual(["Square edges", "Landings", "Braking bumps"]);
  expect(chips.find((c) => c.id === "bottoms_landings")?.qualifiers).toBeUndefined(); // no front/rear qualifier yet (flagged)
});

test("tap once = mild, twice = bad, a third tap clears", () => {
  expect(cycleLevel(null)).toBe("mild");
  expect(cycleLevel(undefined)).toBe("mild");
  expect(cycleLevel("mild")).toBe("bad");
  expect(cycleLevel("bad")).toBeNull();
});

test("save enables on any chip or any text; a chip that asks where needs its answer", () => {
  expect(canSaveLog({ sentiment: "same", symptoms: [], text: "harsh in the bars on braking bumps", quick: true })).toBe(true);
  expect(canSaveLog({ sentiment: "same", symptoms: [{ id: "front_knifes", level: "mild", qualifier: null }], text: "", quick: true })).toBe(true);
  expect(canSaveLog({ sentiment: "same", symptoms: [], text: "   ", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: null, symptoms: [], text: "words", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: "worse", symptoms: [{ id: "rear_kicks_accel", level: "bad", qualifier: null }], text: "", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: "worse", symptoms: [{ id: "rear_kicks_accel", level: "bad", qualifier: "Landings" }], text: "", quick: true })).toBe(true);
  // A ride-day moto is a record: the sentiment alone saves it.
  expect(canSaveLog({ sentiment: "better", symptoms: [], text: "", quick: false })).toBe(true);
});
