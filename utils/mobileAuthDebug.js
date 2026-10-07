/** Full, unredacted test-instance diagnostics requested for auth debugging.
 * Console output only: no file/storage writes, and disabled in release builds.
 * A logger failure must never change an authentication request's outcome.
 */
export const logMobileAuthDebug = (event, details, scope = 'mobile-auth') => {
  if (!__DEV__) return;
  try {
    const seen = new WeakSet();
    const snapshot = JSON.stringify(details, (key, value) => {
      if (typeof value === 'bigint') return String(value);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          ...Object.fromEntries(Object.getOwnPropertyNames(value).map(name => [name, value[name]])),
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
