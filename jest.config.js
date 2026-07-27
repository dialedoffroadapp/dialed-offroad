// Minimal jest — node env, ts-jest, no react-native preset and no native
// modules. Native/Expo imports that the lib modules pull in transitively are
// stubbed via moduleNameMapper. Component tests (*.test.tsx) render with
// react-test-renderer against the same stubs — see stubs/react-native.js.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/__tests__/**/*.test.ts",
    "<rootDir>/__tests__/**/*.test.tsx",
  ],
  setupFiles: ["<rootDir>/__tests__/stubs/jest-setup.js"],
  moduleNameMapper: {
    "^@react-native-async-storage/async-storage$":
      "@react-native-async-storage/async-storage/jest/async-storage-mock",
    "^react-native$": "<rootDir>/__tests__/stubs/react-native.js",
    "^expo-notifications$": "<rootDir>/__tests__/stubs/expo-notifications.js",
    "^expo-blur$": "<rootDir>/__tests__/stubs/expo-blur.js",
    "\\.(png|jpg|jpeg|gif|webp)$": "<rootDir>/__tests__/stubs/asset.js",
    "^react-native-url-polyfill/auto$": "<rootDir>/__tests__/stubs/empty.js",
    // Side-effect polyfill import in lib/tuneAttribution.ts — node's own
    // globalThis.crypto covers the tests.
    "^react-native-get-random-values$": "<rootDir>/__tests__/stubs/empty.js",
    "^react-native-purchases$":
      "<rootDir>/__tests__/stubs/react-native-purchases.js",
    "^expo-constants$": "<rootDir>/__tests__/stubs/expo-constants.js",
    "^expo-apple-authentication$":
      "<rootDir>/__tests__/stubs/expo-apple-authentication.js",
    "^expo-crypto$": "<rootDir>/__tests__/stubs/expo-crypto.js",
    "^@react-native-google-signin/google-signin$":
      "<rootDir>/__tests__/stubs/google-signin.js",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        // TS2614: react-native-purchases' broken `Offerings` type export —
        // a pre-existing app-wide diagnostic (see hooks/usePro.ts), not
        // something the tests should re-litigate.
        diagnostics: { ignoreCodes: [2614] },
        tsconfig: {
          module: "commonjs",
          target: "es2019",
          esModuleInterop: true,
          skipLibCheck: true,
          jsx: "react-jsx",
          strict: true,
        },
      },
    ],
  },
};
