/**
 * Development-only attendance sync diagnostics.
 *
 * Request headers are never passed here, and credential-shaped keys are redacted
 * from anything that is, so a pasted Metro log cannot leak a token. Logging must
 * never be able to fail a drain, so every failure here is swallowed.
 */

const SECRET_KEY = /token|secret|password|authorization|cookie|api_key|app_key|otp|^sid$/i;

export const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, SECRET_KEY.test(key) ? "[redacted]" : redact(item)]));
};

/** Prints nested JSON expanded, which Metro otherwise collapses to `[Object]`. */
export const logAttendanceDiagnostic = (prefix, label, details) => {
  if (!__DEV__) return;
  try {
    console.log(`${prefix} ${label}\n${JSON.stringify(redact(details), null, 2)}`);
  } catch (error) {
    console.log(`${prefix} ${label} (details unprintable: ${error?.message})`);
  }
};

export const isoTime = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null);

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
