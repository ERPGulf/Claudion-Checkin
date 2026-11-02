import { AppRegistry, Platform } from "react-native";
import { persistor, store } from "../../redux/Store";
import { selectIsLoggedIn } from "../../redux/Slices/AuthSlice";
import { setCheckin, setCheckout } from "../../redux/Slices/AttendanceSlice";
import {
  selectScopedFeatureSettings, settingsRequested, settingsReceived, settingsFailed,
} from "../../redux/Slices/FeatureSettingsSlice";
import { completeBackgroundSync, stopGeofence } from "../../modules/expo-auto-attendance";
import { getFeatureSettings } from "../api/featureSettings.service";
import { getEmployeeAutoAttendancePolicy } from "../employeeAutoAttendancePolicy";
import { presentLocalNotification } from "../notifications/localNotifications";
import { ATTENDANCE_FEATURES, buildSettingsScope, isFeatureEnabled } from "../../utils/featureSettings";
import { isSessionActive, publishCurrentSession, TRANSITION_RESULT } from "../../utils/attendanceSessionState";
import { LOCATION_ACCESS_KIND } from "../../utils/locationAccessState";
import { captureAttendanceQueueScope, readAttendanceQueueScope, assertAttendanceQueueScope } from "./attendanceQueueProvenance";
import { drainAutoAttendanceEvents, ingestPendingNativeEvents } from "./AutoAttendanceEventProcessor";
import { hasBackgroundEventWork } from "./AutoAttendanceEventRepository";
import { hasBackgroundSyncWork } from "./AttendanceQueueRepository";
import { syncPendingAttendance } from "./AttendanceSyncService";
import { readAttendanceConfig, refreshAttendanceConfig } from "./attendanceConfigCache";
import { fetchShouldAttemptRequest } from "./NetworkListener";
import { setOfflineQueueingAllowed } from "./offlineCapability";
import { recordAttendanceLifecycle } from "./attendanceDiagnostics";

export const ANDROID_ATTENDANCE_TASK = "ClaudionAttendanceSync";
// Native's 150s worker deadline leaves time for completion after this budget.
export const BACKGROUND_SYNC_BUDGET_MS = 100000;
let settingsSequence = 0;

const deadlineError = () => Object.assign(new Error("Attendance background budget exhausted."), {
  code: "ATTENDANCE_BACKGROUND_DEADLINE",
});

const awaitHydration = (cancelled) => {
  if (cancelled()) return Promise.reject(deadlineError());
  if (persistor.getState().bootstrapped) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    let timer;
    let settled = false;
    const check = () => {
      if (settled || (!cancelled() && !persistor.getState().bootstrapped)) return;
      settled = true;
      unsubscribe(); clearInterval(timer);
      if (cancelled()) reject(deadlineError());
      else resolve();
    };
    unsubscribe = persistor.subscribe(check);
    // Protected storage/slow hydration cannot strand a native worker forever.
    if (settled) unsubscribe();
    else { timer = setInterval(check, 250); check(); }
  });
};

const refreshTenantPolicy = async (scope) => {
  const settingsScope = buildSettingsScope(scope.tenantKey, scope.employeeId);
  const requestId = `background-settings-${Date.now()}-${++settingsSequence}`;
  store.dispatch(settingsRequested({ scope: settingsScope, requestId }));
  const result = await getFeatureSettings({ capabilityScope: {
    scope: settingsScope, baseUrl: scope.tenantKey, employeeCode: scope.employeeId,
    generation: scope.generation,
  } });
  await assertAttendanceQueueScope(scope);
  store.dispatch(result?.error
    ? settingsFailed({ scope: settingsScope, requestId, error: "Unable to load feature settings." })
    : settingsReceived({ scope: settingsScope, requestId, settings: result.message }));
};

const automaticRevoked = async (scope) => {
  const policy = await getEmployeeAutoAttendancePolicy(scope);
  const settings = selectScopedFeatureSettings(store.getState(), buildSettingsScope(scope.tenantKey, scope.employeeId));
  return (!!settings && !isFeatureEnabled(settings, ATTENDANCE_FEATURES.AUTO_ATTENDANCE)) ||
    ([0, 1].includes(policy?.mode) && policy.explicit !== false);
};

const publishTransition = async (scope, result, event) => {
  if (!result?.session) return;
  await publishCurrentSession({
    assertCurrent: () => assertAttendanceQueueScope(scope),
    publish: current => {
      if (isSessionActive(current)) store.dispatch(setCheckin({ checkinTime: current.startedAt,
        sessionOrigin: current.origin,
        location: current.startedAt === result.session.startedAt && current.committedAt === result.session.committedAt
          ? result.response?.location ?? null : store.getState().attendance?.location ?? null }));
      else store.dispatch(setCheckout({ checkoutTime: current.endedAt }));
    },
  });
  if (result.status === TRANSITION_RESULT.COMPLETED && result.session.closedBy === "AUTO") {
    await presentLocalNotification({
      title: result.queued ? "Checked out offline" : "Checked out",
      body: result.queued
        ? "Your automatic checkout is saved on this device. Check Attendance recovery for synchronization status."
        : event?.kind === LOCATION_ACCESS_KIND.LOST
          ? "Your automatic check-in was closed because required location access was turned off."
          : "Your check-in was closed automatically after leaving the office.",
      data: { type: "auto-checkout", pendingSync: result.queued }, requestPermission: false,
    });
  }
};

