// The refine screen's taxonomy (device pass finding 7, 2026-09-08), contract v3 ids.
import { ALL_SYMPTOMS, canSaveLog, cycleLevel, symptomGroupsFor, symptomLabelFor } from "../lib/rideSymptoms";

const ALL_IDS = ALL_SYMPTOMS.map((c) => c.id).sort();

test("every chip appears exactly once, grouped Front / Rear / Both ends, for both disciplines", () => {
  for (const d of ["mx", "offroad"] as const) {
    const groups = symptomGroupsFor(d);
    expect(groups.map((g) => g.title)).toEqual(["Front", "Rear", "Both ends"]);
    expect(groups.flatMap((g) => g.chips.map((c) => c.id)).sort()).toEqual(ALL_IDS);
    for (const g of groups) expect(g.chips.length).toBeGreaterThan(0);
  }
});

test("labels follow the discipline; legacy ids read through the map; the where tags survive on the chips that ask", () => {
  expect(symptomLabelFor("front_pushes", "mx")).toBe("Front pushes");
  expect(symptomLabelFor("front_pushes", "offroad")).toBe("Front washes out");
  expect(symptomLabelFor("front_knifes", "offroad")).toBe("Front washes out");
  expect(symptomLabelFor("headshake", null)).toBe("Headshake");
  const chips = symptomGroupsFor("offroad").flatMap((g) => g.chips);
  expect(chips.find((c) => c.id === "rear_kicks")?.qualifiers?.map((q) => q.tag)).toEqual(["jump_face", "braking_bumps", "logs_ledges"]);
  expect(chips.find((c) => c.id === "bottoming")?.qualifiers).toBeUndefined(); // no front/rear qualifier yet (flagged)
});

test("tap once = mild, twice = bad, a third tap clears", () => {
  expect(cycleLevel(null)).toBe("mild");
  expect(cycleLevel(undefined)).toBe("mild");
  expect(cycleLevel("mild")).toBe("bad");
  expect(cycleLevel("bad")).toBeNull();
});

test("save enables on any chip or any text; a chip that asks where needs its tag", () => {
  expect(canSaveLog({ sentiment: "same", symptoms: [], text: "harsh in the bars on braking bumps", quick: true })).toBe(true);
  expect(canSaveLog({ sentiment: "same", symptoms: [{ id: "front_pushes", level: "mild", qualifier: null }], text: "", quick: true })).toBe(true);
  expect(canSaveLog({ sentiment: "same", symptoms: [], text: "   ", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: null, symptoms: [], text: "words", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: "worse", symptoms: [{ id: "rear_kicks", level: "bad", qualifier: null }], text: "", quick: true })).toBe(false);
  expect(canSaveLog({ sentiment: "worse", symptoms: [{ id: "rear_kicks", level: "bad", qualifier: "jump_face" }], text: "", quick: true })).toBe(true);
  expect(canSaveLog({ sentiment: "better", symptoms: [], text: "", quick: false })).toBe(true);
});
