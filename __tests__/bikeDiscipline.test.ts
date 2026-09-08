// No discipline assumptions (device pass finding 3, 2026-09-08): the stored
// answer wins, the classifier is only the fallback, Add a bike seeds none,
// and the discipline reaches the tire table and the refine payload.
jest.mock("../lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => { throw new Error("offline"); } } }));
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { disciplineForBike, disciplineFromBike } from "../lib/discipline";
import { readQuizAnswers, startGarageQuizFlow, writeQuizAnswers } from "../lib/quizOnboarding";

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("the stored answer wins; the platform classifier is only the fallback", () => {
  expect(disciplineFromBike("Husqvarna", "TX 300")).toBe("offroad");
  expect(disciplineForBike({ make: "Husqvarna", model: "TX 300", discipline: "mx" })).toBe("mx");
  expect(disciplineForBike({ make: "Husqvarna", model: "TX 300", discipline: null })).toBe("offroad");
  expect(disciplineForBike({ make: "KTM", model: "250 SX-F" })).toBe("mx");
  expect(disciplineForBike({ make: "KTM", model: "250 SX-F", discipline: "offroad" })).toBe("offroad");
  expect(disciplineForBike(null)).toBeNull();
});

test("Add a bike seeds no discipline (the quiz asks); regenerate takes the bike's stored answer over the store and the platform", async () => {
  await writeQuizAnswers({ ...(await readQuizAnswers()), discipline: "mx" });
  await startGarageQuizFlow("add_bike", {});
  expect((await readQuizAnswers()).discipline).toBeUndefined();
  await writeQuizAnswers({ ...(await readQuizAnswers()), discipline: "mx" });
  await startGarageQuizFlow("regenerate", { bikeId: "b1", make: "Husqvarna", model: "TX 300", year: 2023, discipline: "offroad" });
  expect((await readQuizAnswers()).discipline).toBe("offroad");
  await writeQuizAnswers({ ...(await readQuizAnswers()), discipline: undefined });
  await startGarageQuizFlow("regenerate", { bikeId: "b1", make: "Husqvarna", model: "TX 300", year: 2023, discipline: null });
  expect((await readQuizAnswers()).discipline).toBe("offroad"); // classifier fallback for a bike never asked
});
