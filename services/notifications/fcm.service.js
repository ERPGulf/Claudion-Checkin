import { PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps } from "@react-native-firebase/app";
import {
  AuthorizationStatus,
  deleteToken,
  getAPNSToken,
  getInitialNotification,
  getMessaging,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
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
import { getSanitizedTopics, getTopicSyncPlan } from "../../utils/fcmTopics";

const FCM_TOKEN_KEY = "fcm_token";
const FCM_LAST_MESSAGE_AT_KEY = "fcm_last_message_at";
const FCM_TOPICS_KEY = "fcm_topics";
const DEFAULT_NOTIFICATION_ROUTE = "Notifications";
const ROUTE_ALIASES = {
  notification: DEFAULT_NOTIFICATION_ROUTE,
  notifications: DEFAULT_NOTIFICATION_ROUTE,
  announcement: DEFAULT_NOTIFICATION_ROUTE,
  announcements: DEFAULT_NOTIFICATION_ROUTE,
  annoncement: DEFAULT_NOTIFICATION_ROUTE,
  annoucement: DEFAULT_NOTIFICATION_ROUTE,
};

const TYPE_ALIASES = {
  notification: "notification",
  notifications: "notification",
  general: "notification",
  announcement: "announcement",
  announcements: "announcement",
  alertmessage: "announcement",
  annoncement: "announcement",
  annoucement: "announcement",
};

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

const getAuthorizationStatusLabel = (status) => {
  switch (status) {
    case AuthorizationStatus.NOT_DETERMINED:
      return "NOT_DETERMINED";
    case AuthorizationStatus.DENIED:
      return "DENIED";
    case AuthorizationStatus.AUTHORIZED:
      return "AUTHORIZED";
    case AuthorizationStatus.PROVISIONAL:
      return "PROVISIONAL";
    case AuthorizationStatus.EPHEMERAL:
      return "EPHEMERAL";
    default:
      return "UNKNOWN";
  }
};

const formatTokenForLogs = (token) => {
  if (!token || typeof token !== "string") {
    return "null";
  }

  const prefixLength = Math.min(token.length, 20);
  return `${token.slice(0, prefixLength)}... (${token.length} chars)`;
};

const logIosPushDiagnostics = async (messagingInstance, authStatus, source) => {
  if (Platform.OS !== "ios" || !messagingInstance) {
    return;
  }

  if (typeof authStatus !== "undefined") {
    console.log(
      `[FCM] ${source}: auth status =`,
      authStatus,
      getAuthorizationStatusLabel(authStatus),
    );
  }

  try {
    console.log(
      `[FCM] ${source}: isDeviceRegisteredForRemoteMessages =`,
      isDeviceRegisteredForRemoteMessages(messagingInstance),
    );
  } catch (error) {
    console.log(
      `[FCM] ${source}: failed to read device registration state`,
      error?.message,
    );
  }

  try {
    const apnsToken = await getAPNSToken(messagingInstance);
    console.log(`[FCM] ${source}: APNS token =`, formatTokenForLogs(apnsToken));
  } catch (error) {
    console.log(`[FCM] ${source}: failed to read APNS token`, error?.message);
  }
};

const ensureIosDeviceRegisteredForRemoteMessages = async (
  messagingInstance,
  source,
) => {
  if (Platform.OS !== "ios" || !messagingInstance) {
    return true;
  }

  try {
    const isRegistered = isDeviceRegisteredForRemoteMessages(messagingInstance);

    console.log(
      `[FCM] ${source}: isDeviceRegisteredForRemoteMessages =`,
      isRegistered,
    );

    if (isRegistered) {
      return true;
    }

    console.log(`[FCM] ${source}: registering device for remote messages`);
    await registerDeviceForRemoteMessages(messagingInstance);

    console.log(`[FCM] ${source}: registerDeviceForRemoteMessages completed`);

    return true;
  } catch (error) {
    console.log(
      `[FCM] ${source}: registerDeviceForRemoteMessages failed`,
      error?.message,
    );
    return false;
  }
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

const normalizeMessageData = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsedValue = JSON.parse(value);

      if (
        parsedValue &&
        typeof parsedValue === "object" &&
        !Array.isArray(parsedValue)
      ) {
        return parsedValue;
      }
    } catch {
      return {};
    }
  }

  return {};
};

