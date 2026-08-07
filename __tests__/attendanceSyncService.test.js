/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js. The queue itself is a real SQLite table here;
 * only the network is faked.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

// The offline gate pulls in expo-location at module load, which this jest config
// does not transform. Nothing here exercises it — same stub the other attendance
// suites use.
jest.mock("expo-location", () => ({}));

jest.mock("../services/offline/AttendanceApi", () => ({
  __esModule: true,
  PUSH_RESULT: { INSERTED: "inserted", DUPLICATE: "duplicate", REJECTED: "rejected" },
  pushCheckin: jest.fn(),
}));

jest.mock("../services/offline/NetworkListener", () => ({
  __esModule: true,
  fetchIsOnline: jest.fn(() => Promise.resolve(true)),
  isOnline: jest.fn(() => true),
}));

jest.mock("../services/offline/attendancePhotoUpload", () => ({
  __esModule: true,
  uploadQueuedPhoto: jest.fn(() => Promise.resolve({ uploaded: true })),
}));

import {
  QUEUE_ACTION,
  QUEUE_STATUS,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  countByStatus,
  enqueue,
  listAll,
} from "../services/offline/AttendanceQueueRepository";
import {
  resetSyncService,
  syncPendingAttendance,
} from "../services/offline/AttendanceSyncService";
import { PUSH_RESULT, pushCheckin } from "../services/offline/AttendanceApi";
import { fetchIsOnline } from "../services/offline/NetworkListener";
import { uploadQueuedPhoto } from "../services/offline/attendancePhotoUpload";

const { __resetAll } = require("../test-utils/expoSqliteMock");

const punch = (overrides = {}) => ({
  employeeId: "TDI0167",
  attendanceType: "manual",
  action: QUEUE_ACTION.CHECKIN,
  timestamp: "2026-07-28 09:00:00",
  ...overrides,
});

const inserted = (name = "EMP-CKIN-07-2026-000078") => ({
  result: PUSH_RESULT.INSERTED,
  serverCheckinId: name,
  message: "Attendance recorded",
  response: { status: "success", inserted: [name] },
});

const networkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  jest.clearAllMocks();
  fetchIsOnline.mockResolvedValue(true);
  uploadQueuedPhoto.mockResolvedValue({ uploaded: true });
});

describe("draining the queue", () => {
  it("uploads a pending row and marks it synced with the server's docname", async () => {
    await enqueue(punch());
    pushCheckin.mockResolvedValue(inserted());

    const summary = await syncPendingAttendance({ trigger: "test" });

    expect(summary.synced).toBe(1);
    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.SYNCED);
    expect(row.serverCheckinId).toBe("EMP-CKIN-07-2026-000078");
  });

  // A check-out uploaded before its check-in produces a session the backend
  // cannot reconcile, so order is correctness, not tidiness.
  it("uploads oldest-first", async () => {
    await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    await enqueue(
      punch({ timestamp: "2026-07-28 17:00:00", action: QUEUE_ACTION.CHECKOUT }),
    );
    pushCheckin.mockResolvedValue(inserted());

    await syncPendingAttendance();

    const order = pushCheckin.mock.calls.map(([row]) => row.timestamp);
    expect(order).toEqual(["2026-07-28 09:00:00", "2026-07-28 17:00:00"]);
  });

  it("does nothing while offline, leaving rows pending", async () => {
    await enqueue(punch());
    fetchIsOnline.mockResolvedValue(false);

    const summary = await syncPendingAttendance();

    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe("offline");
    expect(pushCheckin).not.toHaveBeenCalled();
    expect((await countByStatus()).pending).toBe(1);
  });

  it("reports an empty run without touching the network", async () => {
    const summary = await syncPendingAttendance();
    expect(summary.synced).toBe(0);
    expect(pushCheckin).not.toHaveBeenCalled();
  });
});

describe("duplicate handling", () => {
  // The server saying "already logged" is the desired end state, and the retry
  // that produces it is by design — a request that committed then timed out.
  it("treats a duplicate as success and never retries it", async () => {
    await enqueue(punch());
    pushCheckin.mockResolvedValue({
      result: PUSH_RESULT.DUPLICATE,
      serverCheckinId: null,
      message: "This employee already has a log with the same timestamp.",
      response: { status: "error", failed: [{ error: "already has a log" }] },
    });

    const summary = await syncPendingAttendance();

    expect(summary.duplicates).toBe(1);
    expect(summary.failed).toBe(0);

    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.SYNCED);
    expect(row.duplicate).toBe(true);
    expect(row.duplicateMessage).toMatch(/already has a log/);
    expect(row.retryCount).toBe(0);
  });

  it("also recognises a duplicate thrown as an HTTP error", async () => {
    await enqueue(punch());
    pushCheckin.mockRejectedValue({
      response: {
        status: 417,
        data: { message: "This employee already has a log with the same timestamp." },
      },
    });

    const summary = await syncPendingAttendance();

    expect(summary.duplicates).toBe(1);
    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.SYNCED);
    expect(row.duplicate).toBe(true);
  });
});

