import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "../api/utils";

export const ATTENDANCE_SCOPE_CHANGED = "ATTENDANCE_SYNC_SCOPE_CHANGED";

/**
 * Stable identifier for the Frappe site that owns a queued punch.
 *
 * `cleanBaseUrl` is the application's canonical backend cleanup. Scheme and
 * authority are case-insensitive, while a possible path is not, so only the
 * former are folded here.
 */
export const normalizeAttendanceTenantKey = (rawBaseUrl) => {
  const cleaned = cleanBaseUrl(rawBaseUrl);
  if (!cleaned) return null;

  const match = cleaned.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]+)(.*)$/i);
  if (!match) return cleaned;

  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3]}`;
};

/** Reads the current queue owner directly from persisted provisioning state. */
export const readAttendanceQueueScope = async () => {
  const [rawBaseUrl, employeeId, token] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("employee_code"),
    AsyncStorage.getItem("access_token"),
  ]);

  return {
    tenantKey: normalizeAttendanceTenantKey(rawBaseUrl),
    employeeId: employeeId || null,
    authenticated: !!token,
    accessToken: token || null,
  };
};

export const createAttendanceScopeChangedError = () => {
  const error = new Error("Attendance sync stopped because the account changed.");
  error.code = ATTENDANCE_SCOPE_CHANGED;
  return error;
};

/**
 * Re-checks persisted identity at an await boundary. Access-token rotation is
 * allowed; backend and employee identity are not.
 */
export const assertAttendanceQueueScope = async (expected) => {
  const current = await readAttendanceQueueScope();
  const valid =
    !!expected?.tenantKey &&
    !!expected?.employeeId &&
    current.authenticated &&
    current.tenantKey === expected.tenantKey &&
    current.employeeId === expected.employeeId;

  if (!valid) throw createAttendanceScopeChangedError();
  return current;
};

export default {
  ATTENDANCE_SCOPE_CHANGED,
  assertAttendanceQueueScope,
  normalizeAttendanceTenantKey,
  readAttendanceQueueScope,
};
