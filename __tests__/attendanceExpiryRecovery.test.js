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
  FAILURE_CLASS,
  QUEUE_ACTION,
  QUEUE_STATUS,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  claimNextPending,
  enqueue,
  listAll,
  markBlocked,
  markSynced,
} from "../services/offline/AttendanceQueueRepository";
import {
  clearOfflineAttendance,
  getQueueCounts,
  purgeAttendanceQueue,
} from "../services/offline/AttendanceQueueService";
import { readAttendanceConfig } from "../services/offline/attendanceConfigCache";
import {
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  SESSION_STATUS,
  TRANSITION_RESULT,
} from "../utils/attendanceSessionState";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * The production failure, start to finish.
 *
 * An employee was checked in automatically at 07:54, left the office at 12:29
 * with no signal, and got a "Checked out" notification. The server never
 * received the check-out, and when they walked back in at 12:40 the app filed a
 * *second* check-in on top of the session that was still open — leaving their
 * day as IN, IN with no OUT and a lost afternoon of payroll.
 *
 * The link in the middle was authentication: their token expired while the
 * check-out sat in the queue, and the forced-logout cleanup deleted the queue
 * before it could drain. These tests pin the two invariants that break the
 * chain — a queued punch survives an auth failure, and it only ever syncs for
 * the employee who made it.
 */

const EMPLOYEE = "HR-EMP-00011";
const OTHER_EMPLOYEE = "HR-EMP-00099";

beforeEach(async () => {
  __resetAll();
  resetDatabaseHandle();
  await AsyncStorage.clear();
});

/** A punch that could not reach the server and went to the queue instead. */
const queuePunch = ({
  employeeId = EMPLOYEE,
  action = QUEUE_ACTION.CHECKOUT,
  timestamp = "2026-09-01 12:29:00",
} = {}) =>
  enqueue({
    employeeId,
    employeeDocname: employeeId,
    attendanceType: "auto",
    action,
    timestamp,
    deviceId: "MobileAPP",
    payload: { over_time: 0 },
  });

describe("a session expiry cannot destroy a queued punch", () => {
  it("keeps the pending check-out through the forced-logout cleanup", async () => {
    await queuePunch();
    expect((await getQueueCounts(EMPLOYEE)).awaitingServerCount).toBe(1);

    // Exactly what apiClient's expireSession() runs as its cleanup hook.
    await clearOfflineAttendance();

    const rows = await listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(QUEUE_STATUS.PENDING);
    expect(rows[0].employeeId).toBe(EMPLOYEE);
    expect((await getQueueCounts(EMPLOYEE)).awaitingServerCount).toBe(1);
  });

  it("still drops the cached rules, which are policy rather than the employee's data", async () => {
    await AsyncStorage.setItem(
      "attendanceConfigCache",
      JSON.stringify({ employeeId: EMPLOYEE, restrictLocation: 1 }),
    );

    await clearOfflineAttendance();

    expect(await readAttendanceConfig()).toBeNull();
  });

  it("leaves a queued punch claimable after the cleanup, so it drains on the next login", async () => {
    await queuePunch();
    await clearOfflineAttendance();

    const claimed = await claimNextPending(Date.now(), { employeeId: EMPLOYEE });

    expect(claimed).not.toBeNull();
    expect(claimed.action).toBe(QUEUE_ACTION.CHECKOUT);
  });

  // The escape hatch still exists — it is just no longer wired to anything that
  // happens by itself.
  it("only an explicit purge discards unsynchronised attendance", async () => {
    await queuePunch();

    await purgeAttendanceQueue();

    expect(await listAll()).toHaveLength(0);
  });
});

describe("synchronisation is scoped to the authenticated employee", () => {
  it("will not claim another employee's punch", async () => {
    await queuePunch({ employeeId: OTHER_EMPLOYEE });

    const claimed = await claimNextPending(Date.now(), { employeeId: EMPLOYEE });

    expect(claimed).toBeNull();
  });

  it("preserves the other employee's punch rather than deleting it", async () => {
    await queuePunch({ employeeId: OTHER_EMPLOYEE });
    await claimNextPending(Date.now(), { employeeId: EMPLOYEE });

    const rows = await listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe(OTHER_EMPLOYEE);
    // Untouched, so it is still pending for its owner's next login.
    expect(rows[0].status).toBe(QUEUE_STATUS.PENDING);
  });

  it("claims only this employee's punch when both are queued", async () => {
    await queuePunch({
      employeeId: OTHER_EMPLOYEE,
      timestamp: "2026-09-01 08:00:00", // older, so FIFO would take it first
    });
    await queuePunch({ employeeId: EMPLOYEE, timestamp: "2026-09-01 12:29:00" });

    const claimed = await claimNextPending(Date.now(), { employeeId: EMPLOYEE });

    expect(claimed.employeeId).toBe(EMPLOYEE);
  });
});

