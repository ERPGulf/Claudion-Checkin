import AsyncStorage from "@react-native-async-storage/async-storage";
import { cleanBaseUrl } from "../api/utils";
import { getAuthSessionGeneration, isAuthSessionSuspended } from "../../utils/authSessionGuard";

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

  try {
    const url = new URL(cleaned);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return cleanBaseUrl(`${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}`);
  } catch {
    return null;
  }
};

/** Reads the current queue owner directly from persisted provisioning state. */
export const readAttendanceQueueScope = async () => {
  const generation = getAuthSessionGeneration();
  const [rawBaseUrl, employeeId, token, accountId] = await Promise.all([
    AsyncStorage.getItem("baseUrl"),
    AsyncStorage.getItem("employee_code"),
    AsyncStorage.getItem("access_token"),
    AsyncStorage.getItem("api_key"),
  ]);

  if (generation !== getAuthSessionGeneration()) throw createAttendanceScopeChangedError();

  return {
    tenantKey: normalizeAttendanceTenantKey(rawBaseUrl),
    employeeId: employeeId || null,
    authenticated: !!token && !isAuthSessionSuspended(),
    generation,
    accountId,
    accessToken: token || null,
  };
};

export const createAttendanceScopeChangedError = () => {
  const error = new Error("Attendance sync stopped because the account changed.");
  error.code = ATTENDANCE_SCOPE_CHANGED;
  return error;
};

export const assertAttendanceSessionCurrent = (expected) => {
  if (expected?.generation !== getAuthSessionGeneration() || isAuthSessionSuspended() || expected?.isCancelled?.()) {
    throw createAttendanceScopeChangedError();
  }
};

/**
 * Re-checks persisted identity at an await boundary. Access-token rotation is
 * allowed; backend and employee identity are not.
 */
export const assertAttendanceQueueScope = async (expected) => {
  const current = await readAttendanceQueueScope();
  assertAttendanceSessionCurrent(expected);
  const valid =
    !!expected?.tenantKey &&
    !expected?.isCancelled?.() &&
    !!expected?.employeeId &&
    current.authenticated &&
    current.generation === expected.generation &&
    current.accountId === expected.accountId &&
    current.tenantKey === expected.tenantKey &&
    current.employeeId === expected.employeeId;

  if (!valid) throw createAttendanceScopeChangedError();
  return current;
};

/** No credentials are retained in a drain or its public report. */
export const captureAttendanceQueueScope = async (employeeId) => {
  const { accessToken, ...scope } = await readAttendanceQueueScope();
  if (!employeeId || employeeId !== scope.employeeId || !scope.tenantKey || !scope.authenticated) {
    throw createAttendanceScopeChangedError();
  }
  return scope;
};

export default {
  ATTENDANCE_SCOPE_CHANGED,
  assertAttendanceQueueScope,
  normalizeAttendanceTenantKey,
  readAttendanceQueueScope,
};
