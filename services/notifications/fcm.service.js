import { PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps } from "@react-native-firebase/app";
import {
  AuthorizationStatus,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  setBackgroundMessageHandler,
  subscribeToTopic,
  unsubscribeFromTopic,
} from "@react-native-firebase/messaging";
import Constants from "expo-constants";
import { plainAxios } from "../api/apiClient";
import { cleanBaseUrl, setCommonHeaders } from "../api/utils";
import { getNotifications } from "../api/notification.service";
import { setUnreadCount } from "../../redux/Slices/notificationSlice";
import { navigateSafely } from "../../navigation/rootNavigation";

const FCM_TOKEN_KEY = "fcm_token";
const FCM_LAST_MESSAGE_AT_KEY = "fcm_last_message_at";
const FCM_TOPICS_KEY = "fcm_topics";
const DEFAULT_NOTIFICATION_ROUTE = "Notifications";

let backgroundHandlerRegistered = false;

const wait = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const getMessagingInstanceWithRetry = async ({
  maxAttempts = 8,
  retryDelayMs = 250,
} = {}) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const instance = getMessagingInstance();

    if (instance) {
      return instance;
    }

    if (attempt < maxAttempts - 1) {
      await wait(retryDelayMs);
    }
  }

  return null;
};

const getMessagingInstance = () => {
  try {
    if (getApps().length === 0) {
      return null;
    }

    return getMessaging(getApp());
  } catch {
    return null;
  }
};

const getExpoExtra = () => {
  return Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};
};

const getRegistrationMethod = () => {
  const extra = getExpoExtra();
  const registrationMethod = extra?.fcmRegistrationMethod;

  if (typeof registrationMethod !== "string") {
    return "";
  }

  return registrationMethod.trim();
};

const buildFcmRegistrationUrl = (methodPath, baseUrl) => {
  if (!methodPath) {
    return "";
  }

  if (/^https?:\/\//i.test(methodPath)) {
    return methodPath;
  }

  if (!baseUrl) {
    return "";
  }

  const normalizedMethodPath = methodPath
    .replace(/^\/+/, "")
    .replace(/^api\/method\//, "");

  return `${cleanBaseUrl(baseUrl)}/api/method/${normalizedMethodPath}`;
};

const getMessageTitle = (remoteMessage) => {
  const notificationTitle = remoteMessage?.notification?.title;
  const dataTitle = remoteMessage?.data?.title;

  return notificationTitle || dataTitle || "New update";
};

const getMessageBody = (remoteMessage) => {
  const notificationBody = remoteMessage?.notification?.body;
  const dataBody = remoteMessage?.data?.body || remoteMessage?.data?.message;

  return notificationBody || dataBody || "You have a new notification.";
};

const parseRouteParams = (data = {}) => {
  const rawParams = data.params ?? data.routeParams;
  let parsedParams = {};

  if (typeof rawParams === "string" && rawParams.trim()) {
    try {
      parsedParams = JSON.parse(rawParams);
    } catch {
      parsedParams = {};
    }
  }

  if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
    parsedParams = rawParams;
  }

  const payloadParams = { ...data };
  delete payloadParams.route;
  delete payloadParams.screen;
  delete payloadParams.navigateTo;
  delete payloadParams.params;
  delete payloadParams.routeParams;

  return {
    ...payloadParams,
    ...parsedParams,
  };
};

const getTargetRoute = (remoteMessage) => {
  const routeFromPayload =
    remoteMessage?.data?.route ||
    remoteMessage?.data?.screen ||
    remoteMessage?.data?.navigateTo;

  if (!routeFromPayload || typeof routeFromPayload !== "string") {
    return DEFAULT_NOTIFICATION_ROUTE;
  }

  return routeFromPayload.trim() || DEFAULT_NOTIFICATION_ROUTE;
};

const extractTopicSyncData = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }

  if (payload.message && typeof payload.message === "object") {
    return payload.message;
  }

  return payload;
};

const getSanitizedTopics = (topics) => {
  if (!Array.isArray(topics)) {
    return [];
  }

  return topics
    .filter((topic) => typeof topic === "string")
    .map((topic) => topic.trim())
    .filter(Boolean);
};

const getStoredTopics = async () => {
  try {
    const serializedTopics = await AsyncStorage.getItem(FCM_TOPICS_KEY);

    if (!serializedTopics) {
      return [];
    }

    const parsedTopics = JSON.parse(serializedTopics);
    return getSanitizedTopics(parsedTopics);
  } catch {
    return [];
  }
};

