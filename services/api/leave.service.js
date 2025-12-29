// src/services/api/leave.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * createLeaveApplication(leaveData)
 */
export const createLeaveApplication = async (leaveData) => {
  try {
    const [rawBaseUrl, token, employeeCode] = await Promise.all([
      AsyncStorage.getItem("baseUrl"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("employee_code"),
    ]);

    if (!rawBaseUrl || !token || !employeeCode) {
      return { error: "Session expired. Please login again." };
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const url = `${baseUrl}/api/method/employee_app.attendance_api.create_leave_application`;

    const formData = new FormData();
    formData.append("employee", employeeCode);
    formData.append("posting_date", leaveData.posting_date);
    formData.append("leave_type", leaveData.leave_type);
    formData.append("from_date", leaveData.from_date);
    formData.append("to_date", leaveData.to_date);
    formData.append("reason", leaveData.reason || "N/A");

    if (leaveData.leave_type === "Remote" && leaveData.agreement) {
      formData.append("agreement", leaveData.agreement);
    }

    const response = await apiClient.post(url, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return { message: response.data?.message };
  } catch (error) {
    let msg = "Leave submission failed.";

    const data = error?.response?.data;

    try {
      const serverMsg = data?._server_messages;

      if (typeof serverMsg === "string") {
        const parsed = JSON.parse(serverMsg);
        if (parsed?.[0]?.message) msg = parsed[0].message;
      } else if (Array.isArray(serverMsg)) {
        if (serverMsg[0]?.message) msg = serverMsg[0].message;
      } else if (data?.message) {
        msg = data.message;
      }
    } catch (_) {
      console.log("⚠️ Message parse error:", data);
    }

    console.log("❌ Leave submit crash:", msg);
    return { error: msg };
  }
};

// getLeaveTypes()

export const getLeaveTypes = async () => {
  try {
    const [rawBaseUrl, token, employeeCode] = await Promise.all([
      AsyncStorage.getItem("baseUrl"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("employee_code"),
    ]);

    if (!rawBaseUrl || !token || !employeeCode) {
      return { error: "Missing credentials." };
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_leave_type`;

    const response = await apiClient.get(url, {
      params: { employee: employeeCode },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!Array.isArray(response.data?.message)) {
      console.log("❌ Invalid leave type response:", response.data);
      return { error: "Invalid leave type response" };
    }

    return { message: response.data.message };
  } catch (error) {
    console.log("🔥 Leave type error:", error?.response?.data || error.message);
    return { error: "Unable to load leave types." };
  }
};

export default {
  createLeaveApplication,
  getLeaveTypes,
};
