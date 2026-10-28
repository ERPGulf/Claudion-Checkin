import apiClient from "../api/apiClient";
import * as Network from "./NetworkListener";
import {
  assertAttendanceQueueScope, readAttendanceQueueScope,
} from "./attendanceQueueProvenance";
import { rememberServerOffset } from "../../utils/serverClock";
import { logAttendanceDiagnostic } from "./attendanceDiagnostics";
import { classifyServerMessage } from "./attendanceErrors";

export const SERVER_TIME_METHOD = "employee_app.attendance_api.get_server_time";
// A total deadline, including interceptor/token-refresh waits. Native iOS wakes
// have a short execution budget; a health read must leave time to persist work.
export const DEFAULT_PROBE_TIMEOUT_MS = 4000;
export const AVAILABLE_TTL_MS = 3000;
export const UNAVAILABLE_TTL_MS = 1000;

let revision = 0;
let activeContext = null;
const results = new Map();
const inFlight = new Map();

/** Invalidate after an actual attendance transport failure as well as on logout. */
export const invalidateInstanceAvailability = () => {
  revision += 1;
  results.clear();
  activeContext = null;
};

// No caller-controlled URL is used: every scope must match persisted, active
// provisioning before the URL is built. Credentials are process-local cache
// keys only and are never returned or logged.
const contextKey = current => JSON.stringify([
  current.tenantKey, current.employeeId, current.accountId, current.generation, current.accessToken,
]);
const networkKey = () => {
  const state = Network.getNetworkState?.();
  return JSON.stringify([Network.getNetworkRevision?.(), state?.type, state?.isConnected]);
};

const serverTimeIsValid = value => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
};

const failure = error => {
  const httpStatus = error?.response?.status ?? null;
  if (httpStatus === 401 || httpStatus === 403) return { status: "authentication_required", failureCategory: httpStatus === 403 ? "authorization" : "authentication", httpStatus };
  if ([404, 405, 501].includes(httpStatus)) return { status: "endpoint_unsupported", failureCategory: "unsupported_endpoint", httpStatus };
  if (httpStatus === 429) return { status: "server_unavailable", failureCategory: "rate_limited", httpStatus };
  if (httpStatus >= 500) return { status: "server_unavailable", failureCategory: "http_5xx", httpStatus };
  const body = error?.response?.data;
  const reportedFailure = classifyServerMessage(body?.message ?? body?.exception ?? body?._server_messages);
  if (httpStatus && reportedFailure?.failureClass === "endpoint-missing") {
    return { status: "endpoint_unsupported", failureCategory: "unsupported_endpoint", httpStatus };
  }
  if (httpStatus) return { status: "configuration_error", failureCategory: "http_response", httpStatus };
  const categories = { ECONNABORTED: "timeout", ETIMEDOUT: "timeout", ENOTFOUND: "dns", EAI_AGAIN: "dns", ECONNREFUSED: "connection_refused" };
  return { status: "instance_unreachable", failureCategory: categories[error?.code] || "network", httpStatus };
};

const retryAfter = error => {
  const value = error?.response?.headers?.["retry-after"];
  if (value == null) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
};

const metadata = (status, startedAt, instanceId, extra = {}) => ({
  status, instanceId: instanceId ?? null, checkedAt: Date.now(),
  durationMs: Math.max(0, Date.now() - startedAt), httpStatus: null,
  failureCategory: null, cached: false, ...extra,
});

const resolveCurrent = async expected => {
  if (expected?.isCancelled?.()) return { status: "cancelled" };
  const current = await readAttendanceQueueScope();
  if (expected && (expected.generation !== current.generation || expected.tenantKey !== current.tenantKey ||
    expected.employeeId !== current.employeeId || expected.accountId !== current.accountId)) return { status: "stale_result" };
  if (!current.tenantKey || !current.employeeId) return { status: "configuration_error" };
  if (!current.authenticated) return { status: "authentication_required" };
  const { accessToken, ...scope } = current;
  await assertAttendanceQueueScope(expected ?? scope);
  return { current, scope };
};

/**
 * Read-only availability gate for the authenticated instance, never evidence
 * about whether an attendance POST committed. Cache is bounded to this identity,
 * token and network revision; failed reads live for only one second.
 */
