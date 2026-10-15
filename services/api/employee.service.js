// src/services/api/employee.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { assertAttendanceQueueScope, createAttendanceScopeChangedError } from "../offline/attendanceQueueProvenance";

/**
 * fetchEmployeeData(employeeCode)
 * returns data.message from API
 */
export const fetchEmployeeData = async (employeeCode, { syncScope } = {}) => {
  try {
    const current = syncScope ? await assertAttendanceQueueScope(syncScope) : null;
    if (syncScope && syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
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
    if (syncScope) await assertAttendanceQueueScope(syncScope);

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
