// src/services/api/authHelper.js

import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

/**
 * Common Auth Context
 */
export const getAuthContext = async () => {
  const [rawBaseUrl, token, employeeCode] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_code"),
  ]);

  if (!rawBaseUrl || !token) {
    throw new Error("Session expired");
  }

  return {
    baseUrl: cleanBaseUrl(rawBaseUrl),
    token,
    employeeCode,
  };
};

/**
 * Common Header Builder
 */
export const buildHeaders = (
  token,
  contentType = "application/json"
) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": contentType,
});
