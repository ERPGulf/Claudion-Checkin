// src/services/offline/attendanceErrors.js

/**
 * Decides what a failed attendance submission MEANS, which is the one judgement
 * the whole offline queue hangs on: retry it, give up on it, or quietly call it
 * done.
 *
 * Getting this wrong is expensive in both directions. Classify a validation
 * error as retryable and the queue grinds on it five times before failing —
 * five duplicate-ish writes attempted against a server that will never accept
 * it. Classify a dropped connection as terminal and a real punch is lost the
 * moment the lift doors close.
 */

/** What to do with a failure. */
export const FAILURE_KIND = {
  /** Transient — the request never reached a server that had an opinion. */
  RETRYABLE: "retryable",
  /** The server had an opinion and it was "no". Retrying repeats it. */
  TERMINAL: "terminal",
  /** The log already exists server-side. Not a failure at all — see below. */
  DUPLICATE: "duplicate",
};

/**
 * Frappe reports an existing punch as a validation error with an HTML anchor to
 * the offending doc:
 *
 *   "This employee already has a log with the same timestamp.<Br><a href=...>"
 *
 * That is precisely the state the queue is trying to reach, so it counts as
 * success. It happens routinely and is not an edge case: a check-in that timed
 * out *after* the server committed it is retried by design, and the retry is
 * what produces this. Treating it as an error would leave a permanently failed
 * row for an attendance record that exists and is correct.
 */
const DUPLICATE_PATTERNS = [
  /already has a log with the same timestamp/i,
  /duplicate\s+(?:entry|checkin|check-in|log)/i,
  /employee checkin .* already exists/i,
];

/** Axios/fetch codes that mean "never got an answer", not "got a no". */
const RETRYABLE_CODES = new Set([
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

const RETRYABLE_MESSAGE_PATTERNS = [
  /network\s*error/i,
  /timeout/i,
  /timed?\s*out/i,
  /connection (?:lost|refused|reset|aborted|closed)/i,
  /unable to resolve host/i,
  /no internet/i,
  /offline/i,
  /socket hang ?up/i,
];

/** Strips Frappe's HTML so a stored message is readable in a log or a toast. */
export const cleanServerMessage = (value) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const isDuplicateMessage = (message) => {
  const text = cleanServerMessage(message);
  if (!text) return false;
  return DUPLICATE_PATTERNS.some((pattern) => pattern.test(text));
};

/**
 * Classifies an error thrown by (or a failure returned from) an attendance
 * request.
 *
 * @param {unknown} error an axios error, a plain Error, or anything else
 * @returns {{kind: string, status: number|null, message: string}}
 */
export const classifyAttendanceError = (error) => {
  const status = Number(error?.response?.status) || null;
  const rawMessage =
    error?.response?.data?.message ??
    error?.response?.data?.exception ??
    error?.message ??
    "";
  const message = cleanServerMessage(rawMessage) || "Attendance request failed";

  if (isDuplicateMessage(rawMessage)) {
    return { kind: FAILURE_KIND.DUPLICATE, status, message };
  }

  // A status at all means a server answered, so the network is fine. 5xx is the
  // one server answer worth repeating — it says "not now", not "not ever".
  if (status) {
    return {
      kind: status >= 500 ? FAILURE_KIND.RETRYABLE : FAILURE_KIND.TERMINAL,
      status,
      message,
    };
  }

  const code = typeof error?.code === "string" ? error.code : "";
  if (RETRYABLE_CODES.has(code)) {
    return { kind: FAILURE_KIND.RETRYABLE, status, message };
  }

  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: FAILURE_KIND.RETRYABLE, status, message };
  }

  // No status and nothing that looks like a transport failure. This is the
  // ambiguous bucket — an unexpected TypeError in our own payload-building code
  // lands here, and retrying that forever is worse than surfacing it, so the
  // default is terminal. The retry cap would catch it either way; failing fast
  // just makes it visible sooner.
  return { kind: FAILURE_KIND.TERMINAL, status, message };
};

/**
 * True when a failure means "the request never landed" — the signal the
 * check-in path uses to decide between showing an error and queueing silently.
 */
export const isOfflineFailure = (error) =>
  classifyAttendanceError(error).kind === FAILURE_KIND.RETRYABLE;

export default {
  FAILURE_KIND,
  classifyAttendanceError,
  cleanServerMessage,
  isDuplicateMessage,
  isOfflineFailure,
};
