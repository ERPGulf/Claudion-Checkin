import { requireOptionalNativeModule } from "expo-modules-core";

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
export function startGeofence({ latitude, longitude, radius, identifier }) {
  return nativeModule().startGeofence({
    latitude,
    longitude,
    radius,
    identifier,
  });
}

/**
 * Removes the registered geofence and stops monitoring.
 * @returns {Promise<void>}
 */
export function stopGeofence() {
  return nativeModule().stopGeofence();
}

/** @returns {boolean} whether a geofence is currently registered. */
export function isMonitoring() {
  return nativeModule().isMonitoring();
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
