// Audit item 5: Garage quiz flows on accounts that never took the quiz.
import AsyncStorage from "@react-native-async-storage/async-storage";
jest.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
/* eslint-disable import/first */
import { disciplineFromBike, nextQuizRoute, quizProgressFor, readQuizAnswers, startGarageQuizFlow, terrainIdFor } from "../lib/quizOnboarding";

beforeEach(() => AsyncStorage.clear());

test("discipline derives from the bike", () => {
  expect(disciplineFromBike("KTM", "300 XC-W")).toBe("offroad");
  expect(disciplineFromBike("KTM", "250 SX-F")).toBe("mx");
  expect(disciplineFromBike("Stark", "Varg")).toBeNull();
  expect(disciplineFromBike(null, null)).toBeNull();
});

test("new_setup on a fresh install seeds the discipline from the bike and asks only what is missing", async () => {
  const first = await startGarageQuizFlow("new_setup", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "300 XC-W", year: 2024 });
  expect(first).toBe("/quiz/terrain");
  const a = await readQuizAnswers();
  expect(a.discipline).toBe("offroad");
  expect(a.flow).toBe("new_setup");
  // rider facts missing: terrain → skill → weight → building
  expect(nextQuizRoute("terrain", { ...a, terrainMain: "singletrack" })).toBe("/quiz/skill");
  expect(nextQuizRoute("skill", { ...a, terrainMain: "singletrack", skill: "comfortable" as any })).toBe("/quiz/weight");
  expect(nextQuizRoute("weight", { ...a, terrainMain: "singletrack", skill: "comfortable" as any, weightLbs: 170 })).toBe("/quiz/building");
  expect(nextQuizRoute("building", a)).toBe("/quiz/reveal");
  expect(nextQuizRoute("reveal", a)).toBe("/garage-bike?bikeId=11111111-2222-4333-8444-555555555555");
});

test("add_bike keeps the rider's own discipline when present", async () => {
  await AsyncStorage.setItem("dialed_quiz_answers_v1", JSON.stringify({ version: 1, discipline: "mx", startedAt: "x", updatedAt: "x" }));
  await startGarageQuizFlow("add_bike", {});
  expect((await readQuizAnswers()).discipline).toBe("mx");
});

test("regenerate: terrain tiles first with the running setup's terrain preselected; missing facts after; next version on that setup", async () => {
  await AsyncStorage.setItem("dialed_quiz_answers_v1", JSON.stringify({ version: 1, discipline: "mx", skill: "comfortable", weightLbs: 175, terrainMain: "sand", terrainSecondary: ["hardpack", "mud"], startedAt: "x", updatedAt: "x" }));
  const first = await startGarageQuizFlow("regenerate", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026, setupId: "55555555-2222-4333-8444-555555555555", terrain: "Hardpack" });
  expect(first).toBe("/quiz/terrain");
  const a = await readQuizAnswers();
  expect(a.flow).toBe("regenerate");
  expect(a.flowSetupId).toBe("55555555-2222-4333-8444-555555555555");
  expect(a.terrainMain).toBe("hardpack"); // the version's label, matched onto the tile id
  expect(a.terrainSecondary).toEqual(["mud"]); // the preselected main never doubles as a secondary
  expect(a.flowSteps).toEqual(["terrain"]); // rider facts present: one question
  expect(quizProgressFor("terrain", a)).toEqual({ current: 1, total: 1 });
  expect(nextQuizRoute("terrain", a)).toBe("/quiz/building");
  expect(nextQuizRoute("reveal", a)).toBe("/garage-bike?bikeId=11111111-2222-4333-8444-555555555555");

  // A terrain the discipline has no tile for keeps the rider's own answer.
  await AsyncStorage.setItem("dialed_quiz_answers_v1", JSON.stringify({ version: 1, discipline: "mx", skill: "comfortable", weightLbs: 175, terrainMain: "loam", startedAt: "x", updatedAt: "x" }));
  await startGarageQuizFlow("regenerate", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026, terrain: "Singletrack" });
  expect((await readQuizAnswers()).terrainMain).toBe("loam");

  // Fresh install: tiles, then the missing rider facts; the bar counts three.
  await AsyncStorage.clear();
  expect(await startGarageQuizFlow("regenerate", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026 })).toBe("/quiz/terrain");
  const b = await readQuizAnswers();
  expect(b.flowSteps).toEqual(["terrain", "skill", "weight"]);
  expect(quizProgressFor("terrain", b)).toEqual({ current: 1, total: 3 });
  expect(quizProgressFor("weight", b)).toEqual({ current: 3, total: 3 });
  expect(nextQuizRoute("terrain", { ...b, terrainMain: "hardpack" })).toBe("/quiz/skill");
});

test("terrainIdFor matches a tile by id or label within the discipline", () => {
  expect(terrainIdFor("mx", "Hardpack")).toBe("hardpack");
  expect(terrainIdFor("mx", "rutted_clay")).toBe("rutted_clay");
  expect(terrainIdFor("offroad", "Rocks and roots")).toBe("rocks_roots");
  expect(terrainIdFor("mx", "Singletrack")).toBeUndefined();
  expect(terrainIdFor("mx", null)).toBeUndefined();
});

test("onboarding progress is unchanged: five segments", () => {
  expect(quizProgressFor("terrain", { version: 1, startedAt: "x", updatedAt: "x" } as any)).toEqual({ current: 4, total: 5 });
});
