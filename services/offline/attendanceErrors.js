// src/services/offline/attendanceErrors.js
import { FAILURE_CLASS } from "./AttendanceDatabase";

/**
 * Decides what a failed attendance submission MEANS.
 *
 * This is the single most consequential function in the offline queue, because
 * every other behaviour follows from its answer, and the two ways of being wrong
 * are not symmetric:
 *
 *  - calling a permanent rejection "retryable" costs some pointless requests;
 *  - calling a recoverable failure "rejected" **abandons a payroll record**.
 *
 * So the bias is explicit and one-directional: **anything not positively
 * identified as a validation failure is BLOCKED, never REJECTED.** Blocked
 * records are kept forever and retried on a slow schedule, so a
 * misclassification costs a background request every few hours and self-corrects
 * the moment the server can accept the record. A wrong REJECTED cannot
 * self-correct — it needs a human to notice and file a correction.
 *
 * ## Why the HTTP status is not enough
 *
 * Frappe answers 417 for *every* `ValidationError`, which covers unrelated
 * conditions with opposite correct handling:
 *
 *   417  "…module 'employee_app.attendance_api' has no attribute
 *         'add_offline_employee_checkins'"          → BLOCKED (not deployed yet)
 *   417  "Employee is inactive"                     → REJECTED (never valid)
 *   417  "…already has a log with the same timestamp" → DUPLICATE (success)
 *
 * All three arrive with the same status and the same exception class. Only the
 * message separates them, so classification is message-first and status-second.
 * That is fragile against Frappe wording changes — which is precisely why the
 * fallback is BLOCKED: if a pattern stops matching, records queue up visibly and
 * keep retrying instead of quietly disappearing.
 */

/** What the queue should do with a failure. */
export const FAILURE_KIND = {
  /** Transient. Retry on the normal ladder. */
  PENDING: "pending",
  /** The server cannot accept it *yet*. Keep forever, retry slowly. */
  BLOCKED: "blocked",
  /** The server will never accept it. Keep, stop retrying, offer correction. */
  REJECTED: "rejected",
  /** Already recorded server-side. Not a failure at all. */
  DUPLICATE: "duplicate",
};

/**
 * Frappe reports an existing punch as a validation error with an HTML anchor to
 * the offending doc. It happens routinely and is not an edge case: a check-in
 * that timed out *after* the server committed it is retried by design, and the
 * retry is what produces this. It is the state the queue was trying to reach.
 */
const DUPLICATE_PATTERNS = [
  /already has a log with the same timestamp/i,
  /duplicate\s+(?:entry|checkin|check-in|log)/i,
  /employee checkin .* already exists/i,
];

/**
 * The endpoint is not on this server.
 *
 * Observed verbatim on a tenant without the offline API deployed:
 *   "frappe.exceptions.ValidationError: Failed to get method for command
 *    employee_app.attendance_api.add_offline_employee_checkins with module
 *    'employee_app.attendance_api' has no attribute
 *    'add_offline_employee_checkins'"
 *
 * Recoverable without any client change — someone deploys, and the queue drains
 * itself. Exactly the case that must never be discarded.
 */
const ENDPOINT_MISSING_PATTERNS = [
  /failed to get method for command/i,
  /has no attribute/i,
  /module .* not found/i,
  /method .* (?:does not exist|not found|is not whitelisted)/i,
  /not whitelisted/i,
  /invalid method/i,
  /unknown command/i,
];

/** Credentials failed, but a token refresh or re-login may fix it. */
const AUTH_PATTERNS = [
  /authentication/i,
  /not permitted/i,
  /permission denied/i,
  /insufficient permission/i,
  /invalid token/i,
  /token (?:expired|invalid)/i,
  /session (?:expired|stopped)/i,
  /please login/i,
  /unauthorized/i,
  /forbidden/i,
];

/** Server-side setup is incomplete. Fixable by an administrator, not the user. */
const CONFIGURATION_PATTERNS = [
  /not configured/i,
  /no default .* set/i,
  /missing (?:configuration|setting|naming series)/i,
  /naming series/i,
  /please set .* in (?:hr settings|settings)/i,
];

/**
 * Positively-identified validation failures — the ONLY route to REJECTED.
 *
 * Deliberately narrow. Anything not on this list is blocked and keeps trying, so
 * a missing pattern costs background requests, never a lost record. Add to it
 * only when a message is confirmed to be permanently invalid for a punch that
 * has already happened.
 */
const VALIDATION_PATTERNS = [
  /employee .* (?:is )?(?:inactive|left|relieved|disabled)/i,
  /inactive employee/i,
  /no employee found/i,
  /employee .* does not exist/i,
  /invalid employee/i,
  /cannot create .* for (?:inactive|left) employee/i,
  /future date/i,
  /cannot be in the future/i,
  /invalid (?:log ?type|timestamp|date|time|payload)/i,
  /mandatory field/i,
  /is required/i,
];

