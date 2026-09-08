// Sag page redesign (device pass finding 1, 2026-09-08): the section order,
// the result coloring, the four result sentences, the save enable state and
// the first-visit collapse.
import AsyncStorage from "@react-native-async-storage/async-storage";
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));
jest.mock("../lib/rideDay", () => ({ readHistory: async () => [] }));
jest.mock("../lib/supabase", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: () => { throw new Error("offline"); } } }));

/* eslint-disable import/first */
import { canSaveSag, markSagIntroSeen, resultSentence, ridingState, SAG_SECTION_ORDER, sagIntroOpen } from "../lib/sag";

const BOUNDS = { target: 105, min: 102, max: 112 };

test("sections run header, target, inputs, result, save, history, why, how, front", () => {
  expect([...SAG_SECTION_ORDER]).toEqual(["header", "target", "inputs", "result", "save", "history", "why", "how", "front"]);
});

test("result coloring: in range, close within 3 mm of an edge, out beyond it, empty without A and C", () => {
  expect(ridingState(105, BOUNDS)).toBe("in_range");
  expect(ridingState(102, BOUNDS)).toBe("in_range");
  expect(ridingState(114, BOUNDS)).toBe("close");
  expect(ridingState(100, BOUNDS)).toBe("close");
  expect(ridingState(118, BOUNDS)).toBe("out");
  expect(ridingState(90, BOUNDS)).toBe("out");
  expect(ridingState(null, BOUNDS)).toBe("empty");
});

test("the four sentences: in range, too much sag, too little sag, the spring rule", () => {
  expect(resultSentence({ ridingMm: 105, staticMm: null, bounds: BOUNDS, staticTarget: null })).toEqual({ text: "In the window, 102 to 112 mm. Ride it.", springRule: false });
  expect(resultSentence({ ridingMm: 118, staticMm: null, bounds: BOUNDS, staticTarget: null }).text).toBe("Too much sag. Add preload until it reads inside the window.");
  expect(resultSentence({ ridingMm: 95, staticMm: null, bounds: BOUNDS, staticTarget: null }).text).toBe("Too little sag. Back the preload off until it reads inside the window.");
  expect(resultSentence({ ridingMm: 118, staticMm: 34, bounds: BOUNDS, staticTarget: 33 })).toEqual({ text: "Static is right and riding is out. That is a spring, not preload.", springRule: true });
  // static out with riding out is preload first, not the spring rule
  expect(resultSentence({ ridingMm: 118, staticMm: 45, bounds: BOUNDS, staticTarget: 33 }).springRule).toBe(false);
  expect(resultSentence({ ridingMm: null, staticMm: 33, bounds: BOUNDS, staticTarget: 33 }).text).toMatch(/Enter A and C/);
  for (const s of [105, 118, 95].map((r) => resultSentence({ ridingMm: r, staticMm: null, bounds: BOUNDS, staticTarget: null }).text)) expect(s).not.toMatch(/—/);
});

test("save enables the moment A and C exist and A is longer than C; B is optional", () => {
  expect(canSaveSag({ a: 615, b: null, c: 510 })).toBe(true);
  expect(canSaveSag({ a: 615, b: 580, c: 510 })).toBe(true);
  expect(canSaveSag({ a: 615, b: 580, c: null })).toBe(false);
  expect(canSaveSag({ a: null, b: 580, c: 510 })).toBe(false);
  expect(canSaveSag({ a: 500, b: null, c: 510 })).toBe(false);
});

test("why and how open on the first visit and close after the first save", async () => {
  await AsyncStorage.clear();
  expect(await sagIntroOpen("bike-1")).toBe(true);
  await markSagIntroSeen("bike-1");
  expect(await sagIntroOpen("bike-1")).toBe(false);
  expect(await sagIntroOpen("bike-2")).toBe(true); // per bike
});
