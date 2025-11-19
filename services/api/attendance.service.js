// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient, { refreshAccessToken } from "./apiClient"; // apiClient handles interceptors
import { cleanBaseUrl, setCommonHeaders } from "./utils";

/**
 * Parse reporting location from employee.custom_reporting_location field.
 * Returns { latitude, longitude, radius } or { latitude: null, longitude: null, radius: 0 }
 */
export const getOfficeLocation = (employee) => {
  if (!employee?.custom_reporting_location) {
    return { latitude: null, longitude: null, radius: 0 };
  }

  try {
    const locationJson = JSON.parse(employee.custom_reporting_location);
    const coords = locationJson?.features?.[0]?.geometry?.coordinates || [null, null];

    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number"
    ) {
      return { latitude: null, longitude: null, radius: 0 };
    }

    const longitude = coords[0];
    const latitude = coords[1];
    const radius = Number(employee.custom_reporting_radius) || 0;

    return { latitude, longitude, radius };
  } catch (err) {
    console.warn("Invalid location JSON:", err);
    return { latitude: null, longitude: null, radius: 0 };
  }
};

/**
 * Fetch employee object (raw) using attendance API get_employee_data
 */
export const fetchEmployeeRaw = async (employeeCode) => {
  if (!employeeCode) throw new Error("Employee code required");
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const token = await AsyncStorage.getItem("access_token");
  if (!rawBaseUrl) throw new Error("Base URL missing");
  if (!token) throw new Error("Access token missing");

  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;

  const { data } = await apiClient.get(url, {
    params: { employee_id: employeeCode },
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
  });

  return data?.message;
};

/**
 * Check-in / Check-out flow:
 * - Reads configured reporting location for employee
 * - Requests location permission and gets device location
 * - Calculates distance and validates radius
 * - Calls add_log_based_on_employee_field API to register
 *
 * Returns structured result:
 * { allowed: boolean, distance: number|null, radius: number|null, message: string, name?: string }
 */
export const userCheckIn = async ({ employeeCode, type }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    if (!rawBaseUrl) throw new Error("Base URL missing");
    const baseUrl = cleanBaseUrl(rawBaseUrl);

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Token missing");

    // 1) Get employee and reporting location
    const employee = await fetchEmployeeRaw(employeeCode);
    const { latitude, longitude, radius } = getOfficeLocation(employee);

    if (!latitude || !longitude || !radius) {
      return {
        allowed: false,
        distance: null,
        radius: radius || 0,
        message: "Reporting location not configured for this employee",
      };
    }

    // 2) Request device permission and location
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return {
        allowed: false,
        distance: null,
        radius,
        message: "Location permission denied",
      };
    }

    const userLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });

    const userLat = userLocation.coords.latitude;
    const userLng = userLocation.coords.longitude;

    // 3) Distance (meters)
    const distance = getPreciseDistance(
      { latitude: userLat, longitude: userLng },
      { latitude, longitude }
    );

    // 4) If outside radius -> return not allowed
    if (distance > radius) {
      return {
        allowed: false,
        distance,
        radius,
        message: `You must be within ${radius} meters to ${type === "IN" ? "check in" : "check out"}.`,
      };
    }

    // 5) Inside radius -> call API to register check-in
    const formattedTime = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type, // IN or OUT
      timestamp: formattedTime,
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
        message: "Failed to register check-in",
      };
    }

    return { allowed: true, name: checkinId, distance, radius };
  } catch (error) {
    console.error("Check-in failed:", error);
    return {
      allowed: false,
      distance: null,
      radius: null,
      message: error.message || "Something went wrong during check-in",
    };
  }
};

/**
 * Get attendance history for an employee (paginated)
 * Returns array or { error: string }
 */
export const getUserAttendance = async (employee_id, limit_start = 0, limit_page_length = 20) => {
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

    return response.data?.message || [];
  } catch (error) {
    console.error("Attendance fetch error:", error.response?.data || error.message);
    return {
      error:
        error.response?.data?.message ||
        "Something went wrong while fetching attendance history.",
    };
  }
};

/**
 * Returns { custom_in: 0 | 1 }
 */
export const getAttendanceStatus = async () => {
  try {
    const employee_id = await AsyncStorage.getItem("employee_id");
    if (!employee_id) return { custom_in: 0 };

    const list = await getUserAttendance(employee_id, 0, 1);

    if (!Array.isArray(list) || list.length === 0) return { custom_in: 0 };

    const latest = list[0];
    return { custom_in: latest?.custom_in === 1 ? 1 : 0 };
  } catch (e) {
    console.warn("Status fetch error:", e);
    return { custom_in: 0 };
  }
};
