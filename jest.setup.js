import "@testing-library/jest-native/extend-expect";

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Mock expo modules
jest.mock("expo-constants", () => ({
  default: {
    manifest: {
      extra: {},
    },
    expoConfig: {
      extra: {},
    },
  },
}));

// expo-location ships untransformed ESM, so any suite that transitively imports
// the attendance stack fails to parse it. Several suites already declared their
// own `jest.mock("expo-location", …)` for exactly this reason; this is that same
// stub as a default, so a new import in the attendance chain does not break
// unrelated suites. A file-level jest.mock still wins, so the suites that stub
// specific position helpers are unaffected.
jest.mock("expo-location", () => ({
  __esModule: true,
  Accuracy: { Balanced: 3, Highest: 6 },
  getForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "denied" }),
  ),
  getBackgroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "denied" }),
  ),
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "denied" }),
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.reject(new Error("location unavailable in tests")),
  ),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
}));

// expo-sqlite ships untransformed ESM and reaches for the native bridge, so any
// suite that transitively imports the offline queue would fail to parse it.
// This default keeps those suites working without boilerplate; the two suites
// that actually exercise the queue override it with the WASM-backed mock in
// test-utils/expoSqliteMock.js, and a file-level jest.mock wins over this one.
jest.mock("expo-sqlite", () => ({
  __esModule: true,
  openDatabaseAsync: jest.fn(() =>
    Promise.reject(new Error("expo-sqlite is not mocked in this suite")),
  ),
}));

// NetInfo's real module reaches for the native bridge at import time. The
// default is "online", so a test that never touches connectivity behaves as it
// would with a working connection; tests that care override these.
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() =>
      Promise.resolve({
        isConnected: true,
        isInternetReachable: true,
        type: "wifi",
      }),
    ),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock("@react-native-firebase/messaging", () => {
  const messagingInstance = {
    registerDeviceForRemoteMessages: jest.fn(() => Promise.resolve()),
    requestPermission: jest.fn(() => Promise.resolve(1)),
    getToken: jest.fn(() => Promise.resolve("test-fcm-token")),
    deleteToken: jest.fn(() => Promise.resolve()),
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
    setBackgroundMessageHandler: jest.fn(),
    AuthorizationStatus: {
      NOT_DETERMINED: -1,
      DENIED: 0,
      AUTHORIZED: 1,
      PROVISIONAL: 2,
      EPHEMERAL: 3,
    },
  };

  const messaging = () => messagingInstance;
  messaging.AuthorizationStatus = messagingInstance.AuthorizationStatus;

  return messaging;
});
