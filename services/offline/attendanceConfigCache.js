// src/services/offline/attendanceConfigCache.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchEmployeeData } from "../api/employee.service";

/**
 * The attendance rules, kept on the device so a check-in can be validated with
 * no network at all.
 *
 * Everything needed to decide "may this punch happen, and where did it happen?"
 * is downloaded while online and stored as one blob: the employee's identifiers,
 * the reporting locations with their radii, and the company policy flags. The
 * offline gate reads this and nothing else — it must never reach for the
 * network, because the whole point is that there isn't one.
 *
 * Two rules govern the cache:
 *
 *  - **Replace only on success.** A refresh that fails leaves the previous
 *    configuration exactly as it was. A half-written or emptied cache is worse
 *    than a stale one: stale locations are last week's offices, an empty cache
 *    is no offices at all, and the gate would refuse every punch.
 *
 *  - **No cache means no offline attendance.** A device that has never been
 *    online since install has no idea where the offices are, so it cannot
 *    validate anything. It says so, rather than queueing punches it has no basis
 *    to accept.
 */

export const CONFIG_KEY = "attendanceConfigCache";

/** Shown when the device has never completed a configuration download. */
export const NO_CONFIG_MESSAGE =
  "Offline attendance is unavailable until attendance configuration has been downloaded at least once while connected to the internet.";

/**
 * How old a cache may be before a refresh is worth attempting on launch. Not an
 * expiry — an out-of-date cache is still used, and used forever if that is all
 * there is. This only decides when to spend a request.
 */
export const CONFIG_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * The Employee docname, which is NOT the same value as the employee code the
 * app scans from the QR.
 *
 * The online endpoint (`add_log_based_on_employee_field`) takes
 * `employee_field_value` and resolves it server-side, so the app has never
 * needed the docname. The bulk offline endpoint takes `employee` directly. Which
 * field carries the docname varies by tenant and by how the naming series is
 * configured — on some sites the docname IS the employee number — so every
 * plausible field is tried and the value is stored alongside, never instead of,
 * the code. `AttendanceApi` sends the docname when it has one and falls back to
 * the code when it does not.
 */
const resolveEmployeeDocname = (employee) => {
  const candidates = [
    employee?.name,
    employee?.employee,
    employee?.employee_name_id,
    employee?.employee_id,
  ];

  const found = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );

  return found ? found.trim() : null;
};

/**
 * Normalises a `get_employee_data` response into the cached shape.
 *
 * Exported for the tests, and because the shape is the contract every consumer
 * reads — it is easier to keep honest in one function than across the readers.
 */
export const buildConfig = (employee, { employeeId, now = Date.now() }) => {
  const locations = Array.isArray(employee?.employee_locations)
    ? employee.employee_locations
    : [];

  return {
    employeeId,
    employeeDocname: resolveEmployeeDocname(employee),
    employeeName: employee?.employee_name ?? null,

    /** Raw `employee_locations` rows — coordinates are resolved on read by
     *  utils/attendanceLocations.js, so both gates parse them identically. */
    locations,

    rules: {
      restrictLocation: toNumber(employee?.restrict_location),
      unrestrictedCheckoutLocation: toNumber(
        employee?.unrestricted_checkout_location,
      ),
      photo: toNumber(employee?.photo),
      geotagging: toNumber(employee?.geotagging),
    },

    lastUpdated: now,
  };
};

/**
 * The legacy per-key mirror.
 *
 * `getOfficeLocation` has always written these five keys, and plenty of code
 * still reads them directly (`useAttendanceAction`, `AttendanceCamera`,
 * `userCheckIn` itself). Writing them here too means a background config refresh
 * keeps those readers current instead of leaving them on whatever the last
 * GPS-taking call happened to store — same values, same keys, just refreshed
 * more often.
 */
