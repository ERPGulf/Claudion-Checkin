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

    // ✅ x-www-form-urlencoded (exactly like Postman)
    const params = new URLSearchParams();
    params.append("employee", employeeCode);
    params.append("posting_date", leaveData.posting_date);
    params.append("leave_type", leaveData.leave_type);
    params.append("from_date", leaveData.from_date);
    params.append("to_date", leaveData.to_date);
    params.append("reason", leaveData.reason);

    // ✅ REQUIRED for Remote leave
    if (leaveData.leave_type === "Remote") {
      params.append("acknowledgement_policy", "1");
    }

    const response = await apiClient.post(url, params.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return { message: response.data?.message };
  } catch (error) {
    let msg = "Server error. Please try again later.";

    if (error.response?.data) {
      const data = error.response.data;
      try {
        if (data._server_messages) {
          const parsed = JSON.parse(data._server_messages);
          if (parsed?.[0]?.message) msg = parsed[0].message;
        } else if (typeof data.message === "string") {
          msg = data.message;
        }
      } catch (_) {}
    } else if (error.message === "Network Error") {
      msg = "Unable to reach server. Please check your internet connection.";
    }

    console.log(
      "❌ Leave submit error:",
      error?.response?.data || error.message
    );
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
