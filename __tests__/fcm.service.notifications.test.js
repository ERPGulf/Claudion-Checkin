const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockMultiRemove = jest.fn();
const mockDispatchSetUnreadCount = jest.fn();
const mockGetNotifications = jest.fn();
const mockNavigateSafely = jest.fn();

const mockAuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
  EPHEMERAL: 3,
};

let foregroundMessageHandler;

const mockGetToken = jest.fn();
const mockOnMessage = jest.fn();
const mockOnNotificationOpenedApp = jest.fn();
const mockOnTokenRefresh = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetInitialNotification = jest.fn();

let handleNotificationOpen;
let initializeFcm;

const loadFcmService = () => {
  jest.resetModules();

  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: {
      manifest: {
        extra: {},
      },
      expoConfig: {
        extra: {},
      },
    },
  }));

  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: {
      getItem: (...args) => mockGetItem(...args),
      setItem: (...args) => mockSetItem(...args),
      multiRemove: (...args) => mockMultiRemove(...args),
    },
  }));

  jest.doMock("@react-native-firebase/app", () => ({
    getApp: jest.fn(() => ({ name: "[DEFAULT]" })),
    getApps: jest.fn(() => [{ name: "[DEFAULT]" }]),
  }));

  jest.doMock("@react-native-firebase/messaging", () => ({
    AuthorizationStatus: mockAuthorizationStatus,
    deleteToken: jest.fn(() => Promise.resolve()),
    getInitialNotification: (...args) => mockGetInitialNotification(...args),
    getMessaging: jest.fn(() => ({ appName: "[DEFAULT]" })),
    getToken: (...args) => mockGetToken(...args),
    onMessage: (...args) => mockOnMessage(...args),
    onNotificationOpenedApp: (...args) => mockOnNotificationOpenedApp(...args),
    onTokenRefresh: (...args) => mockOnTokenRefresh(...args),
    requestPermission: (...args) => mockRequestPermission(...args),
    setBackgroundMessageHandler: jest.fn(),
    subscribeToTopic: jest.fn(() => Promise.resolve()),
    unsubscribeFromTopic: jest.fn(() => Promise.resolve()),
  }));

  jest.doMock("../services/api/apiClient", () => ({
    plainAxios: {
      post: jest.fn(),
      get: jest.fn(),
    },
  }));

  jest.doMock("../services/api/utils", () => ({
    cleanBaseUrl: (value) => value,
    setCommonHeaders: () => ({}),
  }));

  jest.doMock("../services/api/notification.service", () => ({
    getNotifications: (...args) => mockGetNotifications(...args),
  }));

  jest.doMock("../redux/Slices/notificationSlice", () => ({
    setUnreadCount: (...args) => mockDispatchSetUnreadCount(...args),
  }));

  jest.doMock("../navigation/rootNavigation", () => ({
    navigateSafely: (...args) => mockNavigateSafely(...args),
  }));

  jest.doMock("../utils/fcmTopics", () => ({
    getSanitizedTopics: jest.fn((topics) =>
      Array.isArray(topics) ? topics.filter(Boolean) : [],
    ),
    getTopicSyncPlan: jest.fn(() => ({
      topicsToSubscribe: [],
      topicsToUnsubscribe: [],
      syncedTopics: [],
    })),
  }));

  const { Platform } = require("react-native");

  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: "ios",
  });
  Object.defineProperty(Platform, "Version", {
    configurable: true,
    value: 17,
  });

  ({
    handleNotificationOpen,
    initializeFcm,
  } = require("../services/notifications/fcm.service"));
};

describe("FCM notification metadata handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    foregroundMessageHandler = undefined;

    mockGetItem.mockImplementation(async (key) => {
      if (key === "employee_id") {
        return "EMP-001";
      }

      return null;
    });

    mockSetItem.mockResolvedValue(undefined);
    mockMultiRemove.mockResolvedValue(undefined);
    mockDispatchSetUnreadCount.mockImplementation((count) => ({
      type: "notification/setUnreadCount",
      payload: count,
    }));
    mockGetNotifications.mockResolvedValue([{ read: 0 }, { read: 1 }]);
    mockNavigateSafely.mockReturnValue(true);

    mockGetToken.mockResolvedValue("test-fcm-token");
    mockRequestPermission.mockResolvedValue(mockAuthorizationStatus.AUTHORIZED);
    mockGetInitialNotification.mockResolvedValue(null);

    mockOnTokenRefresh.mockImplementation((_instance, handler) => {
      void handler;
      return jest.fn();
    });

    mockOnMessage.mockImplementation((_instance, handler) => {
      foregroundMessageHandler = handler;
      return jest.fn();
    });

    mockOnNotificationOpenedApp.mockImplementation((_instance, handler) => {
      void handler;
      return jest.fn();
    });

    loadFcmService();
  });

  it("passes metadata data through the foreground callback", async () => {
    const dispatch = jest.fn();
    const onForegroundNotification = jest.fn();

    await initializeFcm({ dispatch, onForegroundNotification });

    expect(typeof foregroundMessageHandler).toBe("function");

    const remoteMessage = {
      notification: {
        title: "Company update",
        body: "Town hall at 4 PM",
      },
      metadata: {
        data: {
          type: "announcement",
          screen: "announcement",
        },
      },
    };

    await foregroundMessageHandler(remoteMessage);

    expect(onForegroundNotification).toHaveBeenCalledWith({
      remoteMessage,
      title: "Company update",
      body: "Town hall at 4 PM",
      data: {
        type: "announcement",
        screen: "announcement",
      },
      type: "announcement",
      routeName: "announcement",
      params: {
        type: "announcement",
      },
    });
  });

  it("uses metadata data when opening a notification", async () => {
    const dispatch = jest.fn();

    mockNavigateSafely.mockReturnValueOnce(false).mockReturnValueOnce(true);

    await handleNotificationOpen(
      {
        metadata: {
          data: {
            type: "announcement",
            screen: "announcement",
          },
        },
      },
      dispatch,
    );

    expect(mockNavigateSafely).toHaveBeenNthCalledWith(1, "announcement", {
      type: "announcement",
    });
    expect(mockNavigateSafely).toHaveBeenNthCalledWith(2, "Notifications", {
      type: "announcement",
    });
  });
});
