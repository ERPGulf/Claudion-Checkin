// src/services/api/attendance.service.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { format } from "date-fns";
import apiClient from "./apiClient";
import { cleanBaseUrl } from "./utils";
import {
  getAuthContext,
  buildHeaders,
  MISSING_EMPLOYEE_MESSAGE,
} from "./authHelper";
import { parseError } from "./errorHelper";
import {
  normalizeCustomIn,
  toTimestampMs,
} from "../../utils/attendanceSession";
import { scoreLocations, pickNearest } from "../../utils/attendanceLocations";
import { assertCompleteAttendancePolicy } from "../offline/attendanceConfigCache";
import { getAuthSessionGeneration } from "../../utils/authSessionGuard";
import { assertCapability, assertCapabilityCurrent } from "../capabilityPolicy";
import {
  readManualAttendanceLocationPolicy, assertManualAttendanceLocationPolicyCurrent,
} from "../manualAttendanceLocationPolicy";
import { assertAttendanceQueueScope, captureAttendanceQueueScope, createAttendanceScopeChangedError, normalizeAttendanceTenantKey } from "../offline/attendanceQueueProvenance";
import {
  beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy,
  assertEmployeeAutoAttendancePolicy, assertEmployeeAutoAttendancePolicyCurrent,
  getEmployeeAutoAttendancePolicy,
} from "../employeeAutoAttendancePolicy";
import {
  parseServerWallClock,
  rememberServerOffset,
  normalizeAttendanceStatusClock,
  SERVER_TIMESTAMP_FORMAT,
} from "../../utils/serverClock";
import {
  isProgrammingError,
  recordNonFatalError,
} from "../crashlytics.service";