const syncTopicsFromBackend = async (messagingInstance, topics) => {
  if (!messagingInstance) {
    return;
  }

  const nextTopics = getSanitizedTopics(topics);
  const currentTopics = await getStoredTopics();

  console.log("[FCM] syncTopicsFromBackend: next topics", nextTopics);
  console.log("[FCM] syncTopicsFromBackend: current topics", currentTopics);

  const nextSet = new Set(nextTopics);
  const currentSet = new Set(currentTopics);

  const topicsToSubscribe = nextTopics.filter(
    (topic) => !currentSet.has(topic),
  );
  const topicsToUnsubscribe = currentTopics.filter(
    (topic) => !nextSet.has(topic),
  );

  console.log("[FCM] topics to subscribe:", topicsToSubscribe);
  console.log("[FCM] topics to unsubscribe:", topicsToUnsubscribe);

  await Promise.all(
    topicsToSubscribe.map(async (topic) => {
      try {
        await subscribeToTopic(messagingInstance, topic);
        console.log("[FCM] subscribed to topic:", topic);
      } catch (err) {
        // Ignore per-topic subscription failures to keep bootstrap resilient.
        console.log("[FCM] failed to subscribe to topic:", topic, err?.message);
      }
    }),
  );

  await Promise.all(
    topicsToUnsubscribe.map(async (topic) => {
      try {
        await unsubscribeFromTopic(messagingInstance, topic);
        console.log("[FCM] unsubscribed from topic:", topic);
      } catch (err) {
        // Ignore per-topic unsubscription failures to keep bootstrap resilient.
        console.log(
          "[FCM] failed to unsubscribe from topic:",
          topic,
          err?.message,
        );
      }
    }),
  );

  try {
    await AsyncStorage.setItem(FCM_TOPICS_KEY, JSON.stringify(nextTopics));
  } catch {
    // Ignore storage issues and continue app startup.
  }
};

const syncTokenToBackend = async (token) => {
  const registrationMethod = getRegistrationMethod();

  if (!registrationMethod || !token) {
    return;
  }

  const [baseUrl, authToken, employeeId] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_id"),
  ]);

  console.log("[FCM] baseUrl for token sync:", baseUrl);

  if (!baseUrl || !authToken) {
    return;
  }

  const registrationUrl = buildFcmRegistrationUrl(registrationMethod, baseUrl);

  if (!registrationUrl) {
    return;
  }

  console.log("[FCM] registration method:", registrationMethod);
  console.log("[FCM] full registration url:", registrationUrl);

  const body = new URLSearchParams();
  body.append("token", token);
  body.append("fcm_token", token);
  body.append("platform", Platform.OS);

  if (employeeId) {
    body.append("employee", employeeId);
  }

  try {
    const response = await plainAxios.post(registrationUrl, body.toString(), {
      headers: {
        ...setCommonHeaders(),
        Authorization: `Bearer ${authToken}`,
      },
      timeout: 10000,
    });

    console.log("[FCM] token sync status:", response?.status);

    const topicData = extractTopicSyncData(response?.data);
    console.log("[FCM] topics from server:", topicData?.topics);

    const messagingInstance = await getMessagingInstanceWithRetry();

    if (!messagingInstance) {
      console.log(
        "[FCM] messaging instance unavailable, skipping topic subscribe",
      );
      return;
    }

    if (Array.isArray(topicData?.topics)) {
      console.log("[FCM] starting topic sync after login");
      await syncTopicsFromBackend(messagingInstance, topicData.topics);
      console.log("[FCM] topic sync complete");
    }
  } catch (error) {
    console.log("[FCM] token sync failed:", error?.message);
    console.log("[FCM] token sync error status:", error?.response?.status);
    console.log("[FCM] token sync error data:", error?.response?.data);
    // Keep FCM bootstrap resilient even when registration API is unavailable.
  }
};

const persistFcmToken = async (token) => {
  if (!token) {
    console.log("[FCM] persistFcmToken: token is empty");
    return;
  }

  console.log(
    "[FCM] persistFcmToken: storing token",
    token.substring(0, 20) + "...",
  );

  const previousToken = await AsyncStorage.getItem(FCM_TOKEN_KEY);

  if (previousToken === token) {
    console.log("[FCM] persistFcmToken: token unchanged");
    // Token unchanged; store locally but don't sync until after login.
    return;
  }

  // Store new token locally but don't send to backend until user logs in.
  await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
  console.log("[FCM] persistFcmToken: token saved to AsyncStorage");
};

const requestAndroidNotificationPermission = async () => {
  if (Platform.OS !== "android" || Platform.Version < 33) {
    return true;
  }

  try {
    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );

    return status === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

export const requestFcmPermission = async () => {
  const androidAllowed = await requestAndroidNotificationPermission();

  if (!androidAllowed) {
    return false;
  }

  const messagingInstance = await getMessagingInstanceWithRetry();

  if (!messagingInstance) {
    return false;
  }

  try {
    const authStatus = await requestPermission(messagingInstance, {
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    });

    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL ||
      authStatus === AuthorizationStatus.EPHEMERAL
    );
  } catch {
    return false;
  }
};

export const syncUnreadCountFromServer = async (dispatch) => {
  if (typeof dispatch !== "function") {
    return;
  }

  try {
    const employeeId = await AsyncStorage.getItem("employee_id");

    if (!employeeId) {
      return;
    }

    const notifications = await getNotifications(employeeId);
    const unreadCount = notifications.filter(
      (item) => Number(item.read) === 0,
    ).length;

    dispatch(setUnreadCount(unreadCount));
  } catch {
    // Ignore notification refresh failures.
  }
};

