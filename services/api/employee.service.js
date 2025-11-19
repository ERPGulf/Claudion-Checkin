// src/services/api/employee.service.js
import apiClient from "./apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

export const fetchEmployeeData = async (employeeCode) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const token = await AsyncStorage.getItem("access_token");

  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

  const { data } = await apiClient.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { employee_id: employeeCode }
  });

  return data.message;
};

export const getUserCustomIn = fetchEmployeeData;