export const getServerTime = async ({ syncScope } = {}) => {
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");

  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_server_time`;

  const response = await apiClient.get(url, {
    ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const observedAt = Date.now();
  if (syncScope) await assertAttendanceQueueScope(syncScope);

  // Extract correct field from API response
  const serverTime = response.data?.message?.server_time;

  // Every successful call is a free measurement of how far the device clock has
  // drifted from the server's. Offline check-ins are stamped with device time
  // plus this offset, so a wrong phone clock cannot shift a queued punch.
  // Fire-and-forget: a storage failure must never fail a check-in.
  rememberServerOffset(serverTime, observedAt, {
    tenantKey: syncScope?.tenantKey ?? normalizeAttendanceTenantKey(baseUrl),
  }).catch(() => {});

  return serverTime;
};

/**
 * Server-clock timestamp for something that happened `occurredAt` (device epoch
 * ms) rather than now — used to backdate a geofence transition that the OS
 * delivered while the app was killed, so the attendance log carries the moment
 * the user actually crossed the boundary.
 *
 * Works without knowing the server's timezone: the age of the event is measured
 * purely with the device clock (immune to device/server skew) and subtracted
 * from the server's own wall clock, then re-formatted with the same digits the
 * server would have used. A DST change inside the gap is the one case this can
 * be an hour out; it degrades to a slightly wrong time, never a rejected log.
 *
 * Falls back to the server's current time whenever the event time is unusable,
 * which is exactly the pre-existing behaviour.
 */
export const resolveServerTimestampAt = async (occurredAt, nowMs = Date.now(), options = {}) => {
  const lookupStartedAt = Date.now();
  const serverNow = await getServerTime(options);
  const occurredAtMs = toTimestampMs(occurredAt);

  if (!occurredAtMs) return serverNow;

  // The returned server clock was observed after this lookup, not at dispatch.
  // Include elapsed lookup time so a slow request cannot move the punch forward.
  const ageMs = nowMs + (Date.now() - lookupStartedAt) - occurredAtMs;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return serverNow;

  const serverWallClock = parseServerWallClock(serverNow);
  if (!serverWallClock) return serverNow;

  return format(
    new Date(serverWallClock.getTime() - ageMs),
    SERVER_TIMESTAMP_FORMAT,
  );
};

// getOfficeLocation(employeeCode) — returns nearest location object or null

export const getOfficeLocation = async (employeeCode, { syncScope, onAssignedGeometry } = {}) => {
  const logPrefix = "[attendance.service/getOfficeLocation]";
  const generation = getAuthSessionGeneration();

  if (!employeeCode) throw new Error("Employee ID is required");
  syncScope = syncScope ?? await captureAttendanceQueueScope(employeeCode);
  if (syncScope) {
    await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
  }

  console.log(`${logPrefix} Start`, { employeeCode });

  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("Base URL missing");

  const token = await AsyncStorage.getItem("access_token");
  if (!token) throw new Error("Access token missing");

  const url = `${baseUrl}/api/method/employee_app.attendance_api.get_employee_data`;
  const reception = beginEmployeeAutoAttendancePolicyReception(syncScope);

  const { data } = await apiClient.get(url, {
    ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
    params: { employee_id: employeeCode },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    timeout: 10000,
  });
  if (syncScope) await assertAttendanceQueueScope(syncScope);

  console.log(
    `${logPrefix} RAW EMPLOYEE RESPONSE`,
    JSON.stringify(data, null, 2),
  );

  const employee = data?.message || {};
  // Receive employee mode before GPS/permissions or other policy work can fail.
  await receiveEmployeeAutoAttendancePolicy(employee, reception);
  if (await AsyncStorage.getItem("auth_method") === "mobile") {
    if (generation !== getAuthSessionGeneration()) throw createAttendanceScopeChangedError();
    assertCompleteAttendancePolicy(employee);
  }

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

  // The scoped receiver resolves overlapping employee requests. Legacy keys
  // mirror its answer; an older response must not republish an earlier mode.
  const employeePolicy = await getEmployeeAutoAttendancePolicy(syncScope);
  const geotagging = employeePolicy?.mode ?? 0;

  const locations = sanitizeArray(employee?.employee_locations);
  // Bind manual proof to the geometry this call will actually score. A later
  // refresh during GPS must not label an old inside-radius result as new proof.
  onAssignedGeometry?.(JSON.stringify(locations));

  console.log(`${logPrefix} Employee API response`, employee);

  console.log(`${logPrefix} Restriction settings`, {
    restrict_location: restrictLocation,
    unrestricted_checkout_location: unrestrictedCheckoutLocation,
    photo,
    geotagging,
    locationsCount: locations.length,
  });

  if (generation !== getAuthSessionGeneration()) throw createAttendanceScopeChangedError();
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  await AsyncStorage.multiSet([
    ["restrict_location", String(restrictLocation)],

    ["unrestricted_checkout_location", String(unrestrictedCheckoutLocation)],

    ["photo", String(photo)],

    ["geotagging", String(geotagging)],

    ["employee_locations", JSON.stringify(locations)],
  ]);
  if (syncScope) await assertAttendanceQueueScope(syncScope);

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
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  console.log(`${logPrefix} Foreground permission`, { status });
  if (status !== "granted") throw new Error("Location permission denied");

  // Get current GPS coordinates
  const gps = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
  });
  if (syncScope) await assertAttendanceQueueScope(syncScope);

  const userLat = gps.coords.latitude;
  const userLng = gps.coords.longitude;

  console.log(`${logPrefix} Current GPS`, {
    latitude: userLat,
    longitude: userLng,
  });

  // The distance arithmetic lives in utils/attendanceLocations.js so the offline
  // gate can run exactly the same rules against the cached configuration. Two
  // copies would agree in the office and disagree at the boundary — the only
  // place the answer matters.
  const candidates = scoreLocations(
    { latitude: userLat, longitude: userLng },
    locations,
    ({ index, locationName }) =>
      console.warn(`${logPrefix} Invalid coordinates for location`, {
        index,
        locationName,
      }),
  );

  candidates.forEach((candidate, index) =>
    console.log(`${logPrefix} Candidate distance`, {
      index,
      locationName: candidate.locationName,
      source: candidate.source,
      distance: candidate.distance,
      radius: candidate.radius,
      withinRadius: candidate.withinRadius,
    }),
  );

  if (!candidates.length) {
    console.warn(`${logPrefix} No valid nearest location found`, {
      employeeCode,
    });
    return null;
  }

  const nearest = pickNearest(candidates);

  console.log(`${logPrefix} Nearest location resolved`, nearest);
  return nearest;
};

// userCheckIn({ employeeCode, type }) — performs check-in/check-out
export const userCheckIn = async ({ employeeCode, type, locationData, syncScope, occurredAt }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");
    if (type !== "IN" && type !== "OUT") throw new Error(`Invalid attendance type: ${type}`);
    // Direct service calls retain the same owner across GPS, clock and retries.
    syncScope = syncScope ?? await captureAttendanceQueueScope(employeeCode);
    let current = await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
    const baseUrl = current.tenantKey;

    let policy = await readManualAttendanceLocationPolicy(syncScope, type);
    let nearest = null;
    let evidence;
    let currentLocation = null;
    const resolveAssignedLocation = async () => {
      let geometryKey;
      nearest = await getOfficeLocation(employeeCode, { syncScope,
        onAssignedGeometry: value => { geometryKey = value; } });
      await assertAttendanceQueueScope(syncScope);
      evidence = { nearest, withinRadius: nearest?.withinRadius === true,
        geometryKey, gpsVerified: !!nearest };
    };

    if (policy.requiresRadius) {
      await resolveAssignedLocation();
      policy = await readManualAttendanceLocationPolicy(syncScope, type);
      assertManualAttendanceLocationPolicyCurrent(policy, evidence);
    }

    const timestamp = occurredAt == null ? await getServerTime({ syncScope })
      : await resolveServerTimestampAt(occurredAt, Date.now(), { syncScope });
    await assertAttendanceQueueScope(syncScope);

    // Settings can tighten while the server clock or GPS request is pending.
    // Obtain the existing assigned-location proof once if it is now required;
    // the final guard refuses any further policy/geometry change safely.
    policy = await readManualAttendanceLocationPolicy(syncScope, type);
    if (policy.requiresRadius && (!evidence || evidence.geometryKey !== policy.geometryKey)) {
      await resolveAssignedLocation();
      policy = await readManualAttendanceLocationPolicy(syncScope, type);
    }
    if (policy.needsCheckoutGPS) {
      if (!nearest) await resolveAssignedLocation();
      const gps = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      await assertAttendanceQueueScope(syncScope);
      currentLocation = { latitude: gps.coords.latitude, longitude: gps.coords.longitude };
      currentLocation.locationName = nearest?.withinRadius ? nearest.locationName
        : `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}`;
      evidence = { ...evidence, gpsVerified: true };
      policy = await readManualAttendanceLocationPolicy(syncScope, type);
    }
    policy = assertManualAttendanceLocationPolicyCurrent(policy, evidence);
    // Build base payload
    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
      // The employee tapped the button. `auto` is what lets the server tell a
      // deliberate punch from a geofence crossing (see autoCheckInOut), so it is
      // sent explicitly on both paths rather than left to a server-side default.
      auto: false,
    };

    if (currentLocation) {
      payload.location = currentLocation.locationName || "Live Location";

      payload.latitude = currentLocation.latitude;
      payload.longitude = currentLocation.longitude;
    }

    if (policy.requiresRadius && nearest) {
      payload.location = nearest.locationName;
      payload.latitude = nearest.latitude;
      payload.longitude = nearest.longitude;
      payload.distance = nearest.distance;
      payload.radius = nearest.radius;
    }

    current = await assertAttendanceQueueScope(syncScope);
    policy = await readManualAttendanceLocationPolicy(syncScope, type);
    assertManualAttendanceLocationPolicyCurrent(policy, evidence);
    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`,
      payload,
      {
        attendanceSyncScope: syncScope,
        manualAttendancePolicy: { scope: syncScope, type, evidence },
        headers: { Authorization: `Bearer ${current.accessToken}` },
      },
    );
    await assertAttendanceQueueScope(syncScope);

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
    if (error.code === "CAPABILITY_SCOPE_CHANGED" && syncScope) {
      // The transport also checks ownership. Preserve manual attendance's
      // established scope error when it detects an account change first.
      try { await assertAttendanceQueueScope(syncScope); } catch (scopeError) { error = scopeError; }
    }
    // Refusals, permissions and network failures are expected here and stay
    // out of Crashlytics; a TypeError building the punch is a bug.
    if (isProgrammingError(error)) {
      recordNonFatalError(error, { feature: "attendance", action: "manual_punch", type });
    }
    return {
      allowed: false,
      message: error.message || "Something went wrong during check-in",
      distance: error.location?.distance ?? null,
      radius: error.location?.radius ?? null,
      location: error.location ?? null,
      // The original error, so a caller can tell a dropped connection from a
      // refusal. Flattening everything to a string made those indistinguishable,
      // which is the difference between queueing a punch for later and silently
      // swallowing a real policy rejection. Nothing else reads this field.
      error,
    };
  }
};

