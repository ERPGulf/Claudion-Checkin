module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],

  transformIgnorePatterns: [
    "node_modules/(?!(" +
      "react-native" +
      "|@react-native" +
      "|@react-navigation" +
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
      ")/)"
  ],

  moduleNameMapper: {
    "^expo-modules-core$": "<rootDir>/node_modules/expo-modules-core",
  },
};
