/**
 * Development-only attendance sync diagnostics.
 *
 * Do not serialize request/response bodies, employee identity, location fixes or
 * free-form errors, even in development. They may include credentials or HR
 * data without credential-shaped keys. Logging must never fail a drain.
 */

const SECRET_KEY = /token|secret|password|authorization|cookie|api_key|app_key|otp|^sid$/i;
const PRIVATE_KEY = /^(?:employee(?:Id|Code|Docname|_id|_code|_name)?|tenantKey|instanceId|accountId|scope|latitude|longitude|location(?:s|Name)?|address|photoUri|payload|body|responseData|serverResponse|backendReturned|expected|evidence|verificationEvidence|serverCheckinId|serverRecord|error|lastError|message|duplicateMessage|reason)$/i;
// These reasons are application-owned run/availability enums. Other reason
// values can come from a saved server error, so do not print them verbatim.
const SAFE_REASONS = new Set([
  "offline", "nothing-due", "scope-changed", "no-employee", "blocked", "sync-error",
  "connection-lost", "needs-review", "claim-changed", "another-session-syncing",
  "device_offline", "instance_unreachable", "server_unavailable", "authentication_required",
  "endpoint_unsupported", "configuration_error", "available", "stale_result", "cancelled",
]);

export const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === "reason" && (item == null || SAFE_REASONS.has(item)) ? item
      : SECRET_KEY.test(key) || PRIVATE_KEY.test(key) ? "[redacted]" : redact(item)]));
};

/** Prints nested JSON expanded, which Metro otherwise collapses to `[Object]`. */
export const logAttendanceDiagnostic = (prefix, label, details) => {
  if (!__DEV__) return;
  try {
    console.log(`${prefix} ${label}\n${JSON.stringify(redact(details), null, 2)}`);
  } catch (error) {
    console.log(`${prefix} ${label} (details unprintable)`);
  }
};

export const isoTime = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);

// Persistent Android diagnostics contain lifecycle metadata only. Never pass
// payloads, server messages, employee/tenant identifiers or location fixes here.
const LIFECYCLE_FIELDS = new Set([
  "timestamp", "occurredAt", "queueRowId", "status", "httpStatus", "retry", "retryable",
  "attempt", "attemptAt", "nextAttemptAt", "durationMs", "networkAvailable",
  "serverReachable", "appState", "count", "reason",
]);
export const recordAttendanceLifecycle = (stage, details = {}) => {
  if (!__DEV__) return;
  try {
    const safe = Object.fromEntries(Object.entries(details).filter(([key, value]) =>
      LIFECYCLE_FIELDS.has(key) && (value == null || typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)))));
    // Native event IDs are UUIDs. Legacy IDs can embed identifiers and are
    // deliberately excluded from this privacy-limited journal.
    const eventId = /^[a-f0-9-]{36}$/i.test(details.eventId ?? "") ? details.eventId : "";
    logAttendanceDiagnostic("[AttendanceLifecycle]", stage, { eventId, ...safe });
    require("../../modules/expo-auto-attendance").recordBackgroundSyncDiagnostic?.(stage, eventId, safe);
  } catch {
    // Instrumentation cannot change attendance outcomes or acknowledgement.
  }
};

/**
 * What an Axios failure actually proves. Without an HTTP response nothing is
 * invented: the body is reported as NO_HTTP_RESPONSE, and a dispatched request
 * with no answer is an ambiguous outcome — the server may or may not have run it.
 */
export const describeHttpFailure = (error) => {
  const status = error?.response?.status ?? null;
  const timedOut = ["ECONNABORTED", "ETIMEDOUT"].includes(error?.code) || /timeout/i.test(error?.message ?? "");
  let failureType;
  if (error?.response) failureType = status >= 500 ? "HTTP_5XX" : status >= 400 ? "HTTP_4XX" : `HTTP_${status}`;
  else if (timedOut) failureType = "TIMEOUT";
  else if (error?.request || error?.code === "ERR_NETWORK" || error?.message === "Network Error") failureType = "CONNECTION_FAILURE";
  else failureType = "FAILED_BEFORE_TRANSPORT";
  return {
    message: error?.message ?? null,
    code: error?.code ?? null,
    status,
    responseData: error?.response ? (error.response.data ?? null) : "NO_HTTP_RESPONSE",
    requestExists: !!error?.request,
    httpResponseReceived: !!error?.response,
    failureType,
    ambiguousOutcome: failureType === "TIMEOUT" || failureType === "CONNECTION_FAILURE" || failureType === "HTTP_5XX",
  };
};
