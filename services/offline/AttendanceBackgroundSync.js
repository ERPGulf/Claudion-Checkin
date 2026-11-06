import { persistor, store } from "../../redux/Store";
import { selectIsLoggedIn } from "../../redux/Slices/AuthSlice";
import { setCheckin, setCheckout } from "../../redux/Slices/AttendanceSlice";
import {
  selectScopedFeatureSettings, settingsRequested, settingsReceived, settingsFailed,
} from "../../redux/Slices/FeatureSettingsSlice";
import { stopGeofence } from "../../modules/expo-auto-attendance";
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

let settingsSequence = 0;
const deadlineError = () => Object.assign(new Error("Attendance background execution ended."), {
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
      unsubscribe();
      clearInterval(timer);
      if (cancelled()) reject(deadlineError());
      else resolve();
    };
    unsubscribe = persistor.subscribe(check);
    if (settled) unsubscribe();
    else { timer = setInterval(check, 250); check(); }
  });
};

const refreshTenantPolicy = async (scope, onPending = () => {}) => {
  const settingsScope = buildSettingsScope(scope.tenantKey, scope.employeeId);
  const requestId = `background-settings-${Date.now()}-${++settingsSequence}`;
  store.dispatch(settingsRequested({ scope: settingsScope, requestId }));
  const failed = () => store.dispatch(settingsFailed({
    scope: settingsScope, requestId, error: "Unable to load feature settings.",
  }));
  onPending(failed);
  const result = await getFeatureSettings({ syncScope: scope, capabilityScope: {
    scope: settingsScope, baseUrl: scope.tenantKey, employeeCode: scope.employeeId,
    generation: scope.generation,
  } });
  await assertAttendanceQueueScope(scope);
  store.dispatch(result?.error
    ? settingsFailed({ scope: settingsScope, requestId, error: "Unable to load feature settings." })
    : settingsReceived({ scope: settingsScope, requestId, settings: result.message }));
  onPending(null);
};

const refreshPolicy = async (scope, budgetMs, prefix) => {
  let refreshExpired = false;
  let timer;
  let pendingSettingsFailure;
  const refreshScope = Number.isFinite(budgetMs)
    ? { ...scope, isCancelled: () => refreshExpired || scope.isCancelled() } : scope;
  const refresh = async () => {
    await refreshTenantPolicy(refreshScope, failure => { pendingSettingsFailure = failure; });
    await assertAttendanceQueueScope(refreshScope);
    await refreshAttendanceConfig(scope.employeeId, { expectedGeneration: scope.generation, syncScope: refreshScope });
    await assertAttendanceQueueScope(refreshScope);
  };
  try {
    if (!Number.isFinite(budgetMs)) await refresh();
    else await Promise.race([
      refresh(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          refreshExpired = true;
          reject(Object.assign(new Error("Background policy refresh timed out."), {
            code: "ATTENDANCE_BACKGROUND_POLICY_TIMEOUT",
          }));
        }, Math.max(0, budgetMs));
      }),
    ]);
  } catch (error) {
    if (error?.code !== "ATTENDANCE_BACKGROUND_POLICY_TIMEOUT") throw error;
    await assertAttendanceQueueScope(scope);
    pendingSettingsFailure?.();
    // Failed reads keep the established scoped cache, just like offline and
    // ordinary failed refreshes. Missing authority still cannot admit a punch.
    recordAttendanceLifecycle(`${prefix}.policy-timeout`, { retryable: true });
  } finally {
    clearTimeout(timer);
    refreshExpired = true;
  }
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
  await assertAttendanceQueueScope(scope);
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

