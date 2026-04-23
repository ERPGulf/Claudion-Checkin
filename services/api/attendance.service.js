// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import { get } from "react-native/Libraries/TurboModule/TurboModuleRegistry";

export const getServerTime = async () => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");

  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_server_time`;

  const response = await apiClient.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // Extract correct field from API response
  return response.data?.message?.server_time;
};

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
          { latitude: lat, longitude: lng },
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
    } catch (err) {}
  });

  if (!nearest) {
    return null;
  }

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
    if (restrictLocation && restrictLocation.toString() === "1") {
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
    const timestamp = await getServerTime();

    // Build base payload
    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
    };

    // 👉 Only attach location fields when restriction is enabled
    if (restrictLocation === "1" && nearest) {
      payload.location = nearest.locationName;
      payload.latitude = nearest.latitude;
      payload.longitude = nearest.longitude;
      payload.distance = nearest.distance;
      payload.radius = nearest.radius;
    }

    // 📡 Send check-in / check-out request
    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
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
  limit_page_length = 20,
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
// export const getAttendanceStatus = async () => {
//   try {
//     const employee_id = await AsyncStorage.getItem("employee_id");
//     if (!employee_id) {
//       return { custom_in: 0 }; // default
//     }
//     // Get latest 1 record
//     const list = await getUserAttendance(employee_id, 0, 1);
//     if (!Array.isArray(list) || list.length === 0) {
//       return { custom_in: 0 }; // never checked in before
//     }
//     // Latest record
//     const latest = list[0];
//     return {
//       custom_in: latest?.custom_in === 1 ? 1 : 0,
//     };
//   } catch (e) {
//     return { custom_in: 0 };
//   }
// };

export const getAttendanceStatus = async () => {
  try {
    const employee_id = await AsyncStorage.getItem("employee_id");
    if (!employee_id) return { custom_in: 0 };

    const list = await getUserAttendance(employee_id, 0, 10);

    console.log("ATTENDANCE LIST:", list);

    if (!Array.isArray(list) || list.length === 0) {
      return { custom_in: 0 };
    }

    const latest = list.reduce((a, b) => {
      const dateA = new Date(a.creation || a.timestamp || a.time || 0);
      const dateB = new Date(b.creation || b.timestamp || b.time || 0);
      return dateA > dateB ? a : b;
    });

    console.log("LATEST RECORD:", latest);

    return {
      custom_in: latest?.custom_in === 1 || latest?.log_type === "IN" ? 1 : 0,
    };
  } catch (e) {
    console.log("STATUS ERROR:", e);
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
      },
    );
    const hours = response.data?.message?.trim();
    return hours ? hours : "00:00";
  } catch (err) {
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
      },
    );
    const hours = response.data?.message?.trim();
    return hours ? hours : "00:00";
  } catch (err) {
    return "00:00";
  }
};

export const getTodayBreaks = async (employeeCode, date) => {
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");

  try {
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_today_breaks`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          employee: employeeCode,
          date,
        },
      },
    );

    const data = response.data?.message;

    // Return full object (important for flexibility)
    return data || { total_break_minutes: 0, breaks: [] };
  } catch (err) {
    return { total_break_minutes: 0, breaks: [] };
  }
};

export const employeeBreak = async ({ employeeCode, type }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (!token) throw new Error("Token missing");

    const timestamp = await getServerTime();

    const formData = new URLSearchParams();
    formData.append("employee_field_value", employeeCode);
    formData.append("timestamp", timestamp);
    formData.append("device_id", "09267");
    formData.append("log_type", type);

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.Employee_break`,
      formData.toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const breakId = response.data?.message?.name;

    if (!breakId) {
      return {
        allowed: false,
        message: "Failed to register break",
      };
    }

    return {
      allowed: true,
      name: breakId,
      message: type === "IN" ? "Break started" : "Break ended",
    };
  } catch (error) {
    console.log("Break error:", error?.response?.data || error.message);

    return {
      allowed: false,
      message:
        error?.response?.data?.message || error.message || "Break failed",
    };
  }
};

export const createAttendanceRequest = async ({
  employee,
  from_date,
  to_date,
  reason,
  from_time,
  to_time,
}) => {
  try {
    if (!employee) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");

    if (!baseUrl) throw new Error("Base URL missing");
    if (!token) throw new Error("Token missing");

    const url = `${baseUrl}/api/method/employee_app.gauth.create_attendence_request`;

    const formData = new URLSearchParams();

    formData.append("employee", employee);
    formData.append("from_date", from_date);
    formData.append("to_date", to_date);
    formData.append("reason", reason || "");
    formData.append("from_time", from_time || "");
    formData.append("to_time", to_time || "");

    const response = await apiClient.post(url, formData.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const res = response.data?.message;
    const docname = res?.name || res;

    if (!docname) {
      return {
        success: false,
        message: "Failed to create attendance request",
      };
    }

    return {
      success: true,
      docname,
      data: res,
      message: "Attendance request created successfully",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error?.response?.data?.message ||
        error.message ||
        "Attendance request failed",
    };
  }
};

export const uploadAttendanceAttachment = async (file, docname) => {
  try {
    if (!file?.uri) throw new Error("Invalid file");
    if (!docname) throw new Error("Missing docname");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");

    const formData = new FormData();

    const getSafeFileName = (name) => {
      if (!name) return "file.jpg";

      const ext = name.split(".").pop();

      const base = name
        .replace(/\.[^/.]+$/, "")
        .slice(0, 20)
        .replace(/[^a-zA-Z0-9]/g, "");

      return `${base}_${Date.now()}.${ext}`;
    };

    const safeName = getSafeFileName(file.name);

    formData.append("file", {
      uri: file.uri,
      name: safeName,
      type: file.type || "image/jpeg",
    });

    formData.append("file_name", "FILE1"); // as per API
    formData.append("doctype", "Attendance Request");
    formData.append("docname", String(docname));

    const response = await fetch(
      `${baseUrl}/api/method/employee_app.attendance_api.upload_file`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      },
    );

    const result = await response.json();

    console.log("📤 ATTENDANCE FILE RESPONSE:", result);

    if (!response.ok || result?.exc || result?._server_messages) {
      return {
        error: result?.message || "Upload failed",
      };
    }

    return { success: true, data: result };
  } catch (error) {
    console.log("❌ FILE UPLOAD ERROR:", error);

    return {
      error: error.message || "Upload failed",
    };
  }
};
export default {
  getServerTime,
  getOfficeLocation,
  userCheckIn,
  getUserAttendance,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  employeeBreak,
  getTodayBreaks,
  createAttendanceRequest,
  uploadAttendanceAttachment,
};
