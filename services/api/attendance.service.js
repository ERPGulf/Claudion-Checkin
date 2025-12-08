// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";

// getOfficeLocation(employeeCode) — returns nearest location object or null

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

  const employee = data?.message;
  const locations = employee?.employee_locations || [];

  // Instead of throwing immediately, return null safely
  if (!locations.length) {
    console.log("⚠ No reporting locations from server");
    return null;
  }

  // Request location permission
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission denied");

  // Get current GPS coordinates
  const gps = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
  });

  const userLat = gps.coords.latitude;
  const userLng = gps.coords.longitude;
  console.log("📍 Current GPS:", userLat, userLng);

  // Find nearest location
  let nearest = null;

  locations.forEach((loc) => {
    try {
      const parsed = JSON.parse(loc.reporting_location);
      const coords = parsed?.features?.[0]?.geometry?.coordinates;

      if (coords?.length === 2) {
        const [lng, lat] = coords;

        const dist = getPreciseDistance(
          { latitude: userLat, longitude: userLng },
          { latitude: lat, longitude: lng }
        );

        if (!nearest || dist < nearest.distance) {
          nearest = {
            locationName: loc.location,
            latitude: lat,
            longitude: lng,
            distance: dist,
            radius: Number(loc.reporting_radius) || 0,
            withinRadius: dist <= Number(loc.reporting_radius),
          };
        }
      }
    } catch (err) {
      console.error("Location JSON parse error:", err);
    }
  });

  if (!nearest) {
    console.log("⚠ Failed to determine nearest location.");
    return null;
  }

  console.log("🏁 Nearest location:", nearest);
  return nearest;
};

// userCheckIn({ employeeCode, type }) — performs check-in/check-out
export const userCheckIn = async ({ employeeCode, type, locationData }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Token missing");

    const restrictLocation = (
      await AsyncStorage.getItem("restrict_location")
    )?.trim();
    let nearest = null;
    let radius = null;

    // 📍 Location restriction is enabled
    if (restrictLocation === "1") {
      nearest = await getOfficeLocation(employeeCode); // Returns closest office + distance

      if (!nearest) {
        return {
          allowed: false,
          message: "Reporting locations are not configured",
          distance: null,
          radius: null,
          location: null,
        };
      }

      if (!nearest.withinRadius) {
        return {
          allowed: false,
          message: `You are ${nearest.distance}m away from nearest location (${nearest.locationName}). Must be within ${nearest.radius}m.`,
          distance: nearest.distance,
          radius: nearest.radius,
          location: nearest,
        };
      }
    }

    // 🕒 Timestamp for check-in
    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");

    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
      location: nearest?.locationName || null,
      latitude: nearest?.latitude || null,
      longitude: nearest?.longitude || null,
      distance: nearest?.distance || null,
      radius: nearest?.radius || null,
    };

    // 📡 Send check-in / check-out request
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
        message: "Failed to register attendance",
        distance: nearest?.distance || null,
        radius: nearest?.radius || null,
        location: nearest || null,
      };
    }

    // 🎉 SUCCESS RESPONSE
    return {
      allowed: true,
      name: checkinId,
      message: `Successfully ${type === "IN" ? "checked in" : "checked out"}`,
      distance: nearest?.distance ?? null,
      radius: nearest?.radius ?? null,
      location: nearest ?? null, // Full location object for Redux
    };
  } catch (error) {
    console.error("❌ Check-in failed:", error);

    return {
      allowed: false,
      message: error.message || "Something went wrong during check-in",
      distance: null,
      radius: null,
      location: null,
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
