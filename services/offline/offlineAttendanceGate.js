// src/services/offline/offlineAttendanceGate.js
import * as Location from "expo-location";
import { findNearestLocation } from "../../utils/attendanceLocations";
import { getOfficeLocation } from "../api/attendance.service";
import {
  NO_CONFIG_MESSAGE,
  readAttendanceConfig,
} from "./attendanceConfigCache";
import { isOfflineFailure } from "./attendanceErrors";
import { fetchShouldAttemptRequest } from "./NetworkListener";

/**
 * The offline half of the location gate.
 *
 * Online, `userCheckIn` asks the server for the employee's reporting locations
 * and then measures against them. Offline it cannot, so this measures against
 * the cached configuration instead — same locations, same radii, same arithmetic
 * (`utils/attendanceLocations.js` is shared with the online path), just a
 * different source for the rules.
 *
 * The gate is enforced offline, not skipped. "Never show an error when offline"
 * is about network failures — the employee should not be punished for a dead
 * signal. It is not about policy: if it did not apply offline, checking in from
 * home would be one flick of aeroplane mode away, and the restriction would be
 * decorative.
 */

/** GPS budget before falling back to the last known fix. */
const FIX_TIMEOUT_MS = 12000;

/** A fix older than this is not evidence of where you are standing now. */
const STALE_FIX_MS = 2 * 60 * 1000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

/**
 * A position fix, without the wait.
 *
 * GPS itself works offline, but the assisted-positioning data that normally
 * makes it quick does not — so an indoor cold fix with no network can hang well
 * past any reasonable time to keep a person waiting at a door. The live attempt
 * is therefore capped, with the OS's last known fix as the fallback, and that
 * fallback is rejected if it is stale enough to be about somewhere else.
 *
 * @returns {Promise<{latitude, longitude, accuracy, fromCache}|null>}
 */
export const getPositionForOfflineCheck = async ({
  timeoutMs = FIX_TIMEOUT_MS,
  now = Date.now(),
} = {}) => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
  } catch {
    return null;
  }

  try {
    const live = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      timeoutMs,
    );

    if (live?.coords) {
      return {
        latitude: live.coords.latitude,
        longitude: live.coords.longitude,
        accuracy: live.coords.accuracy ?? null,
        fromCache: false,
      };
    }
  } catch {
    // Fall through to the last known fix.
  }

  try {
    const last = await Location.getLastKnownPositionAsync();
    if (!last?.coords) return null;

    const age = now - (last.timestamp ?? 0);
    if (age > STALE_FIX_MS) return null;

    return {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
      accuracy: last.coords.accuracy ?? null,
      fromCache: true,
    };
  } catch {
    return null;
  }
};

/**
 * "Which office am I nearest, and am I inside it?" — answered from the server
 * when there is one, and from the cache when there is not.
 *
 * A drop-in replacement for `getOfficeLocation` at the two places that ask the
 * question *before* a check-in rather than during it. Both were quietly fatal
 * offline:
 *
 *  - the Attendance Action screen resolves `inTarget` on mount, and a thrown
 *    network error left it false — which **disables the check-in button** under
 *    `restrict_location`, making offline attendance unreachable from the UI on
 *    exactly the tenants that most need it;
 *  - the camera screen resolves the location inline, and the throw was caught by
 *    its handler as "Check-in failed" before the queue was ever reached.
 *
 * Only transport failures fall back to the cache. A permission denial is a real
 * refusal and still propagates, because answering it from a cached location
 * would report a position the app is no longer allowed to know.
 *
 * @returns {Promise<object|null>} the nearest office in `getOfficeLocation`'s
 *          shape, plus `fromCache`, or null when it cannot be determined
 */
export const resolveNearestOffice = async (employeeCode) => {
  // Attempt whenever there is a transport, rather than trusting reachability:
  // a network whose captive-portal probe fails reports no internet for as long
  // as the device is on it, and answering from the cache there would hand the
  // check-in screen a stale office list on a perfectly working connection.
  if (await fetchShouldAttemptRequest()) {
    try {
      const nearest = await getOfficeLocation(employeeCode);
      return nearest ? { ...nearest, fromCache: false } : null;
    } catch (error) {
      if (!isOfflineFailure(error)) throw error;
    }
  }

  const config = await readAttendanceConfig();
  if (!config?.locations?.length) return null;

  const coords = await getPositionForOfflineCheck();
  if (!coords) return null;

  const nearest = findNearestLocation(coords, config.locations);
  return nearest ? { ...nearest, fromCache: true } : null;
};

