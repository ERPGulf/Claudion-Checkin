import "@testing-library/jest-native/extend-expect";

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
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