export const handleNotificationOpen = async (remoteMessage, dispatch) => {
  if (!remoteMessage) {
    return;
  }

  await syncUnreadCountFromServer(dispatch);

  const routeName = getTargetRoute(remoteMessage);
  const params = parseRouteParams(remoteMessage?.data);

  const navigated = navigateSafely(routeName, params);

  if (!navigated && routeName !== DEFAULT_NOTIFICATION_ROUTE) {
    navigateSafely(DEFAULT_NOTIFICATION_ROUTE, params);
  }
};

export const registerBackgroundMessageHandler = () => {
  if (backgroundHandlerRegistered) {
    return;
  }

  const messagingInstance = getMessagingInstance();

  if (!messagingInstance) {
    return;
  }

  setBackgroundMessageHandler(messagingInstance, async () => {
    await AsyncStorage.setItem(FCM_LAST_MESSAGE_AT_KEY, String(Date.now()));
  });

  backgroundHandlerRegistered = true;
};

export const initializeFcm = async ({
  dispatch,
  onForegroundNotification,
} = {}) => {
  const messagingInstance = await getMessagingInstanceWithRetry();

  if (!messagingInstance) {
    return () => {};
  }

  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    return () => {};
  }

  try {
    console.log("[FCM] initializeFcm: requesting token");
    const token = await getToken(messagingInstance);
    console.log(
      "[FCM] initializeFcm: token received",
      token ? token.substring(0, 20) + "..." : "null",
    );
    await persistFcmToken(token);
  } catch (error) {
    console.log("[FCM] initializeFcm: token fetch failed", error?.message);
    // Do not block app startup if token retrieval fails.
  }

  await syncUnreadCountFromServer(dispatch);

  const unsubscribeTokenRefresh = onTokenRefresh(
    messagingInstance,
    async (token) => {
      await persistFcmToken(token);
    },
  );

  const unsubscribeForeground = onMessage(
    messagingInstance,
    async (remoteMessage) => {
      await AsyncStorage.setItem(FCM_LAST_MESSAGE_AT_KEY, String(Date.now()));
      await syncUnreadCountFromServer(dispatch);

      if (typeof onForegroundNotification === "function") {
        onForegroundNotification({
          remoteMessage,
          title: getMessageTitle(remoteMessage),
          body: getMessageBody(remoteMessage),
        });
      }
    },
  );

  const unsubscribeNotificationOpen = onNotificationOpenedApp(
    messagingInstance,
    async (remoteMessage) => {
      await handleNotificationOpen(remoteMessage, dispatch);
    },
  );

  try {
    const initialMessage = await getInitialNotification(messagingInstance);

    if (initialMessage) {
      await handleNotificationOpen(initialMessage, dispatch);
    }
  } catch {
    // Ignore initial notification parsing errors.
  }

  return () => {
    unsubscribeTokenRefresh();
    unsubscribeForeground();
    unsubscribeNotificationOpen();
  };
};

export const getClientFcmToken = async () => {
  const cachedToken = await AsyncStorage.getItem(FCM_TOKEN_KEY);

  if (cachedToken) {
    return cachedToken;
  }

  const messagingInstance = await getMessagingInstanceWithRetry();

  if (!messagingInstance) {
    return null;
  }

  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    return null;
  }

  try {
    const token = await getToken(messagingInstance);

    if (!token) {
      return null;
    }

    await persistFcmToken(token);
    return token;
  } catch {
    return null;
  }
};

export const syncFcmTokenAfterLogin = async () => {
  console.log("[FCM] syncFcmTokenAfterLogin called");

  const token = await AsyncStorage.getItem(FCM_TOKEN_KEY);
  console.log(
    "[FCM] syncFcmTokenAfterLogin: token from AsyncStorage",
    token ? token.substring(0, 20) + "..." : "null",
  );

  if (!token) {
    console.log("[FCM] No token stored, skipping sync");
    return;
  }

  console.log(
    "[FCM] syncFcmTokenAfterLogin: sending token and subscribing to topics",
  );
  await syncTokenToBackend(token);
  console.log("[FCM] syncFcmTokenAfterLogin: complete");
};

export const clearFcmRegistration = async () => {
  const messagingInstance = getMessagingInstance();

  try {
    if (messagingInstance) {
      await deleteToken(messagingInstance);
    }
  } catch {
    // Token deletion can fail if Firebase is not fully initialized.
  }

  if (messagingInstance) {
    const storedTopics = await getStoredTopics();

    await Promise.all(
      storedTopics.map(async (topic) => {
        try {
          await unsubscribeFromTopic(messagingInstance, topic);
        } catch {
          // Ignore topic cleanup failures during logout/reset.
        }
      }),
    );
  }

  await AsyncStorage.multiRemove([
    FCM_TOKEN_KEY,
    FCM_LAST_MESSAGE_AT_KEY,
    FCM_TOPICS_KEY,
  ]);
};
