import { Platform } from "react-native";
import {
  supportsIOSBackgroundSync, getPendingBackgroundSync, isIOSBackgroundSyncActive,
  completeIOSBackgroundSync, addBackgroundSyncRequestedListener, addBackgroundSyncExpiredListener,
} from "../../modules/expo-auto-attendance";
import { runAttendanceBackgroundSync } from "./AttendanceBackgroundSync";
import { recordAttendanceLifecycle } from "./attendanceDiagnostics";
import { noteIOSAttendanceWake } from "./BackgroundAttendanceOwnership";

// This is an application cap, never an assumed OS execution grant. Native
// expiration may happen earlier and closes the scope synchronously at source.
export const IOS_ATTENDANCE_BUDGET_MS = 20000;
export const IOS_POLICY_REFRESH_BUDGET_MS = 4000;

/** Install once before App's fonts/preferences/PersistGate, without mounting UI. */
export const registerIOSAttendanceBackgroundSync = () => {
  if (Platform.OS !== "ios" || !supportsIOSBackgroundSync()) return () => {};
  let disposed = false;
  let active = null;
  let requested = false;
  const drain = async () => {
    let pending = getPendingBackgroundSync();
    while (!disposed && pending && isIOSBackgroundSyncActive(pending.runId)) {
      const { runId, revision, deadline } = pending;
      if (typeof runId !== "string" || !Number.isSafeInteger(revision) || !Number.isFinite(deadline)) return;
      noteIOSAttendanceWake();
      const remaining = Math.max(0, deadline - Date.now());
      const { retry } = await runAttendanceBackgroundSync({
        trigger: "ios-location", budgetMs: Math.min(IOS_ATTENDANCE_BUDGET_MS, remaining),
        policyRefreshBudgetMs: Math.min(IOS_POLICY_REFRESH_BUDGET_MS, remaining / 3),
        isCancelled: () => disposed || !isIOSBackgroundSyncActive(runId),
      });
      if (disposed || !isIOSBackgroundSyncActive(runId)) return;
      // A callback captured while this pass was scanning advances revision. Its
      // receipt must get another scan before the same assertion can be released.
      const completed = completeIOSBackgroundSync(runId, revision, retry);
      pending = getPendingBackgroundSync();
      if (!completed && pending?.runId === runId && pending.revision === revision) return;
      // Retained work with an unchanged revision waits for another allowed OS
      // wake. Never spin/recreate assertions merely because a request failed.
    }
  };
  const request = () => {
    if (disposed) return;
    requested = true;
    if (active) return;
    active = (async () => {
      while (requested && !disposed) {
        requested = false;
        await drain();
      }
    })().catch(error => {
      recordAttendanceLifecycle("wake.adapter-error", { reason: error?.code ?? "unexpected-error" });
      // Keep native's pending run and original receipts. Its expiration handler
      // bounds this assertion even if a bridge/storage operation failed.
    }).finally(() => {
      active = null;
      if (requested && !disposed) request();
    });
  };
  const requestedSubscription = addBackgroundSyncRequestedListener(request);
  const expiredSubscription = addBackgroundSyncExpiredListener(() => {
    recordAttendanceLifecycle("wake.expired", {});
  });
  // Native capture may precede module evaluation or listener registration.
  request();
  return () => {
    disposed = true;
    requestedSubscription.remove();
    expiredSubscription.remove();
  };
};

registerIOSAttendanceBackgroundSync();
