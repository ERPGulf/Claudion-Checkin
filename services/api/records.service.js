// NOSONAR
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
//shortcut1
export const getShortcut1 = async (employeeCode) => {
  try {
    if (!employeeCode) throw new Error("Employee ID missing");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_shortcut_1`;

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        employee: employeeCode,
      },
      timeout: 10000,
    });

    const message = response?.data?.message;
    if (!message) throw new Error("No message found in response");

    return {
      shortcut: message.shortcut, // ✅ title
      data: message.data || {}, // ✅ FIXED
    };
  } catch (error) {
    console.error(
      "❌ Get residency shortcut error:",
      error?.response?.data || error?.message || error
    );
    throw error;
  }
};
//shortcut2
export const getShortcut2 = async (employeeCode) => {
  try {
    if (!employeeCode) throw new Error("Employee ID missing");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_shortcut_2`;

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        employee: employeeCode,
      },
      timeout: 10000,
    });

    const message = response?.data?.message;
    if (!message) throw new Error("No message found in response");

    return {
      shortcut: message.shortcut, // ✅ title
      data: message.fields || {}, // ✅ FIXED
    };
  } catch (error) {
    console.error(
      "❌ Get residency shortcut error:",
      error?.response?.data || error?.message || error
    );
    throw error;
  }
};

export const getShortcut3 = async (employeeCode) => {
  try {
    if (!employeeCode) throw new Error("Employee ID missing");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Access token missing");

    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_shortcut_3`;

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        employee: employeeCode,
      },
      timeout: 10000,
    });

    const message = response?.data?.message;
    if (!message) throw new Error("No message found");

    return {
      shortcut: message.shortcut, // ✅ button name
      data: message.data || {}, // ✅ all the fields to show in screen
    };

    // returns exactly what backend sends
  } catch (error) {
    console.error(
      "❌ Get dynamic shortcut data error:",
      error?.response?.data || error?.message || error
    );
    throw error;
  }
};

//QR Code details

export const getQrCode = async (employeeCode) => {
  try {
    if (!employeeCode) {
      throw new Error("Employee code missing");
    }

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);

    if (!baseUrl) {
      throw new Error("Base URL missing");
    }

    const token = await AsyncStorage.getItem("access_token");
    if (!token) {
      throw new Error("Access token missing");
    }

    const url = `${baseUrl}/api/method/employee_app.attendance_api.qr_code`;

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        employee: employeeCode, // ✅ REQUIRED PARAM
      },
      timeout: 10000,
    });

    const message = response?.data?.message;

    if (!message || message.status !== "success") {
      throw new Error("Failed to fetch QR code");
    }

    return {
      employee: message.employee,
      imageUrl: message.image_url,
    };
  } catch (error) {
    console.error(
      "❌ Get QR Code error:",
      error?.response?.data || error.message
    );
    throw error;
  }
};

export default {
  getShortcut1,
  getShortcut2,
  getShortcut3,
  getQrCode,
};
