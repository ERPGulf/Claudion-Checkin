// Raw payloads and native error messages can contain secrets even when their
// property names do not. Omit them rather than trying to redact free text.
const PRIVATE_FIELDS = new Set([
  'accesstoken', 'refreshtoken', 'mastertoken', 'masteraccesstoken', 'masterrefreshtoken',
  'token', 'password', 'newpassword', 'confirmpassword', 'managedpassword', 'otp',
  'authorization', 'cookie', 'setcookie', 'apikey', 'appkey', 'apisecret',
  'credentials', 'previouscredentials', 'body', 'rawbody', 'form', 'headers', 'data',
  'stack', 'exception', 'traceback',
]);

/** Identifier, policy, timing and failure-stage diagnostics.
 * Console output only: no file/storage writes, and disabled in release builds.
 * A logger failure must never change an authentication request's outcome.
 */
export const logMobileAuthDebug = (event, details, scope = 'mobile-auth') => {
  if (!__DEV__) return;
  try {
    const seen = new WeakSet();
    const snapshot = JSON.stringify(details, (key, value) => {
      if (PRIVATE_FIELDS.has(key.replace(/[_-]/g, '').toLowerCase())) return '[Omitted]';
      if ((key === 'message' || key === 'error') && typeof value === 'string') return '[Omitted]';
      if (typeof value === 'bigint') return String(value);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          code: value.code,
          httpStatus: value.httpStatus,
          retryable: value.retryable,
        };
      }
      return value;
    });
    console.log(`[${scope}] ${event}`, snapshot);
  } catch {
    // Debugging must not break the flow (including circular native errors).
  }
};

export const debugHeaders = headers => {
  try {
    return typeof headers?.entries === 'function' ? Object.fromEntries(headers.entries()) : headers;
  } catch {
    return undefined;
  }
};
