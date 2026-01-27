// src/services/api/notification.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * getNotifications(employeeId)
 * → returns notification list from server
 */
export const getNotifications = async (employeeId) => {
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

    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_notification`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          employee: employeeId, // ✅ matches Postman
        },
        timeout: 10000,
      },
    );

    // ✅ Postman response: { message: [...] }
    return Array.isArray(response.data?.message) ? response.data.message : [];
  } catch (error) {
    console.error(
      "❌ Notification fetch error:",
      error.response?.data || error.message,
    );
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

    return response.data?.message?.status === "success";
  } catch (error) {
    console.error(
      "❌ Mark notification as read error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export default {
  getNotifications,
  hasUnreadNotifications,
  markNotificationAsRead,
};