const checkAvailability = async ({ syncScope, timeoutMs, force, attempt }) => {
  const startedAt = Date.now();
  let resolved;
  try {
    resolved = await resolveCurrent(syncScope);
  } catch {
    return metadata(syncScope?.isCancelled?.() ? "cancelled" : "stale_result", startedAt, null);
  }
  if (attempt.expired()) return metadata("instance_unreachable", startedAt, null, { failureCategory: "timeout" });
  if (resolved.status) return metadata(resolved.status, startedAt, null);
  let { current } = resolved;
  const { scope } = resolved;
  const instanceId = current.tenantKey;
  attempt.instanceId = instanceId;
  const connected = await Network.fetchShouldAttemptRequest();
  if (attempt.expired()) return metadata("instance_unreachable", startedAt, instanceId, { failureCategory: "timeout" });
  try {
    current = await assertAttendanceQueueScope(syncScope ?? scope);
  } catch {
    return metadata(syncScope?.isCancelled?.() ? "cancelled" : "stale_result", startedAt, instanceId);
  }
  if (attempt.expired()) return metadata("instance_unreachable", startedAt, instanceId, { failureCategory: "timeout" });
  const context = `${contextKey(current)}:${networkKey()}`;
  if (context !== activeContext) {
    invalidateInstanceAvailability();
    activeContext = context;
  }
  if (!connected) return metadata("device_offline", startedAt, instanceId, { failureCategory: "device_offline" });
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, DEFAULT_PROBE_TIMEOUT_MS) : DEFAULT_PROBE_TIMEOUT_MS;
  const key = `${revision}:${context}:${budget}`;
  const requestRevision = revision;
  const requestNetwork = networkKey();
  const saved = results.get(key);
  let result;
  if (!force && saved && Date.now() >= saved.result.checkedAt && Date.now() < saved.expiresAt) {
    result = { ...saved.result, cached: true };
  } else {
    let pending = inFlight.get(key);
    if (!pending) {
      const capturedRevision = revision;
      const capturedNetwork = networkKey();
      pending = (async () => {
        const probeStartedAt = Date.now();
        const controller = new AbortController();
        attempt.abort = () => controller.abort();
        const remainingMs = Math.max(1, attempt.deadline - Date.now());
        let timer;
        let answer;
        try {
          // apiClient retains its existing 401 refresh/replay rules. The race
          // bounds the caller even if that interceptor is waiting on refresh.
          const response = await Promise.race([
            apiClient.get(`${current.tenantKey}/api/method/${SERVER_TIME_METHOD}`, {
              headers: { Authorization: `Bearer ${current.accessToken}` },
              attendanceSyncScope: scope, timeout: remainingMs, signal: controller.signal,
            }),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                const error = new Error("Instance availability deadline exceeded.");
                error.code = "ETIMEDOUT";
                reject(error);
                controller.abort();
              }, remainingMs);
            }),
          ]);
          const serverTime = response.data?.message?.server_time;
          const valid = !response.data?.exc && !response.data?.exception && !response.data?.error && serverTimeIsValid(serverTime);
          answer = metadata(valid ? "available" : "configuration_error", probeStartedAt, instanceId, {
            httpStatus: response.status, failureCategory: valid ? null : "invalid_response",
            ...(valid ? { serverTime, observedAt: Date.now() } : {}),
          });
        } catch (error) {
          answer = metadata("instance_unreachable", probeStartedAt, instanceId, {
            ...failure(error), retryAfterMs: retryAfter(error),
          });
        } finally {
          clearTimeout(timer);
        }
        try {
          const latest = await assertAttendanceQueueScope(scope);
          // A successful refresh may rotate the token during this probe. The
          // result is valid now but must not populate the old token's cache.
          if (attempt.expired()) return metadata("instance_unreachable", startedAt, instanceId, { failureCategory: "timeout" });
          if (capturedRevision !== revision || capturedNetwork !== networkKey()) {
            return metadata("stale_result", probeStartedAt, instanceId, { failureCategory: "context_changed" });
          }
          if (answer.status === "available") {
            rememberServerOffset(answer.serverTime, answer.observedAt, { tenantKey: instanceId }).catch(() => {});
          }
          if (contextKey(latest) === contextKey(current)) {
            results.set(key, { result: answer, expiresAt: answer.checkedAt + (answer.status === "available" ? AVAILABLE_TTL_MS : UNAVAILABLE_TTL_MS) });
          }
          logAttendanceDiagnostic("[InstanceHealth]", answer.status, {
            ...answer, endpoint: SERVER_TIME_METHOD, timeoutMs: budget,
          });
          return answer;
        } catch {
          return metadata("stale_result", probeStartedAt, instanceId, { failureCategory: "scope_changed" });
        }
      })();
      inFlight.set(key, pending);
      attempt.releaseProbe = () => { if (inFlight.get(key) === pending) inFlight.delete(key); };
      pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
    }
    result = await pending;
  }
  try {
    const latest = await assertAttendanceQueueScope(syncScope ?? scope);
    if (requestRevision !== revision || requestNetwork !== networkKey() ||
      (result.cached && contextKey(latest) !== contextKey(current))) {
      return metadata("stale_result", startedAt, instanceId, { failureCategory: "context_changed" });
    }
  } catch {
    return metadata(syncScope?.isCancelled?.() ? "cancelled" : "stale_result", startedAt, instanceId);
  }
  if (result.cached) logAttendanceDiagnostic("[InstanceHealth]", "cached", { ...result, endpoint: SERVER_TIME_METHOD });
  return result;
};

/** Bound transport discovery, request interception/refresh and the HTTP read. */
export const checkInstanceAvailability = async ({ syncScope, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, force = false } = {}) => {
  const startedAt = Date.now();
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, DEFAULT_PROBE_TIMEOUT_MS) : DEFAULT_PROBE_TIMEOUT_MS;
  let expired = false;
  let timer;
  const attempt = { deadline: startedAt + budget, expired: () => expired || Date.now() >= startedAt + budget };
  try {
    return await Promise.race([
      checkAvailability({ syncScope, timeoutMs: budget, force, attempt }),
      new Promise(resolve => {
        timer = setTimeout(() => {
          expired = true;
          attempt.abort?.();
          attempt.releaseProbe?.();
          const answer = metadata("instance_unreachable", startedAt, attempt.instanceId, { failureCategory: "timeout" });
          logAttendanceDiagnostic("[InstanceHealth]", "deadline", answer);
          resolve(answer);
        }, budget);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
