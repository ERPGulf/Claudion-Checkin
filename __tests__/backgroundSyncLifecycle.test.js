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

import { AppState } from "react-native";
import { syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { refreshAttendanceConfig, refreshAttendanceConfigIfStale } from "../services/offline/attendanceConfigCache";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { QUEUE_KICK_DELAY_MS, SYNC_INTERVAL_MS, startBackgroundSync, stopBackgroundSync } from "../services/offline/BackgroundSyncManager";

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = "active";
  AppState.addEventListener.mockImplementation((_, listener) => {
    mockAppStateChanged = listener;
    return { remove: mockRemoveAppState };
  });
});

afterEach(() => {
  stopBackgroundSync();
  jest.useRealTimers();
});

it("skips background and inactive heartbeat work, then resumes the foreground heartbeat", async () => {
  startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
  await Promise.resolve();
  expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "launch" }));
  syncPendingAttendance.mockClear();
  fetchShouldAttemptRequest.mockClear();
  refreshAttendanceConfig.mockClear();
  refreshAttendanceConfigIfStale.mockClear();

  for (const state of ["background", "inactive"]) {
    AppState.currentState = state;
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 3);
    await Promise.resolve();
  }
  expect(syncPendingAttendance).not.toHaveBeenCalled();
  expect(fetchShouldAttemptRequest).not.toHaveBeenCalled();
  expect(refreshAttendanceConfigIfStale).not.toHaveBeenCalled();

  AppState.currentState = "active";
  jest.advanceTimersByTime(SYNC_INTERVAL_MS);
  await Promise.resolve();
  expect(syncPendingAttendance).toHaveBeenCalledTimes(1);
  expect(syncPendingAttendance).toHaveBeenCalledWith(expect.objectContaining({ trigger: "interval" }));
  expect(refreshAttendanceConfigIfStale).toHaveBeenCalledTimes(1);
});

it("retains launch, queue, reconnect and token triggers during background wakes and foreground recovery", async () => {
  AppState.currentState = "background";
  startBackgroundSync({ employeeId: "EMP-SYNTHETIC" });
  await Promise.resolve();
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