/** Shared bounded wake pass. Native scheduling owns the lifetime, never the queue. */
export const runAttendanceBackgroundSync = async ({
  trigger = "android-worker", budgetMs = 100000, isCancelled = () => false, policyRefreshBudgetMs,
} = {}) => {
  const budget = Number.isFinite(budgetMs) ? Math.max(0, Math.min(budgetMs, 100000)) : 0;
  const deadline = Date.now() + budget;
  const prefix = trigger === "android-worker" ? "worker" : "wake";
  let expired = false;
  let timer;
  let cancellationTimer;
  const cancelled = () => expired || Date.now() >= deadline || isCancelled();
  const assertRunning = () => { if (cancelled()) throw deadlineError(); };
  let retry = true;
  const work = async () => {
    assertRunning();
    // Transfer evidence without waiting for UI resources, login, or policy.
    // Ingress is idempotent and acknowledges native only after SQLite commits.
    await ingestPendingNativeEvents();
    assertRunning();
    await awaitHydration(cancelled);
    assertRunning();
    recordAttendanceLifecycle(`${prefix}.hydrated`, {});
    if (!selectIsLoggedIn(store.getState())) return false;
    const current = await readAttendanceQueueScope();
    assertRunning();
    if (!current.authenticated || !current.employeeId || !current.tenantKey) return false;
    const scope = { ...await captureAttendanceQueueScope(current.employeeId), isCancelled: cancelled };
    await assertAttendanceQueueScope(scope);
    // Existing accepted punches need no new-admission policy. A slow policy
    // refresh must not consume a short wake before those records are attempted.
    await syncPendingAttendance({ employeeId: scope.employeeId, syncScope: scope, trigger });
    await assertAttendanceQueueScope(scope);
    const connected = await fetchShouldAttemptRequest();
    await assertAttendanceQueueScope(scope);
    recordAttendanceLifecycle(`${prefix}.network`, { networkAvailable: connected });
    if (connected) {
      await refreshPolicy(scope, policyRefreshBudgetMs, prefix);
      await assertAttendanceQueueScope(scope);
    }
    const settings = selectScopedFeatureSettings(store.getState(), buildSettingsScope(scope.tenantKey, scope.employeeId));
    setOfflineQueueingAllowed(isFeatureEnabled(settings, ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE));
    const policy = await getEmployeeAutoAttendancePolicy(scope);
    await assertAttendanceQueueScope(scope);
    if ((settings && !isFeatureEnabled(settings, ATTENDANCE_FEATURES.AUTO_ATTENDANCE)) ||
      ([0, 1].includes(policy?.mode) && policy.explicit !== false)) {
      // Only a received revocation may stop monitoring. This runner never repairs
      // registration, requests GPS/permission, or starts an authentication flow.
      await stopGeofence();
      await assertAttendanceQueueScope(scope);
    }
    const config = await readAttendanceConfig();
    await assertAttendanceQueueScope(scope);
    if (config?.tenantKey === scope.tenantKey && config.employeeId === scope.employeeId) {
      await drainAutoAttendanceEvents({ scope, onTransition: (result, event) => publishTransition(scope, result, event) });
      await assertAttendanceQueueScope(scope);
      await syncPendingAttendance({ employeeId: scope.employeeId, syncScope: scope, trigger: `${trigger}-events` });
    }
    await assertAttendanceQueueScope(scope);
    const allowNewAttendance = !await automaticRevoked(scope);
    const [outbox, events] = await Promise.all([
      hasBackgroundSyncWork(scope), hasBackgroundEventWork(scope, { allowNewAttendance }),
    ]);
    await assertAttendanceQueueScope(scope);
    await persistor.flush();
    await assertAttendanceQueueScope(scope);
    return outbox || events;
  };
  recordAttendanceLifecycle(`${prefix}.js-start`, {});
  try {
    retry = await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(deadlineError()); }, budget);
        // Release orchestration promptly when native expires/stops while HTTP
        // is awaiting a response. The request itself retains dispatch evidence.
        cancellationTimer = setInterval(() => {
          if (cancelled()) reject(deadlineError());
        }, 250);
      }),
    ]);
  } catch (error) {
    retry = cancelled() || !["ATTENDANCE_SYNC_SCOPE_CHANGED", "CAPABILITY_SCOPE_CHANGED"].includes(error?.code);
    recordAttendanceLifecycle(`${prefix}.js-error`, { reason: error?.code ?? "unexpected-error", retryable: retry });
  } finally {
    clearTimeout(timer);
    clearInterval(cancellationTimer);
    // A raced Promise is not aborted. Its next scope boundary must refuse new
    // dispatch/publication; existing dispatch evidence remains for verification.
    expired = true;
    recordAttendanceLifecycle(`${prefix}.js-complete`, { retryable: retry });
  }
  return { retry };
};
