// src/services/api/employee.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { assertAttendanceQueueScope, captureAttendanceQueueScope, createAttendanceScopeChangedError } from "../offline/attendanceQueueProvenance";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../employeeAutoAttendancePolicy";

/**
 * fetchEmployeeData(employeeCode)
 * returns data.message from API
 */
export const fetchEmployeeData = async (employeeCode, { syncScope } = {}) => {
  try {
    syncScope = syncScope ?? await captureAttendanceQueueScope(employeeCode);
    const current = await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
    const reception = beginEmployeeAutoAttendancePolicyReception(syncScope);
    const rawBaseUrl = current?.tenantKey ?? await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = current?.accessToken ?? await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

    const { data } = await apiClient.get(url, {
      ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
      params: { employee_id: employeeCode },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });
    if (__DEV__) console.log("[employee] get_employee_data response", {
      received: !!data?.message,
      locationsCount: Array.isArray(data?.message?.employee_locations)
        ? data.message.employee_locations.length : 0,
    });
    await receiveEmployeeAutoAttendancePolicy(data.message, reception);

    return data.message;
  } catch (error) {
    throw error;
  }
};

/**
 * getUserCustomIn(employeeCode) — wrapper for fetchEmployeeData
 */
export const getUserCustomIn = async (employeeCode) => {
  if (!employeeCode) throw new Error("Employee ID is required");
  return fetchEmployeeData(employeeCode);
};

export default {
  fetchEmployeeData,
  getUserCustomIn,
};
