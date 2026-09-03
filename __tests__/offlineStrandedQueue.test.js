/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js. The queue here is a real SQLite table and the
 * NetworkListener is the real one; only NetInfo and the upload are faked.
 *
 * ---------------------------------------------------------------------------
 * The failure this suite exists for
 * ---------------------------------------------------------------------------
 *
 * Two technicians' punches sat in the queue reading "Pending sync" for eleven
 * hours with nothing in the backend, on phones that were plainly online — one
 * of them had downloaded an OTA update over the same connection.
 *
 * `pending` is the tell. Every path that reaches the server moves a row off it:
 * a transport failure walks the retry ladder and lands on `blocked` inside two
 * hours, a refusal lands on `rejected`. A row still `pending` after eleven
 * hours was never *attempted* — and the only thing that can decline to attempt
 * is the connectivity gate.
 *
 * On Android `isInternetReachable` is `NET_CAPABILITY_VALIDATED`, the OS
 * captive-portal probe. Site wifi behind a firewall that blocks Android's
 * check-in endpoint reports `false` for as long as the device stays on it,
 * while every request the app makes succeeds. The drain believed it and went
 * home.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));

jest.mock("../services/offline/AttendanceApi", () => ({
  __esModule: true,
  PUSH_RESULT: {
    INSERTED: "inserted",
    DUPLICATE: "duplicate",
    BLOCKED: "blocked",
    REJECTED: "rejected",
  },
  pushCheckin: jest.fn(),
}));

import NetInfo from "@react-native-community/netinfo";
import {
  QUEUE_ACTION,
  QUEUE_STATUS,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import { enqueue, findById } from "../services/offline/AttendanceQueueRepository";
import {
  resetSyncService,
  syncPendingAttendance,
} from "../services/offline/AttendanceSyncService";
import { PUSH_RESULT, pushCheckin } from "../services/offline/AttendanceApi";
import {
  fetchIsOnline,
  fetchShouldAttemptRequest,
  resetNetworkListener,
  shouldAttemptRequest,
} from "../services/offline/NetworkListener";

const { __resetAll } = require("../test-utils/expoSqliteMock");

const EMPLOYEE = "0202";

/** Connected, and the OS captive-portal probe says otherwise. */
const misvalidatedWifi = {
  isConnected: true,
  isInternetReachable: false,
  type: "wifi",
};

const punch = (overrides = {}) => ({
  employeeId: EMPLOYEE,
  attendanceType: "manual",
  action: QUEUE_ACTION.CHECKIN,
  timestamp: "2026-09-03 05:13:00",
  ...overrides,
});

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  resetNetworkListener();
  pushCheckin.mockReset();
  NetInfo.fetch.mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: "wifi",
  });
});

describe("the reachability probe gets no vote", () => {
  it("reports online when only the probe says otherwise", async () => {
    NetInfo.fetch.mockResolvedValue(misvalidatedWifi);

    // One predicate, so there is nothing for the UI and the services to
    // disagree about. This is also what stops the banner telling an employee
    // they are offline while their punches go through normally.
    await expect(fetchIsOnline()).resolves.toBe(true);
    await expect(fetchShouldAttemptRequest()).resolves.toBe(true);
  });

  it("stops at a genuine absence of transport", () => {
    expect(
      shouldAttemptRequest({
        isConnected: false,
        isInternetReachable: false,
        type: "none",
      }),
    ).toBe(false);

    // Aeroplane mode with a stale `isConnected` still has no interface.
    expect(
      shouldAttemptRequest({
        isConnected: true,
        isInternetReachable: null,
        type: "none",
      }),
    ).toBe(false);
  });
});

describe("a queued punch on a mis-validated network", () => {
  it("is uploaded rather than left in pending", async () => {
    const { row } = await enqueue(punch());
    NetInfo.fetch.mockResolvedValue(misvalidatedWifi);
    pushCheckin.mockResolvedValue({
      result: PUSH_RESULT.INSERTED,
      serverCheckinId: "EMP-CKIN-09-2026-000042",
      message: "Attendance recorded",
      response: { status: "success", inserted: ["EMP-CKIN-09-2026-000042"] },
    });

    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect(summary.ran).toBe(true);
    expect(summary.synced).toBe(1);
    expect(pushCheckin).toHaveBeenCalledTimes(1);
    expect((await findById(row.id)).status).toBe(QUEUE_STATUS.SYNCED);
  });

  it("still escalates a row the server refuses, instead of sitting on it", async () => {
    // The other half of the same defect: because nothing was ever sent, nothing
    // was ever classified, so no row could reach `blocked` and no banner could
    // tell anybody there was a problem to fix.
    const { row } = await enqueue(punch());
    NetInfo.fetch.mockResolvedValue(misvalidatedWifi);
    pushCheckin.mockResolvedValue({
      result: PUSH_RESULT.BLOCKED,
      failureClass: "configuration",
      message: "Shift not assigned",
      response: { status: "error" },
    });

    await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect((await findById(row.id)).status).toBe(QUEUE_STATUS.BLOCKED);
  });
});

describe("a queued punch with no transport at all", () => {
  it("is left untouched and costs no request", async () => {
    const { row } = await enqueue(punch());
    NetInfo.fetch.mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
      type: "none",
    });

    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe("offline");
    expect(pushCheckin).not.toHaveBeenCalled();
    expect((await findById(row.id)).status).toBe(QUEUE_STATUS.PENDING);
  });
});