/**
 * Decides whether an offline punch may be queued, and describes where it
 * happened.
 *
 * Mirrors `userCheckIn`'s rules deliberately, so a queued punch carries the same
 * location fields an online one would have:
 *  - `restrict_location !== 1` — no gate, tag with a fix if one is available.
 *  - checkout with `unrestricted_checkout_location === 1` — no gate, but tag
 *    with the live position (that flag exists precisely so remote workers can
 *    check out from wherever they are, and the log should say where).
 *  - otherwise — must be inside a configured radius.
 *
 * @param {object} options
 * @param {"IN"|"OUT"} options.type
 * @param {boolean} [options.enforceRadius] false for a geofence-driven punch —
 *        see the note below
 * @returns {Promise<{allowed: boolean, message?: string, reason?: string,
 *                    location: object|null, coords: object|null,
 *                    nearest: object|null, config: object|null}>}
 */
export const evaluateOfflineAttendance = async ({
  type,
  enforceRadius = true,
}) => {
  const config = await readAttendanceConfig();

  // Never been online: no rules were ever downloaded, so there is nothing to
  // validate against and nothing to accept. This is the one case where offline
  // attendance says no outright.
  //
  // The test is "was configuration downloaded", NOT "are there any locations in
  // it". Those are different facts and conflating them was a real bug: an
  // employee with `restrict_location = 0` has no reporting locations *by
  // design*, so their perfectly good cached configuration carries an empty
  // `locations` array — and every one of them was told to go online and
  // download a configuration they already had. Whether locations are needed is
  // decided below, by the policy, not here.
  if (!config) {
    return {
      allowed: false,
      reason: "no-config",
      message: NO_CONFIG_MESSAGE,
      location: null,
      coords: null,
      nearest: null,
      config: null,
    };
  }

  const restrictLocation = config.rules?.restrictLocation ?? 0;
  const unrestrictedCheckout = config.rules?.unrestrictedCheckoutLocation ?? 0;

  // `enforceRadius: false` is the geofence path, and it mirrors the rule
  // `autoCheckInOut` already documents for the online case: the OS transition IS
  // the location check, so re-running a within-radius test here is not a second
  // opinion, it is a contradiction. An EXIT means the device is OUTSIDE by
  // definition, so gating it would refuse every automatic check-out — the exact
  // situation (leaving the building, no signal in the car park) this feature
  // exists for. ENTER would fare little better: it would be refused whenever a
  // fresh fix could not be had indoors within the timeout, despite the OS having
  // just proven entry.
  const skipRadiusGate =
    !enforceRadius ||
    restrictLocation !== 1 ||
    (type === "OUT" && unrestrictedCheckout === 1);

  const coords = await getPositionForOfflineCheck();
  const nearest = coords
    ? findNearestLocation(coords, config.locations)
    : null;

  if (skipRadiusGate) {
    // Ungated, so a missing fix is not a blocker — it only means the log goes
    // out untagged, exactly as the online path allows.
    const location = coords
      ? {
          locationName:
            nearest?.withinRadius && nearest.locationName
              ? nearest.locationName
              : `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        }
      : null;

    const reason = !enforceRadius
      ? "geofence-verified"
      : restrictLocation !== 1
        ? "unrestricted"
        : "unrestricted-checkout";

    return { allowed: true, reason, location, coords, nearest, config };
  }

  // Gated from here down. No fix means the gate cannot be satisfied, and an
  // unverifiable punch inside a location-restricted policy is a refusal — the
  // alternative is accepting every punch whenever GPS is unavailable, which is
  // the same bypass as skipping the gate entirely.
  if (!coords) {
    return {
      allowed: false,
      reason: "no-fix",
      message:
        "Your location could not be determined. Move somewhere with a clearer signal and try again.",
      location: null,
      coords: null,
      nearest: null,
      config,
    };
  }

  if (!nearest) {
    return {
      allowed: false,
      reason: "no-usable-location",
      message: "Reporting locations are not configured",
      location: null,
      coords,
      nearest: null,
      config,
    };
  }

  if (!nearest.withinRadius) {
    return {
      allowed: false,
      reason: "out-of-radius",
      message: `You are ${nearest.distance}m away from nearest location (${nearest.locationName}). Must be within ${nearest.radius}m.`,
      location: null,
      coords,
      nearest,
      config,
    };
  }

  return {
    allowed: true,
    reason: "within-radius",
    location: {
      locationName: nearest.locationName,
      latitude: nearest.latitude,
      longitude: nearest.longitude,
      distance: nearest.distance,
      radius: nearest.radius,
    },
    coords,
    nearest,
    config,
  };
};

export default {
  evaluateOfflineAttendance,
  getPositionForOfflineCheck,
  resolveNearestOffice,
};
