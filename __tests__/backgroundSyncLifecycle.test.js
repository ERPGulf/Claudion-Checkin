let mockReconnect;
let mockTokenChanged;
let mockQueuedPunch;
let mockAppStateChanged;
const mockRemoveAppState = jest.fn();
jest.mock("../services/api/apiClient", () => ({
  addTokenChangeListener: jest.fn(listener => {
    mockTokenChanged = listener;
    return jest.fn();
  }),
}));
jest.mock("../services/offline/AttendanceSyncService", () => ({
  cancelActiveSync: jest.fn(),
  syncPendingAttendance: jest.fn(async () => ({ ran: true })),
}));
jest.mock("../services/offline/attendanceQueueProvenance", () => ({
  assertAttendanceQueueScope: jest.fn(async () => ({})),
  captureAttendanceQueueScope: jest.fn(async () => ({})),
}));
jest.mock("../services/offline/AttendanceQueueService", () => ({
  registerQueueDrainHandler: jest.fn(listener => {
    mockQueuedPunch = listener;
    return jest.fn();
  }),
}));
jest.mock("../services/offline/attendanceConfigCache", () => ({
  refreshAttendanceConfig: jest.fn(async () => ({ refreshed: false })),
  refreshAttendanceConfigIfStale: jest.fn(async () => ({ refreshed: false })),
}));
jest.mock("../services/offline/NetworkListener", () => ({
  startNetworkListener: jest.fn(),
  stopNetworkListener: jest.fn(),
  fetchShouldAttemptRequest: jest.fn(async () => true),
  addReconnectListener: jest.fn(listener => {
    mockReconnect = listener;
    return jest.fn();
  }),
}));

import { AppState, Platform } from "react-native";
import { cancelActiveSync, syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { noteIOSAttendanceWake, deferToIOSAttendanceWake } from "../services/offline/BackgroundAttendanceOwnership";
import { refreshAttendanceConfig, refreshAttendanceConfigIfStale } from "../services/offline/attendanceConfigCache";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { QUEUE_KICK_DELAY_MS, SYNC_INTERVAL_MS, startBackgroundSync, stopBackgroundSync } from "../services/offline/BackgroundSyncManager";

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = "active";
  deferToIOSAttendanceWake();
  AppState.addEventListener.mockImplementation((_, listener) => {
    mockAppStateChanged = listener;
    return { remove: mockRemoveAppState };
  });
});

const settle = async () => { for (let step = 0; step < 15; step += 1) await Promise.resolve(); };

afterEach(() => {
  stopBackgroundSync();
  jest.useRealTimers();
});

it("skips background and inactive heartbeat work, then resumes the foreground heartbeat", async () => {
  startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
  await settle();
  expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "launch" }));
  syncPendingAttendance.mockClear();
  fetchShouldAttemptRequest.mockClear();
  refreshAttendanceConfig.mockClear();
  refreshAttendanceConfigIfStale.mockClear();

  for (const state of ["background", "inactive"]) {
    AppState.currentState = state;
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 3);
    await settle();
  }
  expect(syncPendingAttendance).not.toHaveBeenCalled();
  expect(fetchShouldAttemptRequest).not.toHaveBeenCalled();
  expect(refreshAttendanceConfigIfStale).not.toHaveBeenCalled();

  AppState.currentState = "active";
  jest.advanceTimersByTime(SYNC_INTERVAL_MS);
  await settle();
  expect(syncPendingAttendance).toHaveBeenCalledTimes(1);
  expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "interval" }));
  expect(refreshAttendanceConfigIfStale).toHaveBeenCalledTimes(1);
});

it("retains launch, queue, reconnect and token triggers during background wakes and foreground recovery", async () => {
  AppState.currentState = "background";
  startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
  await settle();
  expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "launch" }));
  expect(refreshAttendanceConfig).toHaveBeenCalledTimes(1);

  mockQueuedPunch();
  jest.advanceTimersByTime(QUEUE_KICK_DELAY_MS);
  mockReconnect();
  mockTokenChanged();
  expect(syncPendingAttendance.mock.calls.map(([options]) => options.trigger)).toEqual([
    "launch", "queued-punch", "reconnect", "token-refresh",
  ]);

  AppState.currentState = "active";
  mockAppStateChanged("active");
  expect(syncPendingAttendance).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: "foreground" }));
  stopBackgroundSync();
  expect(mockRemoveAppState).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("defers background UI drains to a native iOS wake until foreground recovery", async () => {
  const platform = Platform.OS;
  Platform.OS = "ios";
  try {
    AppState.currentState = "background";
    noteIOSAttendanceWake();
    startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
    mockReconnect();
    mockTokenChanged();
    mockQueuedPunch();
    jest.advanceTimersByTime(QUEUE_KICK_DELAY_MS);
    await settle();
    expect(syncPendingAttendance).not.toHaveBeenCalled();
    expect(refreshAttendanceConfig).not.toHaveBeenCalled();
    stopBackgroundSync();
    expect(cancelActiveSync).not.toHaveBeenCalled();

    AppState.currentState = "active";
    startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
    await settle();
    expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "launch" }));
    expect(refreshAttendanceConfig).toHaveBeenCalledTimes(1);
  } finally {
    Platform.OS = platform;
    AppState.currentState = "active";
    deferToIOSAttendanceWake();
  }
});

it("does not cancel an independent drain when the UI manager was never started", () => {
  stopBackgroundSync();
  expect(cancelActiveSync).not.toHaveBeenCalled();
});