const normalizePayloadToken = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z]/g, "");
};

const getMessageData = (remoteMessage) => {
  const candidates = [
    remoteMessage?.data,
    remoteMessage?.metadata?.data,
    remoteMessage?.notification?.data,
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMessageData(candidate);

    if (Object.keys(normalizedCandidate).length > 0) {
      return normalizedCandidate;
    }
  }

  return normalizeMessageData(remoteMessage?.data);
};

const getMessageType = (remoteMessage) => {
  const messageData = getMessageData(remoteMessage);
  const normalizedType = normalizePayloadToken(messageData.type);

  if (!normalizedType) {
    return "";
  }

  return TYPE_ALIASES[normalizedType] || normalizedType;
};

const getMessageTitle = (remoteMessage) => {
  const messageData = getMessageData(remoteMessage);
  const notificationTitle = remoteMessage?.notification?.title;
  const dataTitle = messageData.title;

  return notificationTitle || dataTitle || "New update";
};

const getMessageBody = (remoteMessage) => {
  const messageData = getMessageData(remoteMessage);
  const notificationBody = remoteMessage?.notification?.body;
  const dataBody = messageData.body || messageData.message;

  return notificationBody || dataBody || "You have a new notification.";
};

const logNotificationPayload = (source, remoteMessage) => {
  const messageData = getMessageData(remoteMessage);

  try {
    console.log(
      `[FCM] ${source}: messageId`,
      remoteMessage?.messageId || "n/a",
    );
    console.log(`[FCM] ${source}: from`, remoteMessage?.from || "n/a");
    console.log(`[FCM] ${source}: data`, JSON.stringify(messageData));
    console.log(
      `[FCM] ${source}: notification`,
      JSON.stringify(remoteMessage?.notification || {}),
    );
  } catch {
    // Logging should never interrupt notification handling.
  }
};

const logNotificationReceived = (source, remoteMessage) => {
  const messageType = getMessageType(remoteMessage);

  try {
    console.log("[FCM] new notification received", {
      source,
      title: getMessageTitle(remoteMessage),
      body: getMessageBody(remoteMessage),
      routeName: getTargetRoute(remoteMessage),
      type: messageType || "n/a",
    });
  } catch {
    // Logging should never interrupt notification handling.
  }
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
  const messageData = getMessageData(remoteMessage);
  const routeFromPayload =
    messageData.route || messageData.screen || messageData.navigateTo;
  const normalizedRoute = normalizePayloadToken(routeFromPayload);

  if (normalizedRoute && ROUTE_ALIASES[normalizedRoute]) {
    return ROUTE_ALIASES[normalizedRoute];
  }

  if (routeFromPayload && typeof routeFromPayload === "string") {
    const trimmedRoute = routeFromPayload.trim();

    if (trimmedRoute) {
      return trimmedRoute;
    }
  }

  const messageType = getMessageType(remoteMessage);
  const routeFromType = ROUTE_ALIASES[normalizePayloadToken(messageType)];

  if (routeFromType) {
    return routeFromType;
  }

  return DEFAULT_NOTIFICATION_ROUTE;
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
  const { topicsToSubscribe, topicsToUnsubscribe, syncedTopics } =
    getTopicSyncPlan(currentTopics, nextTopics);

  console.log("[FCM] syncTopicsFromBackend: next topics", nextTopics);
  console.log("[FCM] syncTopicsFromBackend: current topics", currentTopics);

  console.log("[FCM] topics to subscribe:", topicsToSubscribe);
  console.log("[FCM] topics to unsubscribe:", topicsToUnsubscribe);

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

  try {
    await AsyncStorage.setItem(FCM_TOPICS_KEY, JSON.stringify(syncedTopics));
  } catch {
    // Ignore storage issues and continue app startup.
  }
};

