// Rider profile pure helpers (device pass finding 4, 2026-09-08).
jest.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => { throw new Error("offline"); } } }));

/* eslint-disable import/first */
import { answersFromProfile, canConfirmProfile, confirmFillPatch, confirmLine, profileFieldRows, profilePatchFromQuiz, saveRiderProfile, activeRiderProfileId, type RiderProfile } from "../lib/riderProfile";

const base: RiderProfile = { id: "11111111-2222-4333-8444-555555555555", user_id: "u", name: "Me", weight_lbs: 160, unit: "lbs", skill: "comfortable", class: "c", discipline_default: "offroad" };

test("the confirm line names the weight and the class only when both are stored; otherwise the generic line with every field shown", () => {
  expect(confirmLine(base)).toBe("Still 160 lb, C class?");
  expect(confirmLine({ ...base, unit: "kg", weight_lbs: 161 })).toBe("Still 73 kg, C class?");
  // A seeded profile: weight and skill, no class (the class is not derived for the line).
  const seeded = { ...base, class: null, discipline_default: null };
  expect(confirmLine(seeded)).toBe("Confirm your rider profile");
  expect(confirmLine({ ...base, weight_lbs: null })).toBe("Confirm your rider profile");
  expect(profileFieldRows(seeded)).toEqual([
    { label: "Weight", value: "160 lb" },
    { label: "Skill", value: "Comfortable" },
    { label: "Class", value: "C class (from your skill)" },
  ]);
  expect(profileFieldRows(base)[3]).toEqual({ label: "Rides", value: "Off-road" });
});

test("a confirmed step fills what the seeded profile lacks: the class from the skill and this run's discipline", () => {
  expect(confirmFillPatch({ ...base, class: null, discipline_default: null }, "offroad")).toEqual({ class: "c", discipline_default: "offroad" });
  expect(confirmFillPatch({ ...base, class: null }, null)).toEqual({ class: "c" });
  expect(confirmFillPatch(base, "mx")).toBeNull();
});

test("a profile collapses the quiz only with both weight and skill", () => {
  expect(canConfirmProfile(base)).toBe(true);
  expect(canConfirmProfile({ ...base, weight_lbs: null })).toBe(false);
  expect(canConfirmProfile({ ...base, skill: null })).toBe(false);
  expect(canConfirmProfile(null)).toBe(false);
  expect(answersFromProfile(base)).toEqual({ weightLbs: 160, weightUnit: "lbs", skill: "comfortable" });
});

test("the quiz's facts become a profile patch with the class derived from the skill", () => {
  expect(profilePatchFromQuiz({ weightLbs: 172, weightUnit: "lbs", skill: "fast", discipline: "mx" })).toEqual({ weight_lbs: 172, unit: "lbs", skill: "fast", class: "b", discipline_default: "mx" });
  expect(profilePatchFromQuiz({ weightLbs: 150 })).toEqual({ weight_lbs: 150 });
});

test("guests have no profile: save is a no-op null and the payload carries no id", async () => {
  expect(await saveRiderProfile({ weight_lbs: 160 })).toBeNull();
  expect(await activeRiderProfileId()).toBeUndefined();
});
