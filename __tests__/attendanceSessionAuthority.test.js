/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QUEUE_ACTION,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import { enqueue } from "../services/offline/AttendanceQueueRepository";
import { getQueueCounts } from "../services/offline/AttendanceQueueService";
import {
  performSessionTransition,
  readSession,
  reconcileSessionFromServer,
  SESSION_ORIGIN,
  SESSION_STATUS,
} from "../utils/attendanceSessionState";
import { resolveActiveSessionStart } from "../utils/attendanceSession";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * Who owns "am I checked in right now?"
 *
 * The device does. The durable record in `attendanceSessionState` is written on
 * every committed transition and is what the geofence listeners read after an OS
 * relaunch. The server owns the *record* of attendance, and gets to correct the
 * device — but only when it could actually know better.
 *
 * These tests pin the two situations where it cannot, both of which previously
 * closed a live session and invited a duplicate punch.
 */
beforeEach(async () => {
  __resetAll();
  resetDatabaseHandle();
  await AsyncStorage.clear();
});

/** Opens a session the way an offline check-in does. */
const checkInOffline = async (at) => {
  const outcome = await performSessionTransition({
    type: "IN",
    origin: SESSION_ORIGIN.MANUAL,
    at,
    execute: async () => ({ allowed: true, queued: true }),
  });
  return outcome.session;
};

describe("an unreachable server is not a check-out", () => {
  it("still resolves to no session, which is why the caller must gate on `unavailable`", () => {
    // The status helper cannot express "I don't know" through this function —
    // hence the flag, and hence the guard living in the hook.
    expect(
      resolveActiveSessionStart({
        status: { custom_in: 0, unavailable: true },
        storedCheckinStartTime: Date.now() - 60_000,
        reduxCheckinTime: null,
        lastCheckoutTime: null,
      }),
    ).toBeNull();
  });

  it("reconciling on that answer would close a live session", async () => {
    await checkInOffline(Date.now() - 60_000);

    const session = await reconcileSessionFromServer({
      activeStartedAt: null,
      fetchedAt: Date.now(),
    });

    // Demonstrates the damage the guard prevents — the record really does close.
    expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
  });
});

describe("the reconnect race", () => {
  // Nastier than being offline: the network is back, the request succeeds, and
  // it legitimately answers "checked out" only because the drain has not
  // uploaded the check-in yet.
  it("leaves an unsynced check-in in the queue for the guard to see", async () => {
    await checkInOffline(Date.now() - 60_000);
    await enqueue({
      employeeId: "TDI0167",
      attendanceType: "manual",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-07-28 09:00:00",
    });

    const counts = await getQueueCounts("TDI0167");

    expect(counts.awaitingServerCount).toBe(1);
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
  });

  it("reports nothing unsynced once the drain has finished", async () => {
    const { markSynced } = require("../services/offline/AttendanceQueueRepository");
    const { row } = await enqueue({
      employeeId: "TDI0167",
      attendanceType: "manual",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-07-28 09:00:00",
    });

    await markSynced({ id: row.id, serverCheckinId: "EMP-CKIN-1" });

    // From here the server's answer IS admissible, and reconciliation resumes.
    expect((await getQueueCounts("TDI0167")).awaitingServerCount).toBe(0);
  });

  it("counts only this employee's rows", async () => {
    await enqueue({
      employeeId: "TDI0999",
      attendanceType: "manual",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-07-28 09:00:00",
    });

    expect((await getQueueCounts("TDI0167")).awaitingServerCount).toBe(0);
    expect((await getQueueCounts("TDI0999")).awaitingServerCount).toBe(1);
  });
});

describe("the opposite direction is already safe", () => {
  // A queued check-OUT must not be undone by a stale "still checked in".
  it("refuses to reopen a session that predates the last check-out", async () => {
    const startedAt = Date.now() - 60 * 60 * 1000;
    await checkInOffline(startedAt);

    await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.MANUAL,
      execute: async () => ({ allowed: true, queued: true }),
    });

    // The server still shows the old open session, because the OUT is queued.
    const session = await reconcileSessionFromServer({
      activeStartedAt: startedAt,
      fetchedAt: Date.now(),
    });

    expect(session.status).toBe(SESSION_STATUS.CHECKED_OUT);
  });
});
