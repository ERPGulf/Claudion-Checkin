// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPreciseDistance } from "geolib";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import {
  normalizeCustomIn,
  toTimestampMs,
} from "../../utils/attendanceSession";

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
  const logPrefix = "[attendance.service/getOfficeLocation]";

  if (!employeeCode) throw new Error("Employee ID is required");

  console.log(`${logPrefix} Start`, { employeeCode });

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

  console.log(
    `${logPrefix} RAW EMPLOYEE RESPONSE`,
    JSON.stringify(data, null, 2),
  );

  const employee = data?.message || {};

  const sanitizeNumber = (value, defaultValue = 0) => {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : defaultValue;
  };

  const sanitizeArray = (value) => {
    return Array.isArray(value) ? value : [];
  };

  const restrictLocation = sanitizeNumber(employee?.restrict_location);

  const unrestrictedCheckoutLocation = sanitizeNumber(
    employee?.unrestricted_checkout_location,
  );

  const photo = sanitizeNumber(employee?.photo);

  const locations = sanitizeArray(employee?.employee_locations);

  console.log(`${logPrefix} Employee API response`, employee);

  console.log(`${logPrefix} Restriction settings`, {
    restrict_location: restrictLocation,
    unrestricted_checkout_location: unrestrictedCheckoutLocation,
    photo,
    locationsCount: locations.length,
  });

  await AsyncStorage.multiSet([
    ["restrict_location", String(restrictLocation)],

    ["unrestricted_checkout_location", String(unrestrictedCheckoutLocation)],

    ["photo", String(photo)],

    ["employee_locations", JSON.stringify(locations)],
  ]);

  console.log(`${logPrefix} Employee locations`, locations);
  console.log(`${logPrefix} Locations fetched`, {
    totalLocations: locations.length,
  });

  // Instead of throwing immediately, return null safely
  if (!locations.length) {
    console.warn(`${logPrefix} No reporting locations configured`, {
      employeeCode,
    });
    return null;
  }

  // Request location permission
  const { status } = await Location.requestForegroundPermissionsAsync();
  console.log(`${logPrefix} Foreground permission`, { status });
  if (status !== "granted") throw new Error("Location permission denied");

  // Get current GPS coordinates
  const gps = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
  });

  const userLat = gps.coords.latitude;
  const userLng = gps.coords.longitude;

  console.log(`${logPrefix} Current GPS`, {
    latitude: userLat,
    longitude: userLng,
  });

  const parseCoordinateValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const resolveCoordinates = (loc) => {
    try {
      const parsed = JSON.parse(loc?.reporting_location || "{}");
      const coords = parsed?.features?.[0]?.geometry?.coordinates;

      if (Array.isArray(coords) && coords.length === 2) {
        const [lng, lat] = coords;
        const longitude = parseCoordinateValue(lng);
        const latitude = parseCoordinateValue(lat);

        if (latitude !== null && longitude !== null) {
          return { latitude, longitude, source: "reporting_location" };
        }
      }
    } catch (err) {
      console.warn(`${logPrefix} Failed to parse reporting_location JSON`, {
        locationName: loc?.location,
        error: err?.message,
      });
    }

    const latitude = parseCoordinateValue(loc?.latitude);
    const longitude = parseCoordinateValue(loc?.longitude);

    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, source: "lat_lng_fields" };
    }

    return null;
  };

  const candidates = locations
    .map((loc, index) => {
      const resolvedCoords = resolveCoordinates(loc);

      if (!resolvedCoords) {
        console.warn(`${logPrefix} Invalid coordinates for location`, {
          index,
          locationName: loc?.location,
        });
        return null;
      }

      const distance = getPreciseDistance(
        { latitude: userLat, longitude: userLng },
        {
          latitude: resolvedCoords.latitude,
          longitude: resolvedCoords.longitude,
        },
      );

      // const radius = Number(loc?.reporting_radius) || 0;
      const radius = sanitizeNumber(loc?.reporting_radius);

      const candidate = {
        locationName: loc?.location || `location-${index + 1}`,
        latitude: resolvedCoords.latitude,
        longitude: resolvedCoords.longitude,
        distance,
        radius,
        withinRadius: radius > 0 ? distance <= radius : false,
      };

      console.log(`${logPrefix} Candidate distance`, {
        index,
        locationName: candidate.locationName,
        source: resolvedCoords.source,
        distance: candidate.distance,
        radius: candidate.radius,
        withinRadius: candidate.withinRadius,
      });

      return candidate;
    })
    .filter(Boolean);

  if (!candidates.length) {
    console.warn(`${logPrefix} No valid nearest location found`, {
      employeeCode,
    });
    return null;
  }

  const nearest = candidates.reduce((picked, current) => {
    if (!picked) return current;
    return current.distance < picked.distance ? current : picked;
  }, null);

  console.log(`${logPrefix} Nearest location resolved`, nearest);
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

    const restrictLocation =
      Number(await AsyncStorage.getItem("restrict_location")) || 0;

    const unrestrictedCheckout =
      Number(await AsyncStorage.getItem("unrestricted_checkout_location")) || 0;

    let nearest = null;
    let radius = null;

    // 📍 Location restriction is enabled
    const shouldSkipLocationRestriction =
      type === "OUT" && unrestrictedCheckout === 1;

    if (
      !shouldSkipLocationRestriction &&
      restrictLocation &&
      // restrictLocation.toString() === "1"

      restrictLocation === 1
    ) {
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

    let currentLocation = null;

    
    if (type === "OUT" && unrestrictedCheckout === 1) {
      nearest = await getOfficeLocation(employeeCode);

      const gps = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      currentLocation = {
        latitude: gps.coords.latitude,
        longitude: gps.coords.longitude,
      };

      if (nearest?.withinRadius) {
        currentLocation.locationName = nearest.locationName;
      } else {
        const address = await Location.reverseGeocodeAsync({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
        });
        

        currentLocation.locationName =
          address?.[0]?.city ||
          address?.[0]?.subregion ||
          address?.[0]?.region ||
          "Live Location";
      }
    }
    // Build base payload
    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
    };
   
    if (currentLocation) {
      payload.location = currentLocation.locationName || "Live Location";

      payload.latitude = currentLocation.latitude;
      payload.longitude = currentLocation.longitude;
    }

    
    if (
      restrictLocation === 1 &&
      nearest &&
      !(type === "OUT" && unrestrictedCheckout === 1)
    ) {
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
    const employee_id =
      (await AsyncStorage.getItem("employee_id")) ||
      (await AsyncStorage.getItem("employee_code"));
    if (!employee_id) return { custom_in: 0 };

    const list = await getUserAttendance(employee_id, 0, 10);

    console.log("ATTENDANCE LIST:", list);

    if (!Array.isArray(list) || list.length === 0) {
      return { custom_in: 0 };
    }

    const getRecordTime = (entry) =>
      toTimestampMs(
        entry?.checkin_time ||
          entry?.latest_checkin_time ||
          entry?.timestamp ||
          entry?.time ||
          entry?.creation,
      ) || 0;

    const latest = list.reduce((a, b) => {
      return getRecordTime(a) > getRecordTime(b) ? a : b;
    });

    const latestCheckin = list
      .filter((entry) => {
        const logType = String(entry?.log_type || "").toUpperCase();
        return normalizeCustomIn(entry?.custom_in) === 1 || logType === "IN";
      })
      .reduce((picked, current) => {
        if (!picked) return current;
        return getRecordTime(picked) > getRecordTime(current)
          ? picked
          : current;
      }, null);

    const latestLogType = String(latest?.log_type || "").toUpperCase();

    console.log("LATEST RECORD:", latest);

    return {
      custom_in:
        normalizeCustomIn(latest?.custom_in) === 1 || latestLogType === "IN"
          ? 1
          : 0,
      checkin_time: latestCheckin ? getRecordTime(latestCheckin) : null,
      log_type: latest?.log_type || null,
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

    // const rawTimestamp = await getServerTime();
    // const timestamp = rawTimestamp.split(".")[0];

    const timestamp = (await getServerTime()).split(".")[0];
    console.log("TIMESTAMP SENT:", timestamp);

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

    // const breakId = response.data?.message?.name;
    // console.log("BREAK API RESPONSE:", JSON.stringify(response.data, null, 2));
    // if (!breakId) {
    //   return {
    //     allowed: false,
    //     message: "Failed to register break",
    //   };
    // }
    const message = response.data?.message;

    // ✅ HANDLE backend string error (IMPORTANT)
    if (typeof message === "string") {
      return {
        allowed: false,
        message: message,
      };
    }

    // ✅ Normal success case
    const breakId = message?.name;

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
