const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();
const mockMultiRemove = jest.fn();
const mockDispatchSetUnreadCount = jest.fn();
const mockGetNotifications = jest.fn();
const mockNavigateSafely = jest.fn();
const mockPlainAxiosGet = jest.fn();
const mockPlainAxiosPost = jest.fn();
const mockSubscribeToTopic = jest.fn();
const mockUnsubscribeFromTopic = jest.fn();
const mockGetTopicSyncPlan = jest.fn();

const mockAuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
  EPHEMERAL: 3,
};

let foregroundMessageHandler;

const mockGetToken = jest.fn();
const mockGetAPNSToken = jest.fn();
const mockIsDeviceRegisteredForRemoteMessages = jest.fn();
const mockRegisterDeviceForRemoteMessages = jest.fn();
const mockOnMessage = jest.fn();
const mockOnNotificationOpenedApp = jest.fn();
const mockOnTokenRefresh = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetInitialNotification = jest.fn();

let handleNotificationOpen;
let initializeFcm;
let fetchTopicsFromServer;

const loadFcmService = () => {
  jest.resetModules();

  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: {
      manifest: {
        extra: {
          fcmRegistrationMethod:
            "whatsapp_saudi.whatsapp_saudi.doctype.whatsapp_saudi.whatsapp_saudi.get_or_update_employee_token",
        },
      },
      expoConfig: {
        extra: {
          fcmRegistrationMethod:
            "whatsapp_saudi.whatsapp_saudi.doctype.whatsapp_saudi.whatsapp_saudi.get_or_update_employee_token",
        },
      },
    },
  }));

  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: {
      getItem: (...args) => mockGetItem(...args),
      setItem: (...args) => mockSetItem(...args),
      removeItem: (...args) => mockRemoveItem(...args),
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
    getAPNSToken: (...args) => mockGetAPNSToken(...args),
    getInitialNotification: (...args) => mockGetInitialNotification(...args),
    getMessaging: jest.fn(() => ({ appName: "[DEFAULT]" })),
    getToken: (...args) => mockGetToken(...args),
    isDeviceRegisteredForRemoteMessages: (...args) =>
      mockIsDeviceRegisteredForRemoteMessages(...args),
    onMessage: (...args) => mockOnMessage(...args),
    onNotificationOpenedApp: (...args) => mockOnNotificationOpenedApp(...args),
    onTokenRefresh: (...args) => mockOnTokenRefresh(...args),
    registerDeviceForRemoteMessages: (...args) =>
      mockRegisterDeviceForRemoteMessages(...args),
    requestPermission: (...args) => mockRequestPermission(...args),
    setBackgroundMessageHandler: jest.fn(),
    subscribeToTopic: (...args) => mockSubscribeToTopic(...args),
    unsubscribeFromTopic: (...args) => mockUnsubscribeFromTopic(...args),
  }));

  jest.doMock("../services/api/apiClient", () => ({
    plainAxios: {
      post: (...args) => mockPlainAxiosPost(...args),
      get: (...args) => mockPlainAxiosGet(...args),
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
    getTopicSyncPlan: (...args) => mockGetTopicSyncPlan(...args),
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
    fetchTopicsFromServer,
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
    mockRemoveItem.mockResolvedValue(undefined);
    mockMultiRemove.mockResolvedValue(undefined);
    mockDispatchSetUnreadCount.mockImplementation((count) => ({
      type: "notification/setUnreadCount",
      payload: count,
    }));
    mockGetNotifications.mockResolvedValue([{ read: 0 }, { read: 1 }]);
    mockNavigateSafely.mockReturnValue(true);
    mockPlainAxiosGet.mockResolvedValue({ status: 200, data: {} });
    mockPlainAxiosPost.mockResolvedValue({ status: 200, data: {} });
    mockSubscribeToTopic.mockResolvedValue(undefined);
    mockUnsubscribeFromTopic.mockResolvedValue(undefined);
    mockGetTopicSyncPlan.mockReturnValue({
      topicsToSubscribe: [],
      topicsToUnsubscribe: [],
      syncedTopics: [],
    });

    mockGetToken.mockResolvedValue("test-fcm-token");
    mockGetAPNSToken.mockResolvedValue("test-apns-token");
    mockIsDeviceRegisteredForRemoteMessages.mockReturnValue(true);
    mockRegisterDeviceForRemoteMessages.mockResolvedValue(undefined);
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
      routeName: "Notifications",
      params: {
        type: "announcement",
      },
    });
  });

  it("maps notification payload routes to the Notifications screen", async () => {
    const dispatch = jest.fn();
    const onForegroundNotification = jest.fn();

    await initializeFcm({ dispatch, onForegroundNotification });

    expect(typeof foregroundMessageHandler).toBe("function");

    const remoteMessage = {
      data: {
        type: "notification",
        screen: "Notification",
      },
    };

    await foregroundMessageHandler(remoteMessage);

    expect(onForegroundNotification).toHaveBeenCalledWith({
      remoteMessage,
      title: "New update",
      body: "You have a new notification.",
      data: {
        type: "notification",
        screen: "Notification",
      },
      type: "notification",
      routeName: "Notifications",
      params: {
        type: "notification",
      },
    });
  });

  it("logs iOS APNS diagnostics during initialization", async () => {
    await initializeFcm({
      dispatch: jest.fn(),
      onForegroundNotification: jest.fn(),
    });

    expect(mockIsDeviceRegisteredForRemoteMessages).toHaveBeenCalledWith({
      appName: "[DEFAULT]",
    });
    expect(mockGetAPNSToken).toHaveBeenCalledWith({ appName: "[DEFAULT]" });
  });

  it("registers iOS for remote messages before requesting the token", async () => {
    mockIsDeviceRegisteredForRemoteMessages
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    await initializeFcm({
      dispatch: jest.fn(),
      onForegroundNotification: jest.fn(),
    });

    expect(mockRegisterDeviceForRemoteMessages).toHaveBeenCalledWith({
      appName: "[DEFAULT]",
    });
    expect(mockGetToken).toHaveBeenCalledWith({ appName: "[DEFAULT]" });
    expect(mockGetAPNSToken).toHaveBeenCalledWith({ appName: "[DEFAULT]" });
  });

  it("uses metadata data when opening a notification", async () => {
    const dispatch = jest.fn();

    mockNavigateSafely.mockReturnValue(false);

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

    expect(mockNavigateSafely).toHaveBeenCalledTimes(1);
    expect(mockNavigateSafely).toHaveBeenCalledWith("Notifications", {
      type: "announcement",
    });
  });

  it("pushes the refreshed token and resets the topic baseline on token refresh", async () => {
    let tokenRefreshHandler;
    mockOnTokenRefresh.mockImplementation((_instance, handler) => {
      tokenRefreshHandler = handler;
      return jest.fn();
    });

    mockGetItem.mockImplementation(async (key) => {
      if (key === "baseUrl") return "https://aysha.erpgulf.com";
      if (key === "access_token") return "auth-token";
      if (key === "employee_id") return "EMP-001";
      if (key === "fcm_token") return "old-fcm-token";
      return null;
    });

    mockPlainAxiosPost.mockResolvedValue({
      status: 200,
      data: {
        data: { employee: "EMP-001", topics: ["General"], token_updated: true },
      },
    });

    await initializeFcm({
      dispatch: jest.fn(),
      onForegroundNotification: jest.fn(),
    });

    expect(typeof tokenRefreshHandler).toBe("function");

    // initializeFcm itself does not POST; isolate the refresh-triggered work.
    mockPlainAxiosPost.mockClear();
    mockRemoveItem.mockClear();

    await tokenRefreshHandler("new-fcm-token");

    // The rotated token is pushed to the backend...
    expect(mockPlainAxiosPost).toHaveBeenCalledTimes(1);
    const [, requestBody] = mockPlainAxiosPost.mock.calls[0];
    expect(String(requestBody)).toContain("new-fcm-token");

    // ...and the topic cache is cleared so the new token re-subscribes.
    expect(mockRemoveItem).toHaveBeenCalledWith("fcm_topics");
  });

  it("reuses POST topics when the server reports token_updated false", async () => {
    mockGetItem.mockImplementation(async (key) => {
      if (key === "baseUrl") {
        return "https://aysha.erpgulf.com";
      }

      if (key === "access_token") {
        return "auth-token";
      }

      if (key === "employee_id") {
        return "EMP-001";
      }

      if (key === "fcm_token") {
        return "cached-fcm-token";
      }

      if (key === "fcm_topics") {
        return JSON.stringify(["alertMessage"]);
      }

      return null;
    });

    mockPlainAxiosGet.mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          employee: "EMP-001",
          topics: ["alertMessage", "General"],
          token_updated: false,
        },
      },
    });

    mockPlainAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        data: {
          employee: "EMP-001",
          topics: ["alertMessage", "General"],
          token_updated: false,
        },
      },
    });

    mockGetTopicSyncPlan.mockReturnValue({
      topicsToSubscribe: ["General"],
      topicsToUnsubscribe: [],
      syncedTopics: ["alertMessage", "General"],
    });

    const topics = await fetchTopicsFromServer();

    expect(topics).toEqual(["alertMessage", "General"]);
    expect(mockPlainAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockPlainAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToTopic).toHaveBeenCalledWith(
      { appName: "[DEFAULT]" },
      "General",
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      "fcm_topics",
      JSON.stringify(["alertMessage", "General"]),
    );
  });
});
