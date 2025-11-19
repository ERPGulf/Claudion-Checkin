// src/services/api/employee.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * fetchEmployeeData(employeeCode)
 * returns data.message from API
 */
export const fetchEmployeeData = async (employeeCode) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

    const { data } = await apiClient.get(url, {
      params: { employee_id: employeeCode },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });

    console.log("✅ Employee data response:", data);
    return data.message;
  } catch (error) {
    console.error(
      "❌ Get employee data error:",
      error.response?.data || error.message
    );
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
