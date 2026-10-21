import { requireOptionalNativeModule } from "expo";
import { assertCapability, assertCapabilityCurrent } from "../../services/capabilityPolicy";
import { assertEmployeeAutoAttendancePolicy, assertEmployeeAutoAttendancePolicyCurrent } from "../../services/employeeAutoAttendancePolicy";
import { readAttendanceQueueScope } from "../../services/offline/attendanceQueueProvenance";
import { ATTENDANCE_FEATURES } from "../../utils/featureSettings";

/**
 * JS API for the `expo-auto-attendance` local Expo module (Android + iOS).
 *
 * Wraps the platforms' native geofencing — Play Services GeofencingClient on
 * Android, Core Location region monitoring on iOS — with one API and event
 * contract. No background GPS polling: the OS delivers ENTER/EXIT transitions
 * to native code (BroadcastReceiver / CLLocationManagerDelegate), which
 * forwards them here as events.
 *
 * `requireOptionalNativeModule` returns null on platforms where the native
 * module is unavailable (web, Expo Go, builds predating the module), so
 * importing this file is safe everywhere; calling the functions throws a
 * descriptive error instead.
 */
const ExpoAutoAttendance = requireOptionalNativeModule("ExpoAutoAttendance");

export const EVENT_ENTER = "onGeofenceEnter";
export const EVENT_EXIT = "onGeofenceExit";
export const EVENT_ERROR = "onError";

/** Shared identifier for the single production geofence, used by both the
 * AutoAttendance screen (dev tools) and AutoAttendanceBootstrap (real
 * monitoring) so they always replace the same registration. */
export const OFFICE_GEOFENCE_IDENTIFIER = "office-main";

/** True when the native module is present (dev/production build). */
export function isAvailable() {
  return ExpoAutoAttendance != null;
}

function nativeModule() {
  if (!ExpoAutoAttendance) {
    throw new Error(
      "expo-auto-attendance is only available in native builds that include the module",
    );
  }
  return ExpoAutoAttendance;
}

/**
 * Registers a single circular geofence and starts monitoring.
 * Requires foreground + background ("all the time"/"Always") location
 * permission to already be granted — rejects with ERR_LOCATION_PERMISSION /
 * ERR_BACKGROUND_LOCATION_PERMISSION otherwise.
 *
 * @param {{latitude: number, longitude: number, radius: number, identifier: string}} options
 * @returns {Promise<void>}
 */
export function supportsDurableEvents() {
  return typeof ExpoAutoAttendance?.getPendingEvents === "function" &&
    typeof ExpoAutoAttendance?.acknowledgeEvent === "function";
}

const captureMonitoringScope = async expectedScope => {
  if (expectedScope) return expectedScope;
  const current = await readAttendanceQueueScope();
  // Keep the first read's owner, including its auth generation. A second read
  // to discover/capture the employee could adopt a new tenant between awaits.
  return { tenantKey: current.tenantKey, employeeId: current.employeeId,
    accountId: current.accountId, generation: current.generation };
};

export async function startGeofence({ latitude, longitude, radius, identifier, ...scope }, expectedScope) {
  const captured = await captureMonitoringScope(expectedScope);
  const owner = { ...captured,
    ...(scope.tenantKey !== undefined ? { tenantKey: scope.tenantKey } : {}),
    ...(scope.employeeId !== undefined ? { employeeId: scope.employeeId } : {}),
    ...(scope.generation !== undefined ? { generation: scope.generation } : {}),
  };
  const assertAllowed = async () => {
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE,
      { baseUrl: owner.tenantKey, employeeCode: owner.employeeId, generation: owner.generation });
    const policy = await assertEmployeeAutoAttendancePolicy(owner, { action: "monitor" });
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, owner);
    return policy;
  };
  await assertAllowed();
  assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, owner);
  const policy = assertEmployeeAutoAttendancePolicyCurrent(owner, { action: "monitor" });
  if (scope.geotagging !== undefined && Number(scope.geotagging) !== policy.mode) {
    const error = new Error("Employee automatic attendance policy changed before registration.");
    error.code = "EMPLOYEE_AUTO_ATTENDANCE_POLICY_CHANGED";
    throw error;
  }
  const result = await nativeModule().startGeofence({
    latitude,
    longitude,
    radius,
    identifier,
    ...(supportsDurableEvents() ? {
      tenantKey: owner.tenantKey,
      employeeId: owner.employeeId,
      registrationId: scope.registrationId,
      geotagging: policy.mode,
    } : {}),
  });
  try {
    await assertAllowed();
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, owner);
    const current = assertEmployeeAutoAttendancePolicyCurrent(owner, { action: "monitor" });
    if (current.mode !== policy.mode) {
      const error = new Error("Employee automatic attendance policy changed during registration.");
      error.code = "EMPLOYEE_AUTO_ATTENDANCE_POLICY_CHANGED";
      throw error;
    }
  } catch (error) {
    await nativeModule().stopGeofence();
    throw error;
  }
  return result;
}