describe("retry rules", () => {
  it("retries a transport failure and arms the backoff", async () => {
    await enqueue(punch());
    pushCheckin.mockRejectedValue(networkError());

    await syncPendingAttendance();

    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.PENDING);
    expect(row.retryCount).toBe(1);
    expect(row.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("retries a 5xx", async () => {
    await enqueue(punch());
    pushCheckin.mockRejectedValue({ response: { status: 503, data: {} } });

    await syncPendingAttendance();

    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.PENDING);
    expect(row.retryCount).toBe(1);
  });

  it.each([400, 401, 403, 404])(
    "does not retry a %i — the answer will not change",
    async (status) => {
      await enqueue(punch());
      pushCheckin.mockRejectedValue({
        response: { status, data: { message: "nope" } },
      });

      const summary = await syncPendingAttendance();

      expect(summary.failed).toBe(1);
      const [row] = await listAll();
      expect(row.status).toBe(QUEUE_STATUS.FAILED);
      expect(row.retryCount).toBe(0);
    },
  );

  it("does not retry a validation rejection returned in the body", async () => {
    await enqueue(punch());
    pushCheckin.mockResolvedValue({
      result: PUSH_RESULT.REJECTED,
      message: "Employee is inactive",
      response: { status: "error" },
    });

    const summary = await syncPendingAttendance();

    expect(summary.failed).toBe(1);
    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.FAILED);
    expect(row.error).toBe("Employee is inactive");
  });

  it("gives up after five retries", async () => {
    await enqueue(punch());
    pushCheckin.mockRejectedValue(networkError());

    // Each run arms a backoff, so time has to be moved past it to get the next
    // attempt — which is exactly what proves the backoff is being honoured.
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;

    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        resetSyncService();
        await syncPendingAttendance();
        clock += 2 * 60 * 60 * 1000; // past any scheduled delay
      }
    } finally {
      Date.now = realNow;
    }

    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.FAILED);
    expect(row.error).toMatch(/Gave up after 5 attempts/);
  });

  // Nothing after the current row will fare better during the same outage.
  it("stops the run when the connection drops mid-drain", async () => {
    await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    await enqueue(punch({ timestamp: "2026-07-28 10:00:00" }));
    await enqueue(punch({ timestamp: "2026-07-28 11:00:00" }));

    pushCheckin
      .mockResolvedValueOnce(inserted("A"))
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(inserted("C"));

    const summary = await syncPendingAttendance();

    expect(summary.synced).toBe(1);
    expect(summary.reason).toBe("connection-lost");
    expect(pushCheckin).toHaveBeenCalledTimes(2);
    expect((await countByStatus()).pending).toBe(2);
  });
});

describe("concurrency", () => {
  // Launch, foreground and reconnect all fire within a second of each other
  // when a phone is picked up outside the office.
  it("collapses overlapping runs into one", async () => {
    await enqueue(punch());
    let resolvePush;
    pushCheckin.mockReturnValue(
      new Promise((resolve) => {
        resolvePush = resolve;
      }),
    );

    const first = syncPendingAttendance({ trigger: "launch" });
    const second = syncPendingAttendance({ trigger: "reconnect" });

    resolvePush(inserted());
    const [firstSummary, secondSummary] = await Promise.all([first, second]);

    // One upload, and both callers see the same run's result — the second did
    // not start a drain of its own and did not get an empty summary either.
    expect(pushCheckin).toHaveBeenCalledTimes(1);
    expect(secondSummary).toEqual(firstSummary);
    expect(firstSummary.synced).toBe(1);
  });

  it("releases rows stranded in syncing by a killed process", async () => {
    await enqueue(punch());
    // Simulate the kill: claim the row, then start a fresh session.
    const { claimNextPending } = require("../services/offline/AttendanceQueueRepository");
    await claimNextPending();
    resetSyncService();

    pushCheckin.mockResolvedValue(inserted());
    const summary = await syncPendingAttendance();

    expect(summary.synced).toBe(1);
  });
});

describe("photo attachments", () => {
  it("uploads the queued photo once the server names the record", async () => {
    await enqueue(punch({ payload: { photoUri: "file:///cache/shot.jpg" } }));
    pushCheckin.mockResolvedValue(inserted("EMP-CKIN-1"));

    await syncPendingAttendance();

    expect(uploadQueuedPhoto).toHaveBeenCalledWith({
      photoUri: "file:///cache/shot.jpg",
      docname: "EMP-CKIN-1",
    });
  });

  it("keeps the row synced even when the photo cannot be attached", async () => {
    await enqueue(punch({ payload: { photoUri: "file:///gone.jpg" } }));
    pushCheckin.mockResolvedValue(inserted());
    uploadQueuedPhoto.mockResolvedValue({ uploaded: false, reason: "missing" });

    const summary = await syncPendingAttendance();

    expect(summary.synced).toBe(1);
    const [row] = await listAll();
    expect(row.status).toBe(QUEUE_STATUS.SYNCED);
  });

  it("does not reach for an upload when there is no photo", async () => {
    await enqueue(punch());
    pushCheckin.mockResolvedValue(inserted());

    await syncPendingAttendance();

    expect(uploadQueuedPhoto).not.toHaveBeenCalled();
  });
});
