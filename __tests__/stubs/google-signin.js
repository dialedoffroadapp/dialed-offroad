// Test stub for @react-native-google-signin/google-signin. Tests reassign
// GoogleSignin.signIn / hasPlayServices per case.
module.exports = {
  GoogleSignin: {
    configure: () => {},
    hasPlayServices: async () => true,
    signIn: async () => {
      throw new Error("signIn not stubbed for this test");
    },
  },
  statusCodes: {
    SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
    IN_PROGRESS: "IN_PROGRESS",
    PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  },
};