/** One bounded pass through the existing ingress/session/outbox machinery, with no UI or GPS. */
export const runAndroidAttendanceBackgroundSync = async ({ runId } = {}) => {
  const deadline = Date.now() + BACKGROUND_SYNC_BUDGET_MS;
  let expired = false;
  let timer;
  const cancelled = () => expired || Date.now() >= deadline;
  let retry = true;
  const work = async () => {
    await awaitHydration(cancelled);
    // Commit receipts before auth/policy checks; logged-out receipts retain their owner.
    await ingestPendingNativeEvents();
    if (!selectIsLoggedIn(store.getState())) return false;
    const current = await readAttendanceQueueScope();
    if (!current.authenticated || !current.employeeId || !current.tenantKey) return false;
    const scope = { ...await captureAttendanceQueueScope(current.employeeId), isCancelled: cancelled };
    await assertAttendanceQueueScope(scope);
    const connected = await fetchShouldAttemptRequest();
    recordAttendanceLifecycle("worker.network", { networkAvailable: connected });
    if (connected) {
      await refreshTenantPolicy(scope);
      await assertAttendanceQueueScope(scope);
      await refreshAttendanceConfig(scope.employeeId, { expectedGeneration: scope.generation });
      await assertAttendanceQueueScope(scope);
    }
    const settings = selectScopedFeatureSettings(store.getState(), buildSettingsScope(scope.tenantKey, scope.employeeId));
    setOfflineQueueingAllowed(isFeatureEnabled(settings, ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE));
    const policy = await getEmployeeAutoAttendancePolicy(scope);
    await assertAttendanceQueueScope(scope);
    if ((settings && !isFeatureEnabled(settings, ATTENDANCE_FEATURES.AUTO_ATTENDANCE)) ||
      ([0, 1].includes(policy?.mode) && policy.explicit !== false)) {
      // A received revocation ends monitoring even when no UI is mounted. Never
      // register, repair or request permission/location from this task.
      await stopGeofence();
      await assertAttendanceQueueScope(scope);
    }
    // Accepted outbox rows drain even if new automatic/offline attendance was revoked.
    await syncPendingAttendance({ employeeId: scope.employeeId, syncScope: scope, trigger: "android-worker" });
    await assertAttendanceQueueScope(scope);
    const config = await readAttendanceConfig();
    if (config?.tenantKey === scope.tenantKey && config.employeeId === scope.employeeId) {
      await drainAutoAttendanceEvents({ scope, onTransition: (result, event) => publishTransition(scope, result, event) });
      await assertAttendanceQueueScope(scope);
      await syncPendingAttendance({ employeeId: scope.employeeId, syncScope: scope, trigger: "android-worker-events" });
    }
    await assertAttendanceQueueScope(scope);
    // Unknown/missing configuration cannot authorize a punch, but must retain a
    // future policy/config refresh. Only a positive revocation ends that retry.
    const allowNewAttendance = !await automaticRevoked(scope);
    const [outbox, events] = await Promise.all([
      hasBackgroundSyncWork(scope), hasBackgroundEventWork(scope, { allowNewAttendance }),
    ]);
    await assertAttendanceQueueScope(scope);
    // Redux persists the refreshed authority and UI mirror too. The attendance
    // session itself was already durably written by performSessionTransition.
    await persistor.flush();
    await assertAttendanceQueueScope(scope);
    return outbox || events;
  };
  recordAttendanceLifecycle("worker.js-start", {});
  try {
    retry = await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(deadlineError()); }, BACKGROUND_SYNC_BUDGET_MS);
      }),
    ]);
  } catch (error) {
    retry = cancelled() || !["ATTENDANCE_SYNC_SCOPE_CHANGED", "CAPABILITY_SCOPE_CHANGED"].includes(error?.code);
    recordAttendanceLifecycle("worker.js-error", { reason: error?.code ?? "unexpected-error", retryable: retry });
  } finally {
    clearTimeout(timer);
    // Any continuation after the budget/result must fail its next scope boundary.
    expired = true;
    recordAttendanceLifecycle("worker.js-complete", { retryable: retry });
    try { completeBackgroundSync(runId, retry); }
    catch { /* Native's conservative timeout retains retry if completion fails. */ }
  }
  return { retry };
};

// App.js is loaded by Android's ReactHost without mounting a React root.
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask(ANDROID_ATTENDANCE_TASK, () => runAndroidAttendanceBackgroundSync);
}