/**
 * autoCheckInOut({ employeeCode, type, office }) — attendance triggered by the
 * office geofence (AutoAttendanceBootstrap), NOT the manual screens.
 *
 * Deliberately separate from `userCheckIn` so the manual flow (including the
 * `restrict_location` / `unrestricted_checkout_location` remote-worker rules)
 * stays exactly as-is. Here the geofence transition IS the location check:
 * ENTER means the device is inside the radius, EXIT means it is outside — so
 * this path must NOT re-run the within-radius gate. Doing so would reject every
 * automatic check-out, since leaving the office is by definition "outside".
 *
 * Hits the same backend method as `userCheckIn`. `office` (optional) is the
 * reporting location the geofence is registered against; it is used only to tag
 * the log with a location, never to allow or deny the action.
 *
 * `occurredAt` (optional, device epoch ms) is when the geofence transition
 * actually happened. It matters for events replayed at launch after the OS
 * delivered them to a killed app: without it the log would carry the time the
 * user next opened the app instead of the time they left the office.
 */
export const autoCheckInOut = async ({
  employeeCode,
  type,
  office = null,
  occurredAt = null,
  timestamp: preparedTimestamp,
  syncScope,
}) => {
  const logPrefix = "[attendance.service/autoCheckInOut]";
  try {
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    if (!employeeCode) throw new Error("Employee ID is required");
    if (type !== "IN" && type !== "OUT") {
      throw new Error(`Invalid attendance type: ${type}`);
    }
    syncScope = syncScope ?? await captureAttendanceQueueScope(employeeCode);
    const current = await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
    const baseUrl = current.tenantKey;
    const token = current.accessToken;

    const capabilityScope = await assertCapability("attendance_action.auto_attendance", { baseUrl, employeeCode });
    await assertEmployeeAutoAttendancePolicy(syncScope, { action: "punch" });

    const timestamp = preparedTimestamp ?? await resolveServerTimestampAt(occurredAt, Date.now(), { syncScope });
    if (syncScope) await assertAttendanceQueueScope(syncScope);

    const payload = {
      device_id: "MobileAPP",
      employee_field_value: employeeCode,
      log_type: type,
      timestamp,
      // The office geofence made this call, not the employee — this is the
      // whole distinction the flag exists to record.
      auto: true,
    };

    // Informational only — position was already proven by the geofence
    // transition, so a missing office just means an untagged log, never a
    // blocked action.
    const latitude = Number(office?.latitude);
    const longitude = Number(office?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      payload.latitude = latitude;
      payload.longitude = longitude;
      payload.location = office?.locationName || "Automatic (geofence)";
    }

    console.log(`${logPrefix} Auto ${type}`);

    await assertCapability("attendance_action.auto_attendance", capabilityScope);
    await assertEmployeeAutoAttendancePolicy(syncScope, { action: "punch" });
    assertCapabilityCurrent("attendance_action.auto_attendance", capabilityScope);
    assertEmployeeAutoAttendancePolicyCurrent(syncScope, { action: "punch" });
    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`,
      payload,
      {
        capabilityScope,
        headers: { Authorization: `Bearer ${token}` },
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
      },
    );

    const checkinId = response.data?.message?.name;
    if (!checkinId) {
      return {
        allowed: false,
        message: "Failed to register automatic attendance",
        location: office,
      };
    }

    return {
      allowed: true,
      name: checkinId,
      message: `Automatically ${type === "IN" ? "checked in" : "checked out"}`,
      location: office,
    };
  } catch (error) {
    console.log(`${logPrefix} Failed`, { code: error?.code, httpStatus: error?.response?.status });
    // Same rule as userCheckIn: only a bug in our own code is reported.
    if (isProgrammingError(error)) {
      recordNonFatalError(error, { feature: "attendance", action: "auto_punch", type });
    }
    return {
      allowed: false,
      message: error?.message || "Automatic attendance failed",
      location: office,
      // See the note on userCheckIn's catch — lets the offline queue distinguish
      // a transport failure from a rejection.
      error,
    };
  }
};

/**
 * getUserAttendance(employee_id, limit_start, limit_page_length)
 */
const readAttendanceEntries = async (
  employee_id,
  limit_start = 0,
  limit_page_length = 20,
  { syncScope, attendanceStatusRead = false } = {},
) => {
  try {
    if (syncScope) await assertAttendanceQueueScope(syncScope);
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
    const capabilityScope = !attendanceStatusRead
      ? await assertCapability("attendance_action.attendance_history", { baseUrl, employeeCode: employee_id })
      : undefined;
    const url = `${baseUrl}/api/method/employee_app.attendance_api.get_attendance_details`;
    const response = await apiClient.get(url, {
      ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
      ...(capabilityScope ? { capabilityScope } : {}),
      ...(attendanceStatusRead ? { attendanceStatusRead: true } : {}),
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
    if (syncScope) await assertAttendanceQueueScope(syncScope);
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

/** History is optional; the private session-status read remains essential. */
export const getUserAttendance = (employeeId, start = 0, length = 20, { syncScope } = {}) =>
  readAttendanceEntries(employeeId, start, length, { syncScope });
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

export const getAttendanceStatus = async ({ syncScope } = {}) => {
  try {
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const employee_id =
      (await AsyncStorage.getItem("employee_id")) ||
      (await AsyncStorage.getItem("employee_code"));
    if (!employee_id) return { custom_in: 0 };

    const list = await readAttendanceEntries(employee_id, 0, 10, { syncScope, attendanceStatusRead: true });

    // `getUserAttendance` swallows every failure into `{ error }`, which used to
    // arrive here indistinguishable from "no records" and become custom_in: 0 —
    // i.e. "the server says you are checked out". Offline that is a lie, and
    // callers act on it by CLOSING an open session, so an offline check-in was
    // silently reverted the next time this ran. `unavailable` lets a caller tell
    // "no session" from "no answer".
    if (list?.error) {
      return { custom_in: 0, unavailable: true, error: list.error };
    }

    if (!Array.isArray(list) || list.length === 0) {
      return { custom_in: 0 };
    }

    const getRecordValue = (entry) =>
      entry?.checkin_time ||
      entry?.latest_checkin_time ||
      entry?.timestamp ||
      entry?.time ||
      entry?.creation;
    const getRecordTime = entry => toTimestampMs(getRecordValue(entry)) || 0;

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
    // Normalize while the original representation is still available. Parsing
    // a naive server wall clock to a number first erases its clock domain.
    const checkin = latestCheckin ? { checkin_time: getRecordValue(latestCheckin) } : { checkin_time: null };
    const normalized = syncScope ? await normalizeAttendanceStatusClock(checkin, syncScope) : checkin;
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    return {
      custom_in:
        normalizeCustomIn(latest?.custom_in) === 1 || latestLogType === "IN"
          ? 1
          : 0,
      checkin_time: latestCheckin ? toTimestampMs(normalized.checkin_time) || 0 : null,
      log_type: latest?.log_type || null,
    };
  } catch (e) {
    console.log("STATUS ERROR:", { code: e?.code, httpStatus: e?.response?.status });
    // Same reasoning as the `list.error` branch above: a thrown failure is not
    // the server reporting a closed session.
    return { custom_in: 0, unavailable: true, error: e?.message };
  }
};
// Get daily worked hours
export const getDailyWorkedHours = async (employeeCode, date, { syncScope } = {}) => {
  if (syncScope) {
    await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
  }
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  try {
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_total_hours`,
      {
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
        headers: { Authorization: `Bearer ${token}` },
        params: { employee: employeeCode, date },
      },
    );
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const hours = response.data?.message?.trim();
    return hours ? hours : "00:00";
  } catch (err) {
    if (syncScope) {
      await assertAttendanceQueueScope(syncScope);
      if (err?.code === "ATTENDANCE_SYNC_SCOPE_CHANGED") throw err;
    }
    return "00:00";
  }
};
// Get monthly worked hours
export const getMonthlyWorkedHours = async (employeeCode, month, year, { syncScope } = {}) => {
  if (syncScope) {
    await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
  }
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  try {
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_monthly_hours`,
      {
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
        headers: { Authorization: `Bearer ${token}` },
        params: { employee: employeeCode, month, year },
      },
    );
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const hours = response.data?.message?.trim();
    return hours ? hours : "00:00";
  } catch (err) {
    if (syncScope) {
      await assertAttendanceQueueScope(syncScope);
      if (err?.code === "ATTENDANCE_SYNC_SCOPE_CHANGED") throw err;
    }
    return "00:00";
  }
};

export const getTodayBreaks = async (employeeCode, date, { syncScope } = {}) => {
  if (syncScope) {
    await assertAttendanceQueueScope(syncScope);
    if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
  }
  const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
  if (syncScope) await assertAttendanceQueueScope(syncScope);
  const baseUrl = cleanBaseUrl(rawBaseUrl);
  const token = await AsyncStorage.getItem("access_token");
  if (syncScope) await assertAttendanceQueueScope(syncScope);

  try {
    const capabilityScope = await assertCapability("attendance_action.employee_checkin_break", { baseUrl, employeeCode });
    const response = await apiClient.get(
      `${baseUrl}/api/method/employee_app.attendance_api.get_today_breaks`,
      {
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
        capabilityScope,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          employee: employeeCode,
          date,
        },
      },
    );
    if (syncScope) await assertAttendanceQueueScope(syncScope);

    const data = response.data?.message;

    // Return full object (important for flexibility)
    return data || { total_break_minutes: 0, breaks: [] };
  } catch (err) {
    if (syncScope) {
      await assertAttendanceQueueScope(syncScope);
      if (err?.code === "ATTENDANCE_SYNC_SCOPE_CHANGED") throw err;
    }
    return { total_break_minutes: 0, breaks: [] };
  }
};

export const employeeBreak = async ({ employeeCode, type, reason, syncScope }) => {
  try {
    if (!employeeCode) throw new Error("Employee ID is required");
    if (syncScope) {
      await assertAttendanceQueueScope(syncScope);
      if (syncScope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
    }

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new Error("Base URL missing");

    const token = await AsyncStorage.getItem("access_token");
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    if (!token) throw new Error("Token missing");

    const capabilityScope = await assertCapability("attendance_action.employee_checkin_break", { baseUrl, employeeCode });

    // const rawTimestamp = await getServerTime();
    // const timestamp = rawTimestamp.split(".")[0];

    const timestamp = (await getServerTime({ syncScope })).split(".")[0];
    if (syncScope) await assertAttendanceQueueScope(syncScope);
    console.log("TIMESTAMP SENT:", timestamp);

    const formData = new URLSearchParams();
    formData.append("employee_field_value", employeeCode);
    formData.append("timestamp", timestamp);
    formData.append("device_id", "09267");
    formData.append("log_type", type);
    // Optional, and only ever supplied when a break is started — ending one
    // stays a single tap.
    formData.append("reason", reason || "");

    const response = await apiClient.post(
      `${baseUrl}/api/method/employee_app.attendance_api.Employee_break`,
      formData.toString(),
      {
        ...(syncScope ? { attendanceSyncScope: syncScope } : {}),
        capabilityScope,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    if (syncScope) await assertAttendanceQueueScope(syncScope);

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
    if (syncScope) {
      await assertAttendanceQueueScope(syncScope);
      if (error?.code === "ATTENDANCE_SYNC_SCOPE_CHANGED") throw error;
    }
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
}, { capabilityScope: expected } = {}) => {
  try {
    const owner = expected ? await assertCapability("attendance_action.attendance_request", expected) : null;
    if (!employee) throw new Error("Employee ID is required");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");

    if (!baseUrl) throw new Error("Base URL missing");
    if (!token) throw new Error("Token missing");

    const capabilityScope = await assertCapability("attendance_action.attendance_request", { ...owner, baseUrl, employeeCode: employee });

    const url = `${baseUrl}/api/method/employee_app.gauth.create_attendence_request`;

    const formData = new URLSearchParams();

    formData.append("employee", employee);
    formData.append("from_date", from_date);
    formData.append("to_date", to_date);
    formData.append("reason", reason || "");
    formData.append("from_time", from_time || "");
    formData.append("to_time", to_time || "");

    const response = await apiClient.post(url, formData.toString(), {
      capabilityScope,
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

export const uploadAttendanceAttachment = async (file, docname, { capabilityScope: expected } = {}) => {
  try {
    const owner = expected ? await assertCapability("attendance_action.attendance_request", expected) : null;
    if (!file?.uri) throw new Error("Invalid file");
    if (!docname) throw new Error("Missing docname");

    const rawBaseUrl = await AsyncStorage.getItem("baseUrl");
    const baseUrl = cleanBaseUrl(rawBaseUrl);
    const token = await AsyncStorage.getItem("access_token");
    const capabilityScope = await assertCapability("attendance_action.attendance_request", { ...owner, baseUrl });

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

    await assertCapability("attendance_action.attendance_request", capabilityScope);
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
/* ===========================
   Get Attendance Requests
=========================== */
export const getAttendanceRequests = async () => {
  try {
    const { baseUrl, token, employeeCode } = await getAuthContext();

    if (!employeeCode) {
      return { error: MISSING_EMPLOYEE_MESSAGE };
    }

    const capabilityScope = await assertCapability("attendance_action.attendance_request", { baseUrl, employeeCode });

    const url = `${baseUrl}/api/method/employee_app.employee_list.list_attendance_request`;

    const response = await apiClient.get(url, {
      capabilityScope,
      headers: buildHeaders(token),
    });

    if (!Array.isArray(response.data?.message)) {
      return { error: "Invalid attendance request response." };
    }

    return { message: response.data.message };
  } catch (error) {
    return {
      error: parseError(error, "Unable to load attendance requests."),
    };
  }
};

export default {
  getServerTime,
  getOfficeLocation,
  userCheckIn,
  autoCheckInOut,
  getUserAttendance,
  getAttendanceStatus,
  getDailyWorkedHours,
  getMonthlyWorkedHours,
  employeeBreak,
  getTodayBreaks,
  createAttendanceRequest,
  uploadAttendanceAttachment,
  getAttendanceRequests,
};
