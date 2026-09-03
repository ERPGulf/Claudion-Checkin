/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));

// The only two seams stubbed. Everything between the queue and the HTTP call —
// the repository, the sync service, the row-state machine, the response
// interpretation — is the real implementation, because the bug lived in how
// those fit together rather than in any one of them.
jest.mock("../services/api/apiClient", () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
}));

jest.mock("../services/offline/NetworkListener", () => ({
  fetchIsOnline: jest.fn(() => Promise.resolve(true)),
  fetchShouldAttemptRequest: jest.fn(() => Promise.resolve(true)),
  isOnline: () => true,
  addReconnectListener: () => () => {},
  startNetworkListener: jest.fn(),
  stopNetworkListener: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../services/api/apiClient";
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
} from "../services/offline/AttendanceQueueRepository";
import {
  clearOfflineAttendance,
  getQueueCounts,
  submitAutoAttendance,
} from "../services/offline/AttendanceQueueService";
import {
  resetSyncService,
  syncPendingAttendance,
} from "../services/offline/AttendanceSyncService";
import { resetServerClockCache } from "../utils/serverClock";
import {
  applySessionOwner,
  readSession,
  SESSION_ORIGIN,
  SESSION_STATUS,
  performSessionTransition,
} from "../utils/attendanceSessionState";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * The production incident, driven end to end through the real components.
 *
 *   automatic IN (online)
 *     → geofence EXIT while offline → OUT queued
 *     → token expires → forced logout deletes nothing
 *     → the same employee logs in again
 *     → the OUT uploads under the NEW token
 *     → the server's session closes
 *     → reconciliation is free to open a fresh session
 *
 * The unit suites pin each link. This one pins that the chain holds, because
 * every individual piece was correct before the incident too — what failed was
 * the seam between authentication and the queue.
 */

const EMPLOYEE = "HR-EMP-00011";
const OTHER_EMPLOYEE = "HR-EMP-00099";

const EXPIRED_TOKEN = "expired-token-aaa";
const FRESH_TOKEN = "fresh-token-bbb";

/** The bulk endpoint accepting one record. */
const accepted = (name = "EMP-CKIN-09-2026-000006") => ({
  data: { message: { inserted: [name], failed: [] } },
});

const login = async (token) => {
  await AsyncStorage.setItem("baseUrl", "https://aysha.erpgulf.com");
  await AsyncStorage.setItem("access_token", token);
};

/** What apiClient's expireSession() does to storage, plus its cleanup hook. */
const expireSessionAndLogout = async () => {
  await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
  await clearOfflineAttendance();
};

const queueCheckout = (employeeId = EMPLOYEE) =>
  enqueue({
    employeeId,
    employeeDocname: employeeId,
    attendanceType: "auto",
    action: QUEUE_ACTION.CHECKOUT,
    timestamp: "2026-09-01 12:29:00",
    deviceId: "MobileAPP",
    payload: { over_time: 0 },
  });

beforeEach(async () => {
  jest.clearAllMocks();
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  resetServerClockCache();
  await AsyncStorage.clear();
});

/**
 * Enough cached configuration for the offline gate to accept a punch. The
 * geofence path skips the radius test, so all it needs is a blob with a
 * `locations` array — the marker for "this device has been online at least
 * once".
 */
const cacheConfig = () =>
  AsyncStorage.setItem(
    "attendanceConfigCache",
    JSON.stringify({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      locations: [],
      rules: { restrictLocation: 0, unrestrictedCheckoutLocation: 0 },
    }),
  );

/**
 * Local-time epoch, so `formatOfflineTimestamp` (which formats in local time)
 * produces the literal string these tests compare against whatever timezone the
 * suite runs in.
 */
const localAt = (hour, minute) =>
  new Date(2026, 8, 1, hour, minute, 0).getTime();

describe("expiry → queued OUT → re-login → sync", () => {
  it("carries the check-out across the logout and files it under the new token", async () => {
    await login(EXPIRED_TOKEN);

    // 07:54 — automatic check-in, online and confirmed.
    await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => ({ allowed: true, name: "EMP-CKIN-09-2026-000005" }),
    });

    // 12:29 — geofence EXIT with no signal. The queue accepts it; the server
    // never hears about it.
    const outcome = await performSessionTransition({
      type: "OUT",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => {
        await queueCheckout();
        return { allowed: true, queued: true };
      },
    });
    expect(outcome.queued).toBe(true);
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);

    // 12:40 — the token has expired and the refresh fails.
    await expireSessionAndLogout();

    // The punch is still here. This is the assertion the incident turned on.
    const afterLogout = await listAll();
    expect(afterLogout).toHaveLength(1);
    expect(afterLogout[0].status).toBe(QUEUE_STATUS.PENDING);

    // The employee logs back in. New token, same person.
    await login(FRESH_TOKEN);
    apiClient.post.mockResolvedValue(accepted());

    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect(summary.synced).toBe(1);

    // Uploaded with the credentials from *after* the recovery, not the dead ones
    // the row was created under.
    const [, body, config] = apiClient.post.mock.calls[0];
    expect(config.headers.Authorization).toBe(`Bearer ${FRESH_TOKEN}`);
    expect(body.logs[0]).toMatchObject({
      employee: EMPLOYEE,
      log_type: "OUT",
      timestamp: "2026-09-01 12:29:00",
    });

    // The row is resolved, not merely retried.
    const rows = await listAll();
    expect(rows[0].status).toBe(QUEUE_STATUS.SYNCED);
    expect(rows[0].serverCheckinId).toBe("EMP-CKIN-09-2026-000006");

    // And the guard that stops a duplicate IN is now satisfied, so presence
    // reconciliation may legitimately open a new session.
    const counts = await getQueueCounts(EMPLOYEE);
    expect(counts.awaitingServerCount).toBe(0);
    expect(counts.mayAffectServerCount).toBe(0);
  });

  it("holds the guard shut for as long as the check-out is undelivered", async () => {
    await login(EXPIRED_TOKEN);
    await queueCheckout();
    await expireSessionAndLogout();

    // Still logged out: nothing has uploaded, so the server still believes the
    // morning's session is open and a new IN would duplicate it.
    expect((await getQueueCounts(EMPLOYEE)).mayAffectServerCount).toBe(1);
  });

  it("does not upload anything while no employee is authenticated", async () => {
    await login(EXPIRED_TOKEN);
    await queueCheckout();
    await expireSessionAndLogout();

    // `employeeId: null` is what BackgroundSyncManager refuses to pass; this
    // asserts the layer below would still have something to upload if it did.
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(await listAll()).toHaveLength(1);
  });
});

