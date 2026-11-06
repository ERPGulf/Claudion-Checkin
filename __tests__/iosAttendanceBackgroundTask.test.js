let mockAvailable = false;
let mockPending = null;
let mockActive = new Set();
let mockRequested;
let mockExpired;
jest.mock("react-native", () => Object.defineProperties(Object.create(jest.requireActual("react-native")), {
  Platform: { value: { OS: "ios" } },
}));
jest.mock("../modules/expo-auto-attendance", () => ({
  supportsIOSBackgroundSync: () => mockAvailable,
  getPendingBackgroundSync: jest.fn(() => mockPending),
  isIOSBackgroundSyncActive: jest.fn(id => mockActive.has(id)),
  completeIOSBackgroundSync: jest.fn((id, revision) => {
    if (mockPending?.runId !== id || mockPending.revision !== revision || !mockActive.has(id)) return false;
    mockPending = null;
    mockActive.delete(id);
    return true;
  }),
  addBackgroundSyncRequestedListener: jest.fn(listener => {
    mockRequested = listener;
    return { remove: jest.fn() };
  }),
  addBackgroundSyncExpiredListener: jest.fn(listener => {
    mockExpired = listener;
    return { remove: jest.fn() };
  }),
}));
jest.mock("../services/offline/AttendanceBackgroundSync", () => ({ runAttendanceBackgroundSync: jest.fn() }));
jest.mock("../services/offline/attendanceDiagnostics", () => ({ recordAttendanceLifecycle: jest.fn() }));

import {
  completeIOSBackgroundSync, addBackgroundSyncRequestedListener, addBackgroundSyncExpiredListener,
} from "../modules/expo-auto-attendance";
import { runAttendanceBackgroundSync } from "../services/offline/AttendanceBackgroundSync";
import { IOS_ATTENDANCE_BUDGET_MS, registerIOSAttendanceBackgroundSync } from "../services/offline/IosAttendanceBackgroundTask";

const settle = async () => { for (let step = 0; step < 15; step += 1) await Promise.resolve(); };
const defer = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const wake = (runId, revision = 1, duration = 25000) => {
  mockPending = { runId, revision, deadline: Date.now() + duration };
  mockActive.add(runId);
};
let stop;
beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = true;
  mockPending = null;
  mockActive = new Set();
  runAttendanceBackgroundSync.mockReset().mockResolvedValue({ retry: false });
});
afterEach(async () => { stop?.(); stop = null; await settle(); });

it("leaves older iOS binaries on their existing bootstrap path", () => {
  mockAvailable = false;
  stop = registerIOSAttendanceBackgroundSync();
  expect(addBackgroundSyncRequestedListener).not.toHaveBeenCalled();
  expect(runAttendanceBackgroundSync).not.toHaveBeenCalled();
});

it("pulls a cold native wake after subscribing without waiting for App UI resources", async () => {
  wake("cold");
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  expect(addBackgroundSyncRequestedListener).toHaveBeenCalledTimes(1);
  expect(runAttendanceBackgroundSync).toHaveBeenCalledWith({
    trigger: "ios-location", budgetMs: IOS_ATTENDANCE_BUDGET_MS,
    policyRefreshBudgetMs: 4000, isCancelled: expect.any(Function),
  });
  expect(completeIOSBackgroundSync).toHaveBeenCalledWith("cold", 1, false);
});

it("processes subsequent warm wakes with the same installed listener", async () => {
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  for (const id of ["first", "second", "third"]) {
    wake(id);
    mockRequested();
    await settle();
    expect(completeIOSBackgroundSync).toHaveBeenCalledWith(id, 1, false);
  }
  expect(runAttendanceBackgroundSync).toHaveBeenCalledTimes(3);
  expect(addBackgroundSyncRequestedListener).toHaveBeenCalledTimes(1);
});

it("coalesces overlapping callbacks but rescans a newer capture revision before completion", async () => {
  const first = defer();
  runAttendanceBackgroundSync.mockReturnValueOnce(first.promise);
  wake("burst");
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  mockPending.revision = 2;
  mockRequested();
  mockRequested();
  expect(runAttendanceBackgroundSync).toHaveBeenCalledTimes(1);
  first.resolve({ retry: false });
  await settle();
  expect(runAttendanceBackgroundSync).toHaveBeenCalledTimes(2);
  expect(completeIOSBackgroundSync.mock.calls).toEqual([["burst", 1, false], ["burst", 2, false]]);
});

it("native expiration cancels old continuations without acknowledging a later wake", async () => {
  const first = defer();
  runAttendanceBackgroundSync.mockReturnValueOnce(first.promise);
  wake("expired");
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  const oldScope = runAttendanceBackgroundSync.mock.calls[0][0];
  expect(oldScope.isCancelled()).toBe(false);
  mockActive.delete("expired");
  mockPending = null;
  mockExpired({ runId: "expired" });
  expect(oldScope.isCancelled()).toBe(true);
  wake("next");
  mockRequested();
  first.resolve({ retry: true });
  await settle();
  expect(completeIOSBackgroundSync).not.toHaveBeenCalledWith("expired", expect.anything(), expect.anything());
  expect(completeIOSBackgroundSync).toHaveBeenCalledWith("next", 1, false);
  expect(oldScope.isCancelled()).toBe(true);
});

it("passes retained work to native completion without spinning on retries", async () => {
  runAttendanceBackgroundSync.mockResolvedValue({ retry: true });
  wake("offline");
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  expect(completeIOSBackgroundSync).toHaveBeenCalledWith("offline", 1, true);
  expect(runAttendanceBackgroundSync).toHaveBeenCalledTimes(1);
});

it("uses the remaining native cap rather than assuming a full execution grant", async () => {
  wake("late-start", 1, 1500);
  stop = registerIOSAttendanceBackgroundSync();
  await settle();
  expect(runAttendanceBackgroundSync.mock.calls[0][0].budgetMs).toBeGreaterThan(0);
  expect(runAttendanceBackgroundSync.mock.calls[0][0].budgetMs).toBeLessThanOrEqual(1500);
});

it("teardown cancels an in-flight scope and removes subscriptions", async () => {
  const first = defer();
  runAttendanceBackgroundSync.mockReturnValueOnce(first.promise);
  wake("dispose");
  stop = registerIOSAttendanceBackgroundSync();
  const scope = runAttendanceBackgroundSync.mock.calls[0][0];
  stop();
  expect(scope.isCancelled()).toBe(true);
  first.resolve({ retry: true });
  await settle();
  expect(completeIOSBackgroundSync).not.toHaveBeenCalled();
  expect(addBackgroundSyncRequestedListener.mock.results[0].value.remove).toHaveBeenCalled();
  expect(addBackgroundSyncExpiredListener.mock.results[0].value.remove).toHaveBeenCalled();
  stop = null;
});
