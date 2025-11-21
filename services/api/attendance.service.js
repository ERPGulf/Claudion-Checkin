// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

/**
 * getOfficeLocation(employeeCode) — fetches employee and parses reporting location
 * keeps same name/signature as original.
 */
export const getOfficeLocation = async (employeeCode) => {
  if (!employeeCode) throw new Error("Employee ID is required");

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

  const employee = data.message;

  if (!employee?.custom_reporting_location) {
    console.warn("⚠️ No reporting location found");
    return { latitude: null, longitude: null, radius: 0 };
  }

  let locationJson;
  try {
    locationJson = JSON.parse(employee.custom_reporting_location);
  } catch (err) {
    console.error("❌ Invalid location JSON format:", err);
    return { latitude: null, longitude: null, radius: 0 };
  }

  const coords = locationJson?.features?.[0]?.geometry?.coordinates || [
    null,
    null,
  ];

  if (
    !Array.isArray(coords) ||
    coords.length !== 2 ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    console.warn("⚠️ Coordinates are missing or invalid");
    return { latitude: null, longitude: null, radius: 0 };
  }

  const longitude = coords[0];
  const latitude = coords[1];
  const radius = Number(employee.custom_reporting_radius) || 0;

  console.log("✅ Parsed coordinates:", { latitude, longitude, radius });
  return { latitude, longitude, radius };
};
//check in function
export const userCheckIn = async ({ employeeCode, type }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Token missing");

    // ✅ Use correct key & trim value
    const restrictLocation = (
      await AsyncStorage.getItem("restrict_location")
    )?.trim();

    let distance = null;
    let radius = null;

    // ----------------------------------------------------------------
    // 1️⃣ Location restriction enabled → perform GPS + distance check
    // ----------------------------------------------------------------
    if (restrictLocation === "1") {
      const office = await getOfficeLocation(employeeCode);
      const { latitude, longitude, radius: officeRadius } = office;

      radius = Number(officeRadius); // ✅ FIX

      if (!latitude || !longitude || !radius) {
        return {
          allowed: false,
          distance: null,
          radius: 0,
          message: "Reporting location not configured for this employee",
        };
      }

      // Permission request
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return {
          allowed: false,
          distance: null,
          radius,
          message: "Location permission denied",
        };
      }

      // Get live GPS
      const userLoc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const userLat = userLoc.coords.latitude;
      const userLng = userLoc.coords.longitude;

      // Compare distance
      distance = getPreciseDistance(
        { latitude: userLat, longitude: userLng },
        { latitude, longitude }
      );

      console.log("📍 Distance:", distance, "Allowed Radius:", radius);

      if (distance > radius) {
        return {
          allowed: false,
          distance,
          radius,
          message: `You must be within ${radius} meters to ${
            type === "IN" ? "check in" : "check out"
          }.`,
        };
      }
    }

    // ----------------------------------------------------------------
    // 2️⃣ Perform check-in or check-out API call
    // ----------------------------------------------------------------
    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
    };

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const checkinId = response.data?.message?.name;

    if (!checkinId) {
      return {
        allowed: false,
        distance,
        radius,
        message: "Failed to register attendance",
      };
    }

    return {
      allowed: true,
      name: checkinId,
      distance,
      radius,
    };
  } catch (error) {
    console.error("❌ Check-in failed:", error);

    return {
      allowed: false,
      distance: null,
      radius: null,
      message: error.message || "Something went wrong during check-in",
    };
  }
};

/**
 * getUserAttendance(employee_id, limit_start, limit_page_length)
 */
export const getUserAttendance = async (
  employee_id,
  limit_start = 0,
  limit_page_length = 20
) => {
  try {
    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const token = await AsyncStorage.getItem("access_token");

    if (!rawBaseUrl || !token) {
      return {
        error: !rawBaseUrl
          ? "Base URL not found. Please scan QR code first."
          : "Access token missing. Please log in again.",
      };
    }

    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_attendance_details`;

    const response = await apiClient.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      params: {
        employee_id,
        limit_start,
        limit_page_length,
      },
      timeout: 10000,
    });

    // Return the attendance list
    return response.data?.message || [];
  } catch (error) {
    console.error(
      "Attendance fetch error:",
      error.response?.data || error.message
    );
    return {
      error:
        error.response?.data?.message ||
        "Something went wrong while fetching attendance history.",
    };
  }
};

/**
 * getAttendanceStatus() — returns { custom_in: 0 | 1 }
 */
export const getAttendanceStatus = async () => {
  try {
    const employee_id = await AsyncStorage.getItem("employee_id");

    if (!employee_id) {
      return { custom_in: 0 }; // default
    }

    // Get latest 1 record
    const list = await getUserAttendance(employee_id, 0, 1);

    if (!Array.isArray(list) || list.length === 0) {
      return { custom_in: 0 }; // never checked in before
    }

    // Latest record
    const latest = list[0];

    return {
      custom_in: latest?.custom_in === 1 ? 1 : 0,
    };
  } catch (e) {
    console.log("Status fetch error:", e);
    return { custom_in: 0 };
  }
};
// Get daily worked hours
export const getDailyWorkedHours = async (employeeCode, date) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");

  try {
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_total_hours`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { employee: employeeCode, date },
      }
    );

    const hours = response.data?.message?.trim();

    // If API returns something valid, show it. If it's empty/null → show "00:00"
    return hours ? hours : "00:00";
  } catch (err) {
    console.error("Daily hours fetch error:", err);
    return "00:00";
  }
};
// Get monthly worked hours
export const getMonthlyWorkedHours = async (employeeCode, month, year) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");

  try {
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_monthly_hours`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { employee: employeeCode, month, year },
      }
    );

    const hours = response.data?.message?.trim();

    return hours ? hours : "00:00";
  } catch (err) {
    console.error("Monthly hours fetch error:", err);
    return "00:00";
  }
};

export default {
  getOfficeLocation,
  userCheckIn,
  getUserAttendance,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
};