describe("employee switch", () => {
  it("does not let the new employee upload the previous one's punch", async () => {
    await login(EXPIRED_TOKEN);
    await applySessionOwner(OTHER_EMPLOYEE);
    await queueCheckout(OTHER_EMPLOYEE);

    // Employee A logs out, employee B logs in.
    await expireSessionAndLogout();
    await login(FRESH_TOKEN);
    apiClient.post.mockResolvedValue(accepted());

    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(summary.synced).toBe(0);

    // A's punch is untouched and still theirs.
    const rows = await listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe(OTHER_EMPLOYEE);
    expect(rows[0].status).toBe(QUEUE_STATUS.PENDING);
  });

  it("gives the new employee a clean session and leaves the old one's queued", async () => {
    await login(EXPIRED_TOKEN);
    await applySessionOwner(OTHER_EMPLOYEE);
    await performSessionTransition({
      type: "IN",
      origin: SESSION_ORIGIN.AUTO,
      execute: async () => ({ allowed: true, name: "EMP-CKIN-A" }),
    });
    await queueCheckout(OTHER_EMPLOYEE);
    await expireSessionAndLogout();

    // Employee B logs in on the same device.
    await login(FRESH_TOKEN);
    const cleared = await applySessionOwner(EMPLOYEE);

    expect(cleared).toBe(true);
    // B does not inherit A's open shift...
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    // ...and A's punch is still waiting for A, not discarded.
    expect((await getQueueCounts(OTHER_EMPLOYEE)).mayAffectServerCount).toBe(1);
    // B's own guard is clear, so B's automatic attendance works normally.
    expect((await getQueueCounts(EMPLOYEE)).mayAffectServerCount).toBe(0);
  });

  it("lets the new employee's own punches sync as usual", async () => {
    await login(EXPIRED_TOKEN);
    await queueCheckout(OTHER_EMPLOYEE);

    await login(FRESH_TOKEN);
    await applySessionOwner(EMPLOYEE);
    await queueCheckout(EMPLOYEE);
    apiClient.post.mockResolvedValue(accepted());

    const summary = await syncPendingAttendance({ employeeId: EMPLOYEE });

    expect(summary.synced).toBe(1);
    const [, body] = apiClient.post.mock.calls[0];
    expect(body.logs[0].employee).toBe(EMPLOYEE);

    const rows = await listAll();
    const mine = rows.find((row) => row.employeeId === EMPLOYEE);
    const theirs = rows.find((row) => row.employeeId === OTHER_EMPLOYEE);
    expect(mine.status).toBe(QUEUE_STATUS.SYNCED);
    expect(theirs.status).toBe(QUEUE_STATUS.PENDING);
  });
});

/**
 * The ENTER-versus-drain race.
 *
 * At login the effect registers the geofence, and the OS answers an immediate
 * ENTER from its initial-state check. That ENTER runs on the same JS context as
 * the startup drain and can win. If it does, and the employee still has an
 * undelivered check-out from earlier, sending the check-in straight to the
 * server puts an IN on top of a session the server has not been told to close —
 * the original incident, arriving by a different route.
 *
 * The fix is ordering rather than refusal: the check-in is real and the OS will
 * not deliver it again, so it goes into the queue behind the check-out instead
 * of being dropped.
 *
 * These assert the *submitted order*, not merely that both punches survive.
 */
