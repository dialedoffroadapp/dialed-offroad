// Minimal jest for pure lib logic — node env, ts-jest, no react-native
// preset and no native modules. Native/Expo imports that the lib modules
// pull in transitively are stubbed via moduleNameMapper.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/__tests__/stubs/jest-setup.js"],
  moduleNameMapper: {
    "^@react-native-async-storage/async-storage$":
      "@react-native-async-storage/async-storage/jest/async-storage-mock",
    "^react-native$": "<rootDir>/__tests__/stubs/react-native.js",
    "^expo-notifications$": "<rootDir>/__tests__/stubs/expo-notifications.js",
    "^react-native-url-polyfill/auto$": "<rootDir>/__tests__/stubs/empty.js",
    "^react-native-purchases$":
      "<rootDir>/__tests__/stubs/react-native-purchases.js",
    "^expo-constants$": "<rootDir>/__tests__/stubs/expo-constants.js",
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