/** Codes that mean "never got an answer", not "got a no". */
const PENDING_CODES = new Set([
  "ECONNABORTED", // axios timeout
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EAI_AGAIN", // DNS temporary failure
  "ERR_NETWORK",
  "ERR_CANCELED",
]);

const PENDING_MESSAGE_PATTERNS = [
  /network\s*error/i,
  /timeout/i,
  /timed?\s*out/i,
  /connection (?:lost|refused|reset|aborted|closed)/i,
  /unable to resolve host/i,
  /no internet/i,
  /offline/i,
  /socket hang ?up/i,
];

/** Strips Frappe's HTML so a stored message is readable in a log or a sheet. */
export const cleanServerMessage = (value) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const matches = (patterns, text) => patterns.some((p) => p.test(text));

export const isDuplicateMessage = (message) => {
  const text = cleanServerMessage(message);
  return text ? matches(DUPLICATE_PATTERNS, text) : false;
};

/**
 * Reads a server message into a kind and a failure class.
 *
 * Order matters and encodes the bias: duplicate first (it is success), then the
 * three recoverable classes, then — last and only on a positive match —
 * validation. Anything unmatched falls through to the caller's default, which is
 * always BLOCKED.
 *
 * @returns {{kind: string, failureClass: string}|null} null when nothing matched
 */
export const classifyServerMessage = (message) => {
  const text = cleanServerMessage(message);
  if (!text) return null;

  if (matches(DUPLICATE_PATTERNS, text)) {
    return { kind: FAILURE_KIND.DUPLICATE, failureClass: null };
  }

  if (matches(ENDPOINT_MISSING_PATTERNS, text)) {
    return {
      kind: FAILURE_KIND.BLOCKED,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
    };
  }

  if (matches(AUTH_PATTERNS, text)) {
    return { kind: FAILURE_KIND.BLOCKED, failureClass: FAILURE_CLASS.AUTH };
  }

  if (matches(CONFIGURATION_PATTERNS, text)) {
    return {
      kind: FAILURE_KIND.BLOCKED,
      failureClass: FAILURE_CLASS.CONFIGURATION,
    };
  }

  if (matches(VALIDATION_PATTERNS, text)) {
    return {
      kind: FAILURE_KIND.REJECTED,
      failureClass: FAILURE_CLASS.VALIDATION,
    };
  }

  return null;
};

/**
 * Classifies an error thrown by (or a failure returned from) an attendance
 * request.
 *
 * @param {unknown} error an axios error, a plain Error, or anything else
 * @returns {{kind: string, failureClass: string|null, status: number|null,
 *            message: string}}
 */
export const classifyAttendanceError = (error) => {
  const status = Number(error?.response?.status) || null;
  const rawMessage =
    error?.response?.data?.message ??
    error?.response?.data?.exception ??
    error?.response?.data?._server_messages ??
    error?.message ??
    "";
  const message = cleanServerMessage(rawMessage) || "Attendance request failed";

  const fromMessage = classifyServerMessage(rawMessage);
  if (fromMessage) return { ...fromMessage, status, message };

  // A status at all means a server answered, so the transport is fine.
  if (status) {
    // 5xx says "not now", not "not ever" — ordinary retry.
    if (status >= 500) {
      return { kind: FAILURE_KIND.PENDING, failureClass: null, status, message };
    }

    // 401/403 with no recognisable message: still treated as recoverable, since
    // the token refresh interceptor may well fix it before the next attempt.
    if (status === 401 || status === 403) {
      return {
        kind: FAILURE_KIND.BLOCKED,
        failureClass: FAILURE_CLASS.AUTH,
        status,
        message,
      };
    }

    // Every other 4xx, including an unrecognised 417. Blocked, never rejected —
    // this is the fallback the whole design leans on.
    return {
      kind: FAILURE_KIND.BLOCKED,
      failureClass: FAILURE_CLASS.UNKNOWN,
      status,
      message,
    };
  }

  const code = typeof error?.code === "string" ? error.code : "";
  if (PENDING_CODES.has(code) || matches(PENDING_MESSAGE_PATTERNS, message)) {
    return { kind: FAILURE_KIND.PENDING, failureClass: null, status, message };
  }

  // No status and nothing that looks like a transport failure — an unexpected
  // local error, say a TypeError while building the payload. Blocked rather than
  // rejected: a bug in our own code must not consume someone's attendance.
  return {
    kind: FAILURE_KIND.BLOCKED,
    failureClass: FAILURE_CLASS.UNKNOWN,
    status,
    message,
  };
};

/**
 * True when a failure means "the request never landed" — the signal the
 * check-in path uses to decide between showing an error and queueing silently.
 */
export const isOfflineFailure = (error) =>
  classifyAttendanceError(error).kind === FAILURE_KIND.PENDING;

export default {
  FAILURE_KIND,
  classifyAttendanceError,
  classifyServerMessage,
  cleanServerMessage,
  isDuplicateMessage,
  isOfflineFailure,
};