describe("the local session distinguishes accepted from server-confirmed", () => {
  it("marks a queued check-out as queued, not confirmed", async () => {
    const outcome = await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => ({ allowed: true, name: "EMP-CKIN-1" }),
    });
    expect(outcome.serverConfirmed).toBe(true);
    expect(outcome.queued).toBe(false);

    const out = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => ({ allowed: true, queued: true }),
    });

    expect(out.status).toBe(TRANSITION_RESULT.COMPLETED);
    // The session really did close on this device...
    expect(out.session.status).toBe(SESSION_STATUS.CHECKED_OUT);
    // ...but nothing has been filed anywhere yet.
    expect(out.queued).toBe(true);
    expect(out.serverConfirmed).toBe(false);
  });

  // The state the bug left behind: local CHECKED_OUT describing a punch the
  // server has never seen. The queue is what knows, and it must survive to say
  // so — this is the fact `reconcilePresence` now gates on.
  it("leaves the queue as the record of what the server has not seen", async () => {
    await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => ({ allowed: true }),
    });
    await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => {
        await queuePunch();
        return { allowed: true, queued: true };
      },
    });

    await clearOfflineAttendance(); // the forced logout

    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect((await getQueueCounts(EMPLOYEE)).awaitingServerCount).toBe(1);
  });
});

/**
 * Which queued rows are allowed to hold automatic check-in shut.
 *
 * `awaitingServerCount` counts every blocked row and blocked rows are kept
 * forever, so a guard that waits for it to reach zero stops working permanently
 * the moment one row cannot be delivered. On a tenant with no offline endpoint
 * that is every row, and automatic check-in would never fire again.
 *
 * `mayAffectServerCount` asks the narrower question the guards actually mean:
 * could any of these still create or close a session on the server?
 */
describe("mayAffectServerCount", () => {
  it("counts a retryable pending row", async () => {
    await queuePunch();

    const counts = await getQueueCounts(EMPLOYEE);
    expect(counts.awaitingServerCount).toBe(1);
    expect(counts.mayAffectServerCount).toBe(1);
  });

  it("counts a row currently being uploaded", async () => {
    await queuePunch();
    await claimNextPending(Date.now(), { employeeId: EMPLOYEE }); // -> syncing

    const counts = await getQueueCounts(EMPLOYEE);
    expect(counts.syncingCount).toBe(1);
    expect(counts.mayAffectServerCount).toBe(1);
  });

  // Auth and configuration resolve on their own — a token refresh, an
  // administrator fixing a setting — so the row really can still land and the
  // server's view of the session is genuinely unsettled until it does.
  it.each([FAILURE_CLASS.AUTH, FAILURE_CLASS.CONFIGURATION, FAILURE_CLASS.UNKNOWN])(
    "counts a row blocked on %s",
    async (failureClass) => {
      const { row } = await queuePunch();
      await markBlocked({ id: row.id, failureClass });

      const counts = await getQueueCounts(EMPLOYEE);
      expect(counts.blockedCount).toBe(1);
      expect(counts.mayAffectServerCount).toBe(1);
    },
  );

  // The deadlock. This row is blocked on a deployment nobody on the device can
  // trigger, and it is kept forever, so counting it here would disable
  // automatic check-in permanently.
  it("does not count a row blocked on a missing endpoint", async () => {
    const { row } = await queuePunch();
    await markBlocked({
      id: row.id,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
    });

    const counts = await getQueueCounts(EMPLOYEE);
    // Still queued, still retried, still visible in history and the banner...
    expect(counts.awaitingServerCount).toBe(1);
    expect(counts.blockedCount).toBe(1);
    expect(counts.blockedUndeliverableCount).toBe(1);
    // ...just not treated as evidence about the server's session.
    expect(counts.mayAffectServerCount).toBe(0);
  });

  it("keeps counting a deliverable row alongside an undeliverable one", async () => {
    const stuck = await queuePunch({ timestamp: "2026-09-01 08:00:00" });
    await markBlocked({
      id: stuck.row.id,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
    });
    await queuePunch({ timestamp: "2026-09-01 12:29:00" });

    const counts = await getQueueCounts(EMPLOYEE);
    expect(counts.awaitingServerCount).toBe(2);
    expect(counts.mayAffectServerCount).toBe(1);
  });

  it("counts nothing once a row has synced", async () => {
    const { row } = await queuePunch();
    await markSynced({ id: row.id, serverCheckinId: "EMP-CKIN-1" });

    const counts = await getQueueCounts(EMPLOYEE);
    expect(counts.syncedCount).toBe(1);
    expect(counts.awaitingServerCount).toBe(0);
    expect(counts.mayAffectServerCount).toBe(0);
  });

  it("is scoped to the employee, like every other count", async () => {
    await queuePunch({ employeeId: OTHER_EMPLOYEE });

    expect((await getQueueCounts(EMPLOYEE)).mayAffectServerCount).toBe(0);
    expect((await getQueueCounts(OTHER_EMPLOYEE)).mayAffectServerCount).toBe(1);
  });
});