const syncTokenToBackend = async (token) => {
  const registrationMethod = getRegistrationMethod();

  if (!registrationMethod || !token) {
    return null;
  }

  const [baseUrl, authToken, employeeId] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_id"),
  ]);

  console.log("[FCM] baseUrl for token sync:", baseUrl);

  if (!baseUrl || !authToken) {
    return null;
  }

  const registrationUrl = buildFcmRegistrationUrl(registrationMethod, baseUrl);

  if (!registrationUrl) {
    return null;
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
    console.log("[FCM] sending token to server:", {
      token: token ? `${token}` : "null",
      platform: Platform.OS,
      employeeId: employeeId || "n/a",
    });

    const response = await plainAxios.post(registrationUrl, body.toString(), {
      headers: {
        ...setCommonHeaders(),
        Authorization: `Bearer ${authToken}`,
      },
      timeout: 10000,
    });

    console.log("[FCM] token sync status:", response?.status);
    console.log("[FCM] POST API response:", response?.data);

    let topicData = extractTopicSyncData(response?.data);

    if (!Array.isArray(topicData?.topics)) {
      const topicsUrl = buildFcmRegistrationUrl(registrationMethod, baseUrl);
      const topicsResponse = await plainAxios.get(topicsUrl, {
        headers: {
          ...setCommonHeaders(),
          Authorization: `Bearer ${authToken}`,
        },
        timeout: 10000,
      });

      console.log("[FCM] GET topics response:", topicsResponse?.data);
      topicData = extractTopicSyncData(topicsResponse?.data);
    } else {
      console.log("[FCM] using topics from POST response");
    }

    console.log("[FCM] topics from server:", topicData?.topics);
    console.log("[FCM] topicData before sync:", topicData);

    const messagingInstance = await getMessagingInstanceWithRetry();

    if (!messagingInstance) {
      console.log(
        "[FCM] messaging instance unavailable, skipping topic subscribe",
      );
      return topicData?.topics || null;
    }

    if (Array.isArray(topicData?.topics)) {
      console.log("[FCM] starting topic sync after login");
      await syncTopicsFromBackend(messagingInstance, topicData.topics);
      console.log("[FCM] topic sync complete");
    }

    return topicData?.topics || null;
  } catch (error) {
    console.log("[FCM] token sync failed:", error?.message);
    console.log("[FCM] token sync error status:", error?.response?.status);
    console.log("[FCM] token sync error data:", error?.response?.data);
    // Keep FCM bootstrap resilient even when registration API is unavailable.
    return null;
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
    console.log(
      "[FCM] requestFcmPermission: Android POST_NOTIFICATIONS denied",
    );
    return false;
  }

  const messagingInstance = await getMessagingInstanceWithRetry();

  if (!messagingInstance) {
    console.log("[FCM] requestFcmPermission: messaging instance unavailable");
    return false;
  }

  const isRegistered = await ensureIosDeviceRegisteredForRemoteMessages(
    messagingInstance,
    "requestFcmPermission",
  );

  if (!isRegistered) {
    console.log(
      "[FCM] requestFcmPermission: device is not registered for remote messages",
    );
    return false;
  }

  try {
    const authStatus = await requestPermission(messagingInstance, {
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    });

    console.log(
      "[FCM] requestFcmPermission: auth status =",
      authStatus,
      getAuthorizationStatusLabel(authStatus),
    );
    await logIosPushDiagnostics(
      messagingInstance,
      authStatus,
      "requestFcmPermission",
    );

    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL ||
      authStatus === AuthorizationStatus.EPHEMERAL
    );
  } catch (error) {
    console.log(
      "[FCM] requestFcmPermission: permission request failed",
      error?.message,
    );
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

  logNotificationPayload("handleNotificationOpen", remoteMessage);

  await syncUnreadCountFromServer(dispatch);

  const routeName = getTargetRoute(remoteMessage);
  const params = parseRouteParams(getMessageData(remoteMessage));

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

  setBackgroundMessageHandler(messagingInstance, async (remoteMessage) => {
    logNotificationReceived("backgroundMessage", remoteMessage);
    logNotificationPayload("backgroundMessage", remoteMessage);
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
    console.log("[FCM] initializeFcm: messaging instance unavailable");
    return () => {};
  }

  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    console.log("[FCM] initializeFcm: notification permission not granted");
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
      const messageData = getMessageData(remoteMessage);

      logNotificationReceived("foregroundMessage", remoteMessage);
      logNotificationPayload("foregroundMessage", remoteMessage);
      await AsyncStorage.setItem(FCM_LAST_MESSAGE_AT_KEY, String(Date.now()));
      await syncUnreadCountFromServer(dispatch);

      if (typeof onForegroundNotification === "function") {
        onForegroundNotification({
          remoteMessage,
          title: getMessageTitle(remoteMessage),
          body: getMessageBody(remoteMessage),
          data: messageData,
          type: getMessageType(remoteMessage),
          routeName: getTargetRoute(remoteMessage),
          params: parseRouteParams(messageData),
        });
      }
    },
  );

  const unsubscribeNotificationOpen = onNotificationOpenedApp(
    messagingInstance,
    async (remoteMessage) => {
      logNotificationPayload("notificationOpenedApp", remoteMessage);
      await handleNotificationOpen(remoteMessage, dispatch);
    },
  );

  try {
    const initialMessage = await getInitialNotification(messagingInstance);

    if (initialMessage) {
      logNotificationPayload("initialNotification", initialMessage);
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
    console.log(
      "[FCM] getClientFcmToken: using cached token",
      formatTokenForLogs(cachedToken),
    );
    return cachedToken;
  }

  const messagingInstance = await getMessagingInstanceWithRetry();

  if (!messagingInstance) {
    console.log("[FCM] getClientFcmToken: messaging instance unavailable");
    return null;
  }

  const isRegistered = await ensureIosDeviceRegisteredForRemoteMessages(
    messagingInstance,
    "getClientFcmToken",
  );

  if (!isRegistered) {
    console.log(
      "[FCM] getClientFcmToken: device is not registered for remote messages",
    );
    return null;
  }

  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    console.log("[FCM] getClientFcmToken: notification permission not granted");
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

export const fetchTopicsFromServer = async () => {
  console.log("[FCM] fetchTopicsFromServer called");
  const startTime = Date.now();

  try {
    const registrationMethod = getRegistrationMethod();
    console.log(
      "[FCM] fetchTopicsFromServer: registrationMethod =",
      registrationMethod,
    );

    const baseUrl = await AsyncStorage.getItem("baseUrl");
    console.log("[FCM] fetchTopicsFromServer: baseUrl =", baseUrl);

    const authToken = await AsyncStorage.getItem("access_token");
    console.log("[FCM] fetchTopicsFromServer: authToken exists =", !!authToken);

    if (!registrationMethod || !baseUrl || !authToken) {
      console.log(
        "[FCM] fetchTopicsFromServer: missing config - method:",
        !!registrationMethod,
        "baseUrl:",
        !!baseUrl,
        "authToken:",
        !!authToken,
      );
      return null;
    }

    const topicsUrl = buildFcmRegistrationUrl(registrationMethod, baseUrl);
    console.log("[FCM] fetchTopicsFromServer: built topicsUrl =", topicsUrl);

    if (!topicsUrl) {
      console.log(
        "[FCM] fetchTopicsFromServer: invalid topics URL after build",
      );
      return null;
    }

    console.log(
      "[FCM] fetchTopicsFromServer: starting GET request to",
      topicsUrl,
    );
    const requestStartTime = Date.now();

    const response = await plainAxios.get(topicsUrl, {
      headers: {
        ...setCommonHeaders(),
        Authorization: `Bearer ${authToken}`,
      },
      timeout: 10000,
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log(
      "[FCM] fetchTopicsFromServer: GET request completed in",
      requestDuration,
      "ms",
    );
    console.log(
      "[FCM] fetchTopicsFromServer: response status =",
      response?.status,
    );
    console.log(
      "[FCM] fetchTopicsFromServer: response headers =",
      response?.headers,
    );
    console.log(
      "[FCM] fetchTopicsFromServer: response data =",
      JSON.stringify(response?.data),
    );

    const topicData = extractTopicSyncData(response?.data);
    console.log(
      "[FCM] fetchTopicsFromServer: extracted topicData =",
      JSON.stringify(topicData),
    );
    console.log(
      "[FCM] fetchTopicsFromServer: topics array =",
      Array.isArray(topicData?.topics)
        ? JSON.stringify(topicData.topics)
        : "not an array",
    );
    console.log(
      "[FCM] fetchTopicsFromServer: topics count =",
      topicData?.topics?.length || 0,
    );

    if (topicData?.token_updated === false) {
      console.log(
        "[FCM] fetchTopicsFromServer: server token not updated, syncing current FCM token",
      );

      const currentToken = await getClientFcmToken();

      if (currentToken) {
        const refreshedTopics = await syncTokenToBackend(currentToken);

        if (Array.isArray(refreshedTopics)) {
          console.log(
            "[FCM] fetchTopicsFromServer: token refreshed and topics synced via token update",
          );
          return refreshedTopics;
        }
      } else {
        console.log(
          "[FCM] fetchTopicsFromServer: no client FCM token available for refresh",
        );
      }
    }

    const messagingInstance = await getMessagingInstanceWithRetry();
    console.log(
      "[FCM] fetchTopicsFromServer: messagingInstance available =",
      !!messagingInstance,
    );

    if (!messagingInstance) {
      console.log(
        "[FCM] fetchTopicsFromServer: messaging instance unavailable, returning topics only",
      );
      return topicData?.topics || null;
    }

    if (Array.isArray(topicData?.topics)) {
      console.log(
        "[FCM] fetchTopicsFromServer: syncing",
        topicData.topics.length,
        "topics",
      );
      const syncStartTime = Date.now();

      await syncTopicsFromBackend(messagingInstance, topicData.topics);

      const syncDuration = Date.now() - syncStartTime;
      console.log(
        "[FCM] fetchTopicsFromServer: topic sync completed in",
        syncDuration,
        "ms",
      );
    } else {
      console.log(
        "[FCM] fetchTopicsFromServer: topicData.topics is not an array, skipping sync",
      );
    }

    const totalDuration = Date.now() - startTime;
    console.log(
      "[FCM] fetchTopicsFromServer: completed successfully in",
      totalDuration,
      "ms",
    );
    return topicData?.topics || null;
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.log(
      "[FCM] fetchTopicsFromServer: ERROR after",
      totalDuration,
      "ms",
    );
    console.log("[FCM] fetchTopicsFromServer: error message =", error?.message);
    console.log("[FCM] fetchTopicsFromServer: error code =", error?.code);
    console.log(
      "[FCM] fetchTopicsFromServer: error status =",
      error?.response?.status,
    );
    console.log(
      "[FCM] fetchTopicsFromServer: error response data =",
      JSON.stringify(error?.response?.data),
    );
    console.log(
      "[FCM] fetchTopicsFromServer: error config url =",
      error?.config?.url,
    );
    console.log("[FCM] fetchTopicsFromServer: error stack =", error?.stack);
    return null;
  }
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
