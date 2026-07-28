// __tests__/armRideCheckin.test.ts
// Permission-on-arm matrix for armRideCheckinWithPermission — the single
// helper BOTH ride-arm surfaces (setup_card + home_card) call, so this
// matrix covers both by construction. Device bug it fixes: undetermined
// permission → silent no-schedule while the button showed "Check-in set ✓".

const getPermissionsAsync = jest.fn();
const requestPermissionsAsync = jest.fn();
const scheduleNotificationAsync = jest.fn(async () => "notif-1");

jest.mock("expo-notifications", () => ({
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: (...a: any[]) => getPermissionsAsync(...(a as [])),
  requestPermissionsAsync: (...a: any[]) =>
    requestPermissionsAsync(...(a as [])),
  scheduleNotificationAsync: (...a: any[]) =>
    scheduleNotificationAsync(...(a as [])),
  cancelScheduledNotificationAsync: async () => {},
  getLastNotificationResponseAsync: async () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ARM_TOAST_IN_APP,
  ARM_TOAST_SCHEDULED,
  armRideCheckinWithPermission,
} from "../lib/rideReminder";

const PARAMS = {
  versionId: "11111111-1111-4111-8111-111111111111",
  versionNumber: 1,
  bikeName: "KTM 300 XC-W",
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test("undetermined → user GRANTS: schedules, outcome 'scheduled'", async () => {
  // First read: undetermined. After the grant, the OS reports granted —
  // scheduleRideReminder re-checks internally, so the mock must flip too.
  getPermissionsAsync
    .mockResolvedValueOnce({ granted: false, canAskAgain: true })
    .mockResolvedValue({ granted: true, canAskAgain: true });
  requestPermissionsAsync.mockResolvedValue({ granted: true });

  const outcome = await armRideCheckinWithPermission(PARAMS);

  expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(outcome).toBe("scheduled");
});

test("undetermined → user DENIES: no schedule, honest in-app outcome, decline stamped", async () => {
  getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  requestPermissionsAsync.mockResolvedValue({ granted: false });

  const outcome = await armRideCheckinWithPermission(PARAMS);

  expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(outcome).toBe("in_app_only");
  // Inline-rationale decline stamped so feedback-submit doesn't re-ask soon.
  expect(
    await AsyncStorage.getItem("notif_prompt_declined_at_v1")
  ).not.toBeNull();
});

test("already granted: schedules with NO prompt (exactly the old behavior)", async () => {
  getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });

  const outcome = await armRideCheckinWithPermission(PARAMS);

  expect(requestPermissionsAsync).not.toHaveBeenCalled();
  expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(outcome).toBe("scheduled");
});

test("already denied: arms in-app only, NEVER re-prompts", async () => {
  getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

  const outcome = await armRideCheckinWithPermission(PARAMS);

  expect(requestPermissionsAsync).not.toHaveBeenCalled();
  expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(outcome).toBe("in_app_only");
});

test("toast copy constants match the approved strings", () => {
  expect(ARM_TOAST_SCHEDULED).toBe("I'll check in after your next ride ✅");
  expect(ARM_TOAST_IN_APP).toBe(
    "Check-in set. I'll ask when you're back in the app."
  );
});
