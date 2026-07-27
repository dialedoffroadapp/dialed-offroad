// Test stub for expo-apple-authentication. Tests reassign signInAsync /
// isAvailableAsync per case (lib/socialAuth.ts holds this same object).
module.exports = {
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: async () => true,
  signInAsync: async () => {
    throw new Error("signInAsync not stubbed for this test");
  },
};
