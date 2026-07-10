// Test stub for expo-notifications: lib/rideReminder's module-scope
// setNotificationHandler call and scheduling API surface, no-op'd.
module.exports = {
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: false }),
  scheduleNotificationAsync: async () => "stub-notification-id",
  cancelScheduledNotificationAsync: async () => {},
  getLastNotificationResponseAsync: async () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
};