describe("an automatic IN cannot overtake an undelivered punch", () => {
  /** log_type of each record, in the order it reached the server. */
  const submittedOrder = () =>
    apiClient.post.mock.calls.map(([, body]) => body.logs[0].log_type);

  const enterWhileQueued = async ({ forceQueue }) => {
    const online = jest.fn(() =>
      Promise.resolve({ allowed: true, name: "EMP-CKIN-DIRECT" }),
    );

    const result = await submitAutoAttendance({
      type: "IN",
      employeeCode: EMPLOYEE,
      occurredAt: localAt(12, 40),
      forceQueue,
      online,
    });

    return { result, online };
  };

  it("queues the IN behind the OUT and submits them in that order", async () => {
    await login(FRESH_TOKEN);
    await cacheConfig();

    // 12:29 — the check-out that never reached the server.
    await queueCheckout();

    // 12:40 — the OS delivers ENTER the moment the fence is registered.
    const { result, online } = await enterWhileQueued({ forceQueue: true });

    // The crossing was accepted, not dropped...
    expect(result.allowed).toBe(true);
    expect(result.queued).toBe(true);
    // ...and deliberately not sent, even though the connection was fine.
    expect(online).not.toHaveBeenCalled();

    apiClient.post.mockResolvedValue(accepted());
    await syncPendingAttendance({ employeeId: EMPLOYEE });

    // The assertion the release turns on.
    expect(submittedOrder()).toEqual(["OUT", "IN"]);

    const rows = await listAll();
    expect(rows.every((row) => row.status === QUEUE_STATUS.SYNCED)).toBe(true);
  });

  it("keeps the order when several punches are outstanding", async () => {
    await login(FRESH_TOKEN);
    await cacheConfig();

    // A whole offline morning, enqueued out of order on purpose.
    await enqueue({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      attendanceType: "auto",
      action: QUEUE_ACTION.CHECKOUT,
      timestamp: "2026-09-01 12:29:00",
      deviceId: "MobileAPP",
      payload: {},
    });
    await enqueue({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      attendanceType: "auto",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-09-01 07:54:00",
      deviceId: "MobileAPP",
      payload: {},
    });

    await enterWhileQueued({ forceQueue: true });

    apiClient.post.mockResolvedValue(accepted());
    await syncPendingAttendance({ employeeId: EMPLOYEE });

    // Chronological, not insertion order — the 07:54 IN was enqueued last.
    expect(submittedOrder()).toEqual(["IN", "OUT", "IN"]);
  });

  // Head-of-line ordering has to hold against the status machine too, not just
  // against timestamps: a newer *pending* row must not slip past an older row
  // that is merely blocked.
  it("will not claim a newer IN while an older OUT is blocked", async () => {
    const { row } = await queueCheckout();
    await markBlocked({ id: row.id, failureClass: FAILURE_CLASS.AUTH });

    await enqueue({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      attendanceType: "auto",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-09-01 12:40:00",
      deviceId: "MobileAPP",
      payload: {},
    });

    expect(await claimNextPending(Date.now(), { employeeId: EMPLOYEE })).toBeNull();
  });

  // ...unless the older row can never be delivered at all, in which case
  // blocking on it would strand the employee's queue forever.
  it("claims the IN when the older OUT is blocked on a missing endpoint", async () => {
    const { row } = await queueCheckout();
    await markBlocked({
      id: row.id,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
    });

    await enqueue({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      attendanceType: "auto",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-09-01 12:40:00",
      deviceId: "MobileAPP",
      payload: {},
    });

    const claimed = await claimNextPending(Date.now(), { employeeId: EMPLOYEE });
    expect(claimed?.action).toBe(QUEUE_ACTION.CHECKIN);
  });

  it("does not delay another employee's punch", async () => {
    await queueCheckout(OTHER_EMPLOYEE); // older, and undelivered

    await enqueue({
      employeeId: EMPLOYEE,
      employeeDocname: EMPLOYEE,
      attendanceType: "auto",
      action: QUEUE_ACTION.CHECKIN,
      timestamp: "2026-09-01 12:40:00",
      deviceId: "MobileAPP",
      payload: {},
    });

    // Ordering is per employee; A's stuck punch must not hold up B's.
    const claimed = await claimNextPending(Date.now(), { employeeId: EMPLOYEE });
    expect(claimed?.employeeId).toBe(EMPLOYEE);
  });

  it("still goes straight online when nothing is outstanding", async () => {
    await login(FRESH_TOKEN);

    const { result, online } = await enterWhileQueued({ forceQueue: false });

    expect(online).toHaveBeenCalledTimes(1);
    expect(result.name).toBe("EMP-CKIN-DIRECT");
    expect(result.queued).toBeUndefined();
    expect(await listAll()).toHaveLength(0);
  });

  // Ordering is not worth losing a crossing over. If the queue cannot take the
  // punch, sending it is the lesser harm.
  it("sends a forced IN rather than losing it when the queue refuses", async () => {
    await login(FRESH_TOKEN);
    // No cached configuration, so the offline gate refuses to queue.
    const { result, online } = await enterWhileQueued({ forceQueue: true });

    expect(online).toHaveBeenCalledTimes(1);
    expect(result.allowed).toBe(true);
    expect(await listAll()).toHaveLength(0);
  });
});
