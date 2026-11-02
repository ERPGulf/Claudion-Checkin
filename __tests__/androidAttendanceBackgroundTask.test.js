let mockHydrated = true;
let mockHydrationListener;
let mockState;
const mockScope = { tenantKey: "https://synthetic.example", employeeId: "EMP-SYNTHETIC", accountId: "synthetic-account", generation: 0 };
jest.mock("react-native", () => Object.defineProperties(Object.create(jest.requireActual("react-native")), {
  Platform: { value: { OS: "android" } },
  AppRegistry: { value: { registerHeadlessTask: jest.fn() } },
}));
jest.mock("../redux/Store", () => ({
  store: { getState: () => mockState, dispatch: jest.fn(action => {
    if (action.type === "featureSettings/settingsReceived") mockState.settings = action.payload.settings;
  }) },
  persistor: { getState: () => ({ bootstrapped: mockHydrated }), flush: jest.fn(async () => {}),
    subscribe: jest.fn(listener => { mockHydrationListener = listener; return jest.fn(); }) },
}));
jest.mock("../redux/Slices/FeatureSettingsSlice", () => ({
  selectScopedFeatureSettings: state => state.settings,
  settingsRequested: payload => ({ type: "featureSettings/settingsRequested", payload }),
  settingsReceived: payload => ({ type: "featureSettings/settingsReceived", payload }),
  settingsFailed: payload => ({ type: "featureSettings/settingsFailed", payload }),
}));
jest.mock("../modules/expo-auto-attendance", () => ({ completeBackgroundSync: jest.fn(), stopGeofence: jest.fn(async () => {}) }));
jest.mock("../services/api/featureSettings.service", () => ({ getFeatureSettings: jest.fn() }));
jest.mock("../services/employeeAutoAttendancePolicy", () => ({ getEmployeeAutoAttendancePolicy: jest.fn() }));
jest.mock("../services/notifications/localNotifications", () => ({ presentLocalNotification: jest.fn() }));
jest.mock("../utils/attendanceSessionState", () => ({
  isSessionActive: session => session.status === "CHECKED_IN",
  publishCurrentSession: jest.fn(async ({ assertCurrent, publish }) => { await assertCurrent(); publish({ status: "CHECKED_OUT", endedAt: 1234 }); }),
  TRANSITION_RESULT: { COMPLETED: "COMPLETED" },
}));
jest.mock("../services/offline/attendanceQueueProvenance", () => ({
  readAttendanceQueueScope: jest.fn(async () => ({ ...mockScope, authenticated: true, accessToken: "synthetic-secret" })),
  captureAttendanceQueueScope: jest.fn(async () => mockScope), assertAttendanceQueueScope: jest.fn(async scope => {
    if (scope.isCancelled?.()) throw Object.assign(new Error("cancelled"), { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  }),
}));
jest.mock("../services/offline/AutoAttendanceEventProcessor", () => ({
  drainAutoAttendanceEvents: jest.fn(async () => ({ processed: 0 })), ingestPendingNativeEvents: jest.fn(async () => 0),
}));
jest.mock("../services/offline/AutoAttendanceEventRepository", () => ({ hasBackgroundEventWork: jest.fn(async () => false) }));
jest.mock("../services/offline/AttendanceQueueRepository", () => ({ hasBackgroundSyncWork: jest.fn(async () => false) }));
jest.mock("../services/offline/AttendanceSyncService", () => ({ syncPendingAttendance: jest.fn(async () => ({ remaining: 99 })) }));
jest.mock("../services/offline/attendanceConfigCache", () => ({
  readAttendanceConfig: jest.fn(async () => ({ ...mockScope, rules: { geotagging: 2 }, locations: [] })),
  refreshAttendanceConfig: jest.fn(async () => ({})),
}));
jest.mock("../services/offline/NetworkListener", () => ({ fetchShouldAttemptRequest: jest.fn(async () => true) }));
jest.mock("../services/offline/offlineCapability", () => ({ setOfflineQueueingAllowed: jest.fn() }));
jest.mock("../services/offline/attendanceDiagnostics", () => ({ recordAttendanceLifecycle: jest.fn() }));

import { AppRegistry } from "react-native";
import { persistor, store } from "../redux/Store";
import { completeBackgroundSync, stopGeofence } from "../modules/expo-auto-attendance";
import { getFeatureSettings } from "../services/api/featureSettings.service";
import { getEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";
import { presentLocalNotification } from "../services/notifications/localNotifications";
import { readAttendanceQueueScope, assertAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { drainAutoAttendanceEvents, ingestPendingNativeEvents } from "../services/offline/AutoAttendanceEventProcessor";
import { hasBackgroundEventWork } from "../services/offline/AutoAttendanceEventRepository";
import { hasBackgroundSyncWork } from "../services/offline/AttendanceQueueRepository";
import { syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { refreshAttendanceConfig } from "../services/offline/attendanceConfigCache";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { normalizeFeatureSettings } from "../utils/featureSettings";
import { ANDROID_ATTENDANCE_TASK, BACKGROUND_SYNC_BUDGET_MS, runAndroidAttendanceBackgroundSync } from "../services/offline/AndroidAttendanceBackgroundTask";

const enabled = () => normalizeFeatureSettings({ attendance_action: { geo_tagging: true, offline_attendance: true } });
const registeredTask = AppRegistry.registerHeadlessTask.mock.calls[0];
beforeEach(() => {
  jest.clearAllMocks(); mockHydrated = true;
  mockState = { userAuth: { isLoggedIn: true }, settings: enabled() };
  getFeatureSettings.mockResolvedValue({ message: enabled() });
  getEmployeeAutoAttendancePolicy.mockResolvedValue({ mode: 2 });
  readAttendanceQueueScope.mockResolvedValue({ ...mockScope, authenticated: true, accessToken: "synthetic-secret" });
  fetchShouldAttemptRequest.mockResolvedValue(true);
  hasBackgroundSyncWork.mockResolvedValue(false); hasBackgroundEventWork.mockResolvedValue(false);
  drainAutoAttendanceEvents.mockResolvedValue({ processed: 0 });
});
afterEach(() => jest.useRealTimers());

it("registers a headless task before any root component mounts", () => {
  expect(registeredTask[0]).toBe(ANDROID_ATTENDANCE_TASK);
  expect(registeredTask[1]()).toBe(runAndroidAttendanceBackgroundSync);
});

it("waits for hydration, then reuses both existing processors without mounting a screen", async () => {
  mockHydrated = false;
  const run = runAndroidAttendanceBackgroundSync({ runId: "run-hydration" });
  await Promise.resolve();
  expect(ingestPendingNativeEvents).not.toHaveBeenCalled();
  expect(persistor.subscribe).toHaveBeenCalled();
  mockHydrated = true; mockHydrationListener();
  expect(await run).toEqual({ retry: false });
  expect(ingestPendingNativeEvents).toHaveBeenCalledTimes(1);
  expect(refreshAttendanceConfig).toHaveBeenCalledWith(mockScope.employeeId, { expectedGeneration: 0 });
  expect(syncPendingAttendance).toHaveBeenCalledTimes(2);
  expect(syncPendingAttendance.mock.invocationCallOrder[0]).toBeLessThan(drainAutoAttendanceEvents.mock.invocationCallOrder[0]);
  expect(drainAutoAttendanceEvents.mock.invocationCallOrder[0]).toBeLessThan(syncPendingAttendance.mock.invocationCallOrder[1]);
  expect(completeBackgroundSync).toHaveBeenCalledWith("run-hydration", false);
  expect(persistor.flush.mock.invocationCallOrder[0]).toBeLessThan(completeBackgroundSync.mock.invocationCallOrder[0]);
});

it.each(["logged-out", "missing-token"])("persists receipts but refuses upload when %s", async state => {
  if (state === "logged-out") mockState.userAuth.isLoggedIn = false;
  else readAttendanceQueueScope.mockResolvedValue({ ...mockScope, authenticated: false });
  expect(await runAndroidAttendanceBackgroundSync({ runId: state })).toEqual({ retry: false });
  expect(ingestPendingNativeEvents).toHaveBeenCalledTimes(1);
  expect(syncPendingAttendance).not.toHaveBeenCalled(); expect(drainAutoAttendanceEvents).not.toHaveBeenCalled();
});

it.each(["outbox", "events"])("requests native retry for retained %s, independent of summary.remaining", async kind => {
  if (kind === "outbox") hasBackgroundSyncWork.mockResolvedValue(true);
  else hasBackgroundEventWork.mockResolvedValue(true);
  expect(await runAndroidAttendanceBackgroundSync({ runId: kind })).toEqual({ retry: true });
  expect(completeBackgroundSync).toHaveBeenCalledWith(kind, true);
});

it("uses cached policy offline and still retains retry work", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false); hasBackgroundEventWork.mockResolvedValue(true);
  await runAndroidAttendanceBackgroundSync({ runId: "offline" });
  expect(getFeatureSettings).not.toHaveBeenCalled(); expect(refreshAttendanceConfig).not.toHaveBeenCalled();
  expect(completeBackgroundSync).toHaveBeenCalledWith("offline", true);
});

it("applies a tenant revocation to event retry classification while draining previously accepted rows", async () => {
  getFeatureSettings.mockResolvedValue({ message: normalizeFeatureSettings({ attendance_action: { geo_tagging: false } }) });
  await runAndroidAttendanceBackgroundSync({ runId: "revocation" });
  expect(syncPendingAttendance).toHaveBeenCalledTimes(2);
  expect(stopGeofence).toHaveBeenCalledTimes(1);
  expect(hasBackgroundEventWork).toHaveBeenCalledWith(expect.objectContaining(mockScope), { allowNewAttendance: false });
});

it.each([0, 1])("stops monitoring for an explicit employee mode %s while retaining uncertain history-verification work", async mode => {
  getEmployeeAutoAttendancePolicy.mockResolvedValue({ mode, explicit: true });
  hasBackgroundEventWork.mockResolvedValue(true);
  await runAndroidAttendanceBackgroundSync({ runId: "employee-revoked" });
  expect(stopGeofence).toHaveBeenCalledTimes(1);
  expect(drainAutoAttendanceEvents).toHaveBeenCalledTimes(1);
  expect(hasBackgroundEventWork).toHaveBeenCalledWith(expect.objectContaining(mockScope), { allowNewAttendance: false });
  expect(completeBackgroundSync).toHaveBeenCalledWith("employee-revoked", true);
});

it("retains monitoring and configuration-recovery retries on an unknown policy after a failed refresh", async () => {
  mockState.settings = null;
  getFeatureSettings.mockResolvedValue({ error: "Synthetic unavailable" });
  getEmployeeAutoAttendancePolicy.mockResolvedValue(null);
  hasBackgroundEventWork.mockResolvedValue(true);
  await runAndroidAttendanceBackgroundSync({ runId: "unknown-policy" });
  expect(stopGeofence).not.toHaveBeenCalled();
  expect(hasBackgroundEventWork).toHaveBeenCalledWith(expect.objectContaining(mockScope), { allowNewAttendance: true });
  expect(completeBackgroundSync).toHaveBeenCalledWith("unknown-policy", true);
});

it("publishes a completed checkout and requests a notification without a permission prompt", async () => {
  drainAutoAttendanceEvents.mockImplementationOnce(async ({ onTransition }) => {
    await onTransition({ status: "COMPLETED", session: { status: "CHECKED_OUT", closedBy: "AUTO" }, queued: false }, { transition: "EXIT" });
  });
  await runAndroidAttendanceBackgroundSync({ runId: "checkout" });
  expect(store.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "attendance/setCheckout" }));
  expect(presentLocalNotification).toHaveBeenCalledWith(expect.objectContaining({ requestPermission: false, title: "Checked out" }));
});

it("stops at account invalidation and never drains under a replacement identity", async () => {
  assertAttendanceQueueScope.mockRejectedValueOnce(Object.assign(new Error("changed"), { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" }));
  expect(await runAndroidAttendanceBackgroundSync({ runId: "changed" })).toEqual({ retry: false });
  expect(syncPendingAttendance).not.toHaveBeenCalled();
});

it("bounds an unavailable hydration and releases the native worker with retry", async () => {
  jest.useFakeTimers(); mockHydrated = false;
  const run = runAndroidAttendanceBackgroundSync({ runId: "deadline" });
  await jest.advanceTimersByTimeAsync(BACKGROUND_SYNC_BUDGET_MS);
  expect(await run).toEqual({ retry: true });
  expect(completeBackgroundSync).toHaveBeenCalledWith("deadline", true);
  expect(syncPendingAttendance).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(250);
});
