module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],

  // `.git-rewrite/` is git's own scratch directory from a `filter-branch` run
  // that was committed by accident — 255 tracked files holding a stale copy of
  // the whole app, `__tests__` included. Jest's default testMatch finds those
  // copies and runs them, so `npm test` executes duplicated, outdated suites
  // against code that no longer exists.
  //
  // Ignored here rather than deleted: removing 255 tracked files is a
  // repository decision, not a test-config one, and the directory should be
  // dropped in its own commit. Until then this keeps the test run honest.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.git-rewrite/", "<rootDir>/.expo/"],
  modulePathIgnorePatterns: ["<rootDir>/.git-rewrite/", "<rootDir>/.expo/"],

  transformIgnorePatterns: [
    "node_modules/(?!(" +
      "react-native" +
      "|@react-native" +
      "|@react-native-firebase" +
      "|@react-navigation" +
      "|@erpgulf/auth-sdk" +
      "|@erpgulf/server-lookup" +
      "|expo" +
      "|expo-asset" +
      "|expo-constants" +
      "|expo-file-system" +
      "|expo-font" +
      "|expo-modules-core" +
      "|expo-crypto" +
      "|expo-application" +
      "|expo-updates" +
      "|expo-splash-screen" +
      "|expo-linking" +
      "|expo-router" +
      ")/)",
  ],

  moduleNameMapper: {
    "^@erpgulf/auth-sdk$": "<rootDir>/node_modules/@erpgulf/auth-sdk/dist/index.js",
    "^@erpgulf/server-lookup$": "<rootDir>/node_modules/@erpgulf/server-lookup/dist/index.js",
    "^expo-modules-core$": require.resolve("expo-modules-core", {
      paths: [require.resolve("expo/package.json")],
    }),
    "^expo-modules-core/src/polyfill/dangerous-internal$": require.resolve(
      "expo-modules-core/src/polyfill/dangerous-internal",
      { paths: [require.resolve("expo/package.json")] },
    ),
  },
};
