jest.mock("../modules/expo-auto-attendance", () => ({
  recordBackgroundSyncDiagnostic: jest.fn(),
  scheduleBackgroundSync: jest.fn(),
}));

import * as Native from "../modules/expo-auto-attendance";
import { recordAttendanceLifecycle } from "../services/offline/attendanceDiagnostics";
import { requestQueueDrain, registerQueueDrainHandler } from "../services/offline/AttendanceQueueService";

const eventId = "12345678-1234-1234-1234-123456789abc";

afterEach(() => {
  jest.clearAllMocks();
  registerQueueDrainHandler(null);
});

it("persists only safe lifecycle metadata and a UUID correlation ID", () => {
  recordAttendanceLifecycle("upload.response", {
    eventId, queueRowId: 4, httpStatus: 503, status: "pending", token: "private",
    employeeId: "employee-private", latitude: 25, body: { secret: "private" },
    reason: "arbitrary server text with private data",
  });
  expect(Native.recordBackgroundSyncDiagnostic).toHaveBeenCalledWith("upload.response", eventId, {
    queueRowId: 4, httpStatus: 503, status: "pending",
  });
  recordAttendanceLifecycle("sqlite.ingress_committed", { eventId: "legacy:private-employee", status: "needs_review" });
  expect(Native.recordBackgroundSyncDiagnostic).toHaveBeenLastCalledWith("sqlite.ingress_committed", "", { status: "needs_review" });
});

it("does not write diagnostics in release builds or fail attendance on a diagnostic error", () => {
  const development = global.__DEV__;
  try {
    global.__DEV__ = false;
    recordAttendanceLifecycle("upload.response", { eventId });
    expect(Native.recordBackgroundSyncDiagnostic).not.toHaveBeenCalled();
  } finally {
    global.__DEV__ = development;
  }
  Native.recordBackgroundSyncDiagnostic.mockImplementationOnce(() => { throw new Error("storage unavailable"); });
  expect(() => recordAttendanceLifecycle("upload.response", { eventId })).not.toThrow();
});

it("schedules durable Android work without a mounted JS sync manager", () => {
  requestQueueDrain({ employeeId: "synthetic" });
  expect(Native.scheduleBackgroundSync).toHaveBeenCalledTimes(1);
});

it("keeps foreground recovery when native scheduling fails or the binary predates it", () => {
  const foreground = jest.fn();
  registerQueueDrainHandler(foreground);
  Native.scheduleBackgroundSync.mockImplementationOnce(() => { throw new Error("unavailable"); });
  requestQueueDrain({ reason: "queued-punch" });
  expect(foreground).toHaveBeenCalledWith({ reason: "queued-punch" });
});

it("retains foreground recovery when durable native enqueue rejects asynchronously", async () => {
  const foreground = jest.fn();
  registerQueueDrainHandler(foreground);
  Native.scheduleBackgroundSync.mockRejectedValueOnce(new Error("synthetic enqueue failure"));
  requestQueueDrain({ reason: "queued-punch" });
  await Promise.resolve();
  expect(foreground).toHaveBeenCalledWith({ reason: "queued-punch" });
});
