// "Why this setup" copy (device pass finding 6, 2026-09-08).
import { splitWhy, whyTextFor } from "../lib/whyCopy";

test("the first two sentences lead; the rest waits behind Read more", () => {
  const t = "Softer fork compression for braking bumps. Rear rebound a click faster. Sag target 105 mm. Ride it.";
  expect(splitWhy(t)).toEqual({ lead: "Softer fork compression for braking bumps. Rear rebound a click faster.", rest: "Sag target 105 mm. Ride it." });
  expect(splitWhy("One line only.")).toEqual({ lead: "One line only.", rest: "" });
  expect(splitWhy("")).toEqual({ lead: "", rest: "" });
});

test("engine notes join into one text; without notes the deterministic one-liner stands in", () => {
  expect(whyTextFor({ notes: ["Built for hardpack", "Two clicks softer up front."] })).toBe("Built for hardpack. Two clicks softer up front.");
  expect(whyTextFor({ notes: [], weightLbs: 160, riderClass: "c", terrain: "Singletrack" })).toBe("Built for a 160 lb C-class rider on singletrack. Ride it, then tell us what it did.");
  expect(whyTextFor({ notes: null, weightLbs: 160, skill: "intermediate" })).toBe("Built for a 160 lb C-class rider. Ride it, then tell us what it did.");
  expect(whyTextFor({})).toBe("Built from your weight, your riding, and what we know about this bike. Ride it, then tell us what it did.");
});
