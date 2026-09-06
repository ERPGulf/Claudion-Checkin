// Process-local invalidation complements persisted account/tenant checks. A
// logout followed by login to the SAME account must still stop the old run.
let generation = 0;
let suspended = false;

export const getAuthSessionGeneration = () => generation;
export const isAuthSessionSuspended = () => suspended;
export const invalidateAuthSession = () => {
  suspended = true;
  return ++generation;
};
export const activateAuthSession = (expectedGeneration) => {
  if (expectedGeneration === generation) suspended = false;
};
