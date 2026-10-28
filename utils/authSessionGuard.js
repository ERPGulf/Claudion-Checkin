// Process-local invalidation complements persisted account/tenant checks. A
// logout followed by login to the SAME account must still stop the old run.
let generation = 0;
let suspended = false;
const invalidationListeners = new Set();

/** Run before callers start asynchronous logout or provisioning work. */
export const addAuthSessionInvalidationListener = (listener) => {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
};

export const getAuthSessionGeneration = () => generation;
export const isAuthSessionSuspended = () => suspended;
export const invalidateAuthSession = () => {
  suspended = true;
  generation += 1;
  invalidationListeners.forEach((listener) => {
    try {
      // Invalidation must finish even if optional cleanup fails. Synchronous
      // listeners still run before this function returns; async errors are
      // observed without holding up the authentication boundary.
      Promise.resolve(listener(generation)).catch(() => {});
    } catch {
      // A failed listener cannot leave the previous session current.
    }
  });
  return generation;
};
export const activateAuthSession = (expectedGeneration) => {
  if (expectedGeneration === generation) suspended = false;
};
