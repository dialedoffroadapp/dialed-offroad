// Audit item 5: Garage quiz flows on accounts that never took the quiz.
import AsyncStorage from "@react-native-async-storage/async-storage";
jest.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
/* eslint-disable import/first */
import { disciplineFromBike, nextQuizRoute, readQuizAnswers, startGarageQuizFlow } from "../lib/quizOnboarding";

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

test("regenerate: bike known, rider facts present → straight to the drumroll; missing facts asked first", async () => {
  await AsyncStorage.setItem("dialed_quiz_answers_v1", JSON.stringify({ version: 1, discipline: "mx", skill: "comfortable", weightLbs: 175, terrainMain: "hardpack", startedAt: "x", updatedAt: "x" }));
  const first = await startGarageQuizFlow("regenerate", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026 });
  expect(first).toBe("/quiz/building");
  const a = await readQuizAnswers();
  expect(a.flow).toBe("regenerate");
  expect(a.terrainMain).toBe("hardpack");
  expect(nextQuizRoute("reveal", a)).toBe("/garage-bike?bikeId=11111111-2222-4333-8444-555555555555");
  await AsyncStorage.clear();
  expect(await startGarageQuizFlow("regenerate", { bikeId: "11111111-2222-4333-8444-555555555555", make: "KTM", model: "250 SX-F", year: 2026 })).toBe("/quiz/skill");
});
