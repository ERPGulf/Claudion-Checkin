// src/services/api/authHelper.js

import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "./utils";

let cachedAuth = null;

/**
 * Common Auth Context
 */
export const getAuthContext = async () => {
  // return cached version if available
  if (cachedAuth) {
    return cachedAuth;
  }

  const [rawBaseUrl, token, employeeCode] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("employee_code"),
  ]);

  if (!rawBaseUrl || !token) {
    throw new Error("Session expired");
  }

  cachedAuth = {
    baseUrl: cleanBaseUrl(rawBaseUrl),
    token,
    employeeCode,
  };

  return cachedAuth;
};

/**
 * Clear cache (call on logout)
 */
export const clearAuthCache = () => {
  cachedAuth = null;
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