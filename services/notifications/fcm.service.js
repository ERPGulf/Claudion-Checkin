import { PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging from "@react-native-firebase/messaging";
import Constants from "expo-constants";
import { plainAxios } from "../api/apiClient";
import { cleanBaseUrl, setCommonHeaders } from "../api/utils";
import { getNotifications } from "../api/notification.service";
import { setUnreadCount } from "../../redux/Slices/notificationSlice";
import { navigateSafely } from "../../navigation/rootNavigation";

const FCM_TOKEN_KEY = "fcm_token";
const FCM_LAST_MESSAGE_AT_KEY = "fcm_last_message_at";
const DEFAULT_NOTIFICATION_ROUTE = "Notifications";

let backgroundHandlerRegistered = false;

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

  if (!baseUrl || !authToken) {
    return;
  }

  const registrationUrl = buildFcmRegistrationUrl(registrationMethod, baseUrl);

  if (!registrationUrl) {
    return;
  }

  const body = new URLSearchParams();
  body.append("fcm_token", token);
  body.append("platform", Platform.OS);

  if (employeeId) {
    body.append("employee", employeeId);
  }

  try {
    await plainAxios.post(registrationUrl, body.toString(), {
      headers: {
        ...setCommonHeaders(),
        Authorization: `Bearer ${authToken}`,
      },
      timeout: 10000,
    });
  } catch {
    // Keep FCM bootstrap resilient even when registration API is unavailable.
  }
};

const persistFcmToken = async (token) => {
  if (!token) {
    return;
  }

  const previousToken = await AsyncStorage.getItem(FCM_TOKEN_KEY);

  if (previousToken === token) {
    return;
  }

  await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
  await syncTokenToBackend(token);
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

  try {
    await messaging().registerDeviceForRemoteMessages();
    const authStatus = await messaging().requestPermission();

    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
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

  messaging().setBackgroundMessageHandler(async () => {
    await AsyncStorage.setItem(FCM_LAST_MESSAGE_AT_KEY, String(Date.now()));
  });

  backgroundHandlerRegistered = true;
};

export const initializeFcm = async ({
  dispatch,
  onForegroundNotification,
} = {}) => {
  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    return () => {};
  }

  try {
    const token = await messaging().getToken();
    await persistFcmToken(token);
  } catch {
    // Do not block app startup if token retrieval fails.
  }

  await syncUnreadCountFromServer(dispatch);

  const unsubscribeTokenRefresh = messaging().onTokenRefresh(async (token) => {
    await persistFcmToken(token);
  });

  const unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
    await AsyncStorage.setItem(FCM_LAST_MESSAGE_AT_KEY, String(Date.now()));
    await syncUnreadCountFromServer(dispatch);

    if (typeof onForegroundNotification === "function") {
      onForegroundNotification({
        remoteMessage,
        title: getMessageTitle(remoteMessage),
        body: getMessageBody(remoteMessage),
      });
    }
  });

  const unsubscribeNotificationOpen = messaging().onNotificationOpenedApp(
    async (remoteMessage) => {
      await handleNotificationOpen(remoteMessage, dispatch);
    },
  );

  try {
    const initialMessage = await messaging().getInitialNotification();

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

  const hasPermission = await requestFcmPermission();

  if (!hasPermission) {
    return null;
  }

  try {
    const token = await messaging().getToken();

    if (!token) {
      return null;
    }

    await persistFcmToken(token);
    return token;
  } catch {
    return null;
  }
};

export const clearFcmRegistration = async () => {
  try {
    await messaging().deleteToken();
  } catch {
    // Token deletion can fail if Firebase is not fully initialized.
  }

  await AsyncStorage.multiRemove([FCM_TOKEN_KEY, FCM_LAST_MESSAGE_AT_KEY]);
};