/**
 * Removes the registered geofence and stops monitoring.
 * @returns {Promise<void>}
 */
export function stopGeofence() {
  return nativeModule().stopGeofence();
}

/** Additive iOS repair; an older binary has no unfinished-state retry method. */
export async function retryInitialPresence(expectedScope) {
  if (typeof ExpoAutoAttendance?.retryInitialPresence !== "function") return false;
  const scope = await captureMonitoringScope(expectedScope);
  const assertAllowed = async () => {
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE,
      { baseUrl: scope.tenantKey, employeeCode: scope.employeeId, generation: scope.generation });
    const policy = await assertEmployeeAutoAttendancePolicy(scope, { action: "monitor" });
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
    return policy;
  };
  await assertAllowed();
  assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
  const policy = assertEmployeeAutoAttendancePolicyCurrent(scope, { action: "monitor" });
  const result = await ExpoAutoAttendance.retryInitialPresence();
  try {
    await assertAllowed();
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
    const current = assertEmployeeAutoAttendancePolicyCurrent(scope, { action: "monitor" });
    if (current.mode !== policy.mode) {
      const error = new Error("Employee automatic attendance policy changed during initial-state retry.");
      error.code = "EMPLOYEE_AUTO_ATTENDANCE_POLICY_CHANGED";
      throw error;
    }
  } catch (error) {
    await nativeModule().stopGeofence();
    throw error;
  }
  return result;
}

/** @returns {boolean} whether a geofence is currently registered. */
export function isMonitoring() {
  return nativeModule().isMonitoring();
}

/**
 * iOS only: false once the user picks "Precise: Off" for this app — a small
 * geofence radius is unreliable under reduced (city-block) accuracy. Always
 * true on Android, which has no equivalent per-app toggle.
 * @returns {boolean}
 */
export function hasFullAccuracy() {
  if (!ExpoAutoAttendance || typeof ExpoAutoAttendance.hasFullAccuracy !== "function") {
    return true;
  }
  return ExpoAutoAttendance.hasFullAccuracy();
}

/**
 * iOS only: Low Power Mode throttles Core Location and can delay or suppress
 * geofence delivery. Always false on Android.
 * @returns {boolean}
 */
export function isLowPowerModeEnabled() {
  if (!ExpoAutoAttendance || typeof ExpoAutoAttendance.isLowPowerModeEnabled !== "function") {
    return false;
  }
  return ExpoAutoAttendance.isLowPowerModeEnabled();
}

/**
 * Android only: false when OS/OEM battery management (common on Xiaomi, Huawei,
 * Oppo, Vivo, OnePlus, Samsung) may restrict this app's background execution —
 * the single biggest real-world cause of missed geofence events on Android,
 * distinct from Battery Saver. No equivalent on iOS — always true there.
 * @returns {boolean}
 */
export function isIgnoringBatteryOptimizations() {
  if (
    !ExpoAutoAttendance ||
    typeof ExpoAutoAttendance.isIgnoringBatteryOptimizations !== "function"
  ) {
    return true;
  }
  return ExpoAutoAttendance.isIgnoringBatteryOptimizations();
}

/**
 * @returns {Array<{identifier: string, latitude: number, longitude: number, radius: number}>}
 */
export function getRegisteredGeofences() {
  return nativeModule().getRegisteredGeofences();
}

/**
 * Last transition received natively — survives app restarts, so events that
 * fired while the app was killed are still visible.
 * @returns {{transition: "ENTER"|"EXIT", identifier: string, timestamp: number}|null}
 */
export function getLastEvent() {
  return nativeModule().getLastEvent();
}

export function clearLastEvent() {
  return nativeModule().clearLastEvent();
}

/** Null distinguishes an older binary from an empty durable journal. */
export function getPendingEvents() {
  return supportsDurableEvents() ? nativeModule().getPendingEvents() : null;
}

/** Call only after the event has committed to the SQLite ingress ledger. */
export function acknowledgeEvent(eventId) {
  return supportsDurableEvents() ? nativeModule().acknowledgeEvent(eventId) : false;
}

/**
 * @param {(event: {identifier: string, identifiers: string[], transition: "ENTER", timestamp: number}) => void} listener
 * @returns {{remove: () => void}} subscription
 */
export function addGeofenceEnterListener(listener) {
  return nativeModule().addListener(EVENT_ENTER, listener);
}

/**
 * @param {(event: {identifier: string, identifiers: string[], transition: "EXIT", timestamp: number}) => void} listener
 * @returns {{remove: () => void}} subscription
 */
export function addGeofenceExitListener(listener) {
  return nativeModule().addListener(EVENT_EXIT, listener);
}

/**
 * @param {(event: {code: number, message: string}) => void} listener
 * @returns {{remove: () => void}} subscription
 */
export function addErrorListener(listener) {
  return nativeModule().addListener(EVENT_ERROR, listener);
}
