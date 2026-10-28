import { QueryClient } from "@tanstack/react-query";
import { addAuthSessionInvalidationListener } from "../utils/authSessionGuard";

// The provider outlives both authenticated and signed-out navigation trees.
// Employee codes can repeat across tenants, so its cache cannot outlive the
// authentication generation even when a query uses the same domain/code key.
export const queryClient = new QueryClient();

addAuthSessionInvalidationListener(() => {
  // clear() synchronously destroys queries (cancelling their fetch/retryers)
  // and removes mutations. A late response belongs to a detached old query,
  // never a newly created query with the same key. Existing attendance/session
  // guards still own in-flight mutation effects; clearing cannot undo a POST.
  queryClient.clear();
});