const mirrorLegacyKeys = async (config) => {
  await AsyncStorage.multiSet([
    ["restrict_location", String(config.rules.restrictLocation)],
    [
      "unrestricted_checkout_location",
      String(config.rules.unrestrictedCheckoutLocation),
    ],
    ["photo", String(config.rules.photo)],
    ["geotagging", String(config.rules.geotagging)],
    ["employee_locations", JSON.stringify(config.locations)],
  ]);
};

/** The cached configuration, or null when nothing has ever been downloaded. */
export const readAttendanceConfig = async () => {
  try {
    const stored = await AsyncStorage.getItem(CONFIG_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    // A blob without locations cannot answer the only question it exists to
    // answer, so it is treated as absent rather than as an empty office list.
    if (!parsed || !Array.isArray(parsed.locations)) return null;

    return parsed;
  } catch {
    return null;
  }
};

/**
 * Whether configuration has ever been downloaded — the precondition for offline
 * attendance.
 *
 * Deliberately NOT "are there locations". An employee with
 * `restrict_location = 0` has none by design, and their configuration is
 * complete without them; whether locations are *required* is a policy question
 * the gate answers, not a completeness question this answers.
 */
export const hasAttendanceConfig = async () => !!(await readAttendanceConfig());

/**
 * Downloads the configuration and replaces the cache — but only if the download
 * succeeds.
 *
 * Safe to call speculatively (launch, focus, reconnect, pull-to-refresh): it
 * never throws and never damages an existing cache. The boolean says whether
 * anything changed, not whether the caller should worry.
 *
 * @returns {Promise<{refreshed: boolean, config: object|null, error?: string}>}
 */
export const refreshAttendanceConfig = async (employeeId) => {
  const logPrefix = "[attendanceConfigCache/refresh]";

  if (!employeeId) {
    return { refreshed: false, config: await readAttendanceConfig() };
  }

  try {
    const employee = await fetchEmployeeData(employeeId);
    const config = buildConfig(employee, { employeeId });

    // An empty location list from a *successful* request is ambiguous: it can
    // mean "this employee has no reporting locations" or it can mean the server
    // returned a partial record. Either way, overwriting a good cache with it
    // would silently disable offline attendance, so the previous cache wins.
    if (!config.locations.length) {
      const existing = await readAttendanceConfig();
      if (existing?.locations?.length) {
        console.log(`${logPrefix} Empty location list; keeping cached config`);
        return {
          refreshed: false,
          config: existing,
          error: "No reporting locations returned",
        };
      }
    }

    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    await mirrorLegacyKeys(config);

    console.log(`${logPrefix} Cached`, {
      employeeId,
      locations: config.locations.length,
      restrictLocation: config.rules.restrictLocation,
    });

    return { refreshed: true, config };
  } catch (error) {
    console.log(`${logPrefix} Failed, keeping previous cache:`, error?.message);
    return {
      refreshed: false,
      config: await readAttendanceConfig(),
      error: error?.message || "Configuration refresh failed",
    };
  }
};

/**
 * Refreshes only if the cache is missing or older than `CONFIG_STALE_AFTER_MS`.
 * Used by the launch and foreground hooks, which fire often and should not spend
 * a request each time.
 */
export const refreshAttendanceConfigIfStale = async (
  employeeId,
  { now = Date.now(), maxAgeMs = CONFIG_STALE_AFTER_MS } = {},
) => {
  const existing = await readAttendanceConfig();
  const age = existing?.lastUpdated ? now - existing.lastUpdated : Infinity;

  if (existing?.locations?.length && age < maxAgeMs) {
    return { refreshed: false, config: existing };
  }

  return refreshAttendanceConfig(employeeId);
};

/** Drops the cache. Logout only — the next user's rules are not this one's. */
export const clearAttendanceConfig = async () => {
  await AsyncStorage.removeItem(CONFIG_KEY);
};

export default {
  CONFIG_KEY,
  CONFIG_STALE_AFTER_MS,
  NO_CONFIG_MESSAGE,
  buildConfig,
  clearAttendanceConfig,
  hasAttendanceConfig,
  readAttendanceConfig,
  refreshAttendanceConfig,
  refreshAttendanceConfigIfStale,
};
