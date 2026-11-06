jest.mock("../modules/expo-auto-attendance", () => ({
  recordBackgroundSyncDiagnostic: jest.fn(),
  scheduleBackgroundSync: jest.fn(),
}));

import * as Native from "../modules/expo-auto-attendance";
import { logAttendanceDiagnostic, recordAttendanceLifecycle } from "../services/offline/attendanceDiagnostics";
import { requestQueueDrain, registerQueueDrainHandler, submitManualAttendance } from "../services/offline/AttendanceQueueService";

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

it("keeps private request, response, employee and location details out of development logs", () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  try {
    logAttendanceDiagnostic("[AttendanceUpload]", "HTTP response", {
      httpStatus: 503, queueRowId: 4, attemptCount: 2,
      payload: { logs: [{ employee: "synthetic-private-employee", location: "25.2, 51.3" }] },
      body: { error: "Bearer synthetic-private-token" },
      responseData: { employee_name: "synthetic-private-name" },
      employeeId: "synthetic-private-employee", tenantKey: "https://private-company.example",
      latitude: 25.2, longitude: 51.3, message: "synthetic-private-message",
      reason: "synthetic-private-message", serverCheckinId: "synthetic-private-reference",
      nested: { access_token: "synthetic-private-token", locationName: "synthetic-private-office" },
      summary: { reason: "offline" },
    });
    const output = log.mock.calls.flat().join(" ");
    expect(output).not.toMatch(/synthetic-private|25\.2|51\.3|private-company/);
    expect(output).toContain('"httpStatus": 503');
    expect(output).toContain('"queueRowId": 4');
    expect(output).toContain('"attemptCount": 2');
    expect(output).toContain('"reason": "offline"');
  } finally {
    log.mockRestore();
  }
});

it("does not log raw manual attendance errors in release builds", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const development = global.__DEV__;
  try {
    global.__DEV__ = false;
    const result = await submitManualAttendance({ type: "IN", employeeCode: "synthetic-employee",
      online: async () => { throw new Error("synthetic-private-server-error"); } });
    expect(result.allowed).toBe(false);
    expect(log.mock.calls.flat().join(" ")).not.toContain("synthetic-private-server-error");
  } finally {
    global.__DEV__ = development;
    log.mockRestore();
  }
});
