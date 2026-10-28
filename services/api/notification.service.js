// src/services/api/notification.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { getAuthSessionGeneration, isAuthSessionSuspended } from "../../utils/authSessionGuard";

const assertCurrentSession = (generation) => {
  if (generation !== getAuthSessionGeneration() || isAuthSessionSuspended()) {
    const error = new Error("Notification session changed.");
    error.code = "NOTIFICATION_SESSION_CHANGED";
    throw error;
  }
};

/**
 * getNotifications(employeeId)
 * → returns notification list from server
 */
export const getNotifications = async (employeeId, { throwOnError = false } = {}) => {
  const generation = getAuthSessionGeneration();
  try {
    if (!employeeId) {
      throw new Error("Employee ID is required");
    }

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      throw new Error("Base URL or token missing");
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);
    assertCurrentSession(generation);

    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_notification`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          employee: employeeId,
        },
        timeout: 10000,
      },
    );

    assertCurrentSession(generation);
    if (throwOnError && !Array.isArray(response.data?.message)) {
      throw new Error("Invalid notification response.");
    }

    // Default callers retain the established [] failure contract; the inbox
    // opts into errors so a successful empty list can clear deleted records.
    const notifications = Array.isArray(response.data?.message)
      ? response.data.message.map((item) => ({
          ...item,
          read: Number(item.read), // ensure number
          type: item.type?.toLowerCase() || "", // normalize type
        }))
      : [];

    return notifications;
  } catch (error) {
    if (throwOnError) throw error;
    return [];
  }
};

/**
 * hasUnreadNotifications(employeeId)
 * → returns true / false
 */
export const hasUnreadNotifications = async (employeeId) => {
  const notifications = await getNotifications(employeeId);

  return notifications.some((item) => Number(item.read) === 0);
};

/**
 * markNotificationAsRead(notificationId)
 * → marks ONE notification as read
 */
export const markNotificationAsRead = async (notificationId) => {
  const generation = getAuthSessionGeneration();
  try {
    if (!notificationId) {
      throw new Error("Notification ID is required");
    }

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      throw new Error("Base URL or token missing");
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);
    assertCurrentSession(generation);

    // 🔴 Send as x-www-form-urlencoded (same as Postman)
    const body = new URLSearchParams();
    body.append("id", notificationId);

    const response = await apiClient.put(
      `${baseUrl}/api/method/employee_app.attendance_api.mark_notification_as_read`,
      body.toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      },
    );

    assertCurrentSession(generation);
    return response.data?.message?.status === "success";
  } catch (error) {
    throw error;
  }
};

export default {
  getNotifications,
  hasUnreadNotifications,
  markNotificationAsRead,
};
