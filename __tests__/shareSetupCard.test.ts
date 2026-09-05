// The share card must import cleanly and report unavailable when either
// native module is missing (dev clients built before expo-sharing /
// react-native-view-shot): importers read useShareSetup off an undefined
// module when this file failed to evaluate (2026-09-04).
jest.mock("../lib/usage", () => ({ logEvent: jest.fn() }));
jest.mock("expo-sharing", () => {
  throw new Error("Cannot find native module 'ExpoSharing'");
});
jest.mock("react-native-view-shot", () => {
  throw new Error("RNViewShot native module missing");
});

/* eslint-disable import/first */
import { isSharingAvailable, useShareSetup } from "../components/ShareSetupCard";

test("module evaluates without the native modules; hook exported; sharing reported unavailable", () => {
  expect(typeof useShareSetup).toBe("function");
  expect(isSharingAvailable()).toBe(false);
});
