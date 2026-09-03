/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js. The queue here is a real SQLite table.
 *
 * ---------------------------------------------------------------------------
 * The failure this suite exists for
 * ---------------------------------------------------------------------------
 *
 * Six punches on one employee's phone read "Pending sync" for a day, on a
 * device that was online and had synced that morning's check-in through the
 * ordinary API. `offlineStrandedQueue.test.js` covers the first cause of that —
 * a drain that declined to attempt anything because the OS captive-portal probe
 * said no internet. This suite covers what was left after that was fixed:
 *
 *  1. Nothing ever moved a `pending` row's `nextAttemptAt`. `wakeBlocked`
 *     handles `blocked`, `releaseStuckSyncing` handles `syncing`, and a pending
 *     row scheduled into the far future — which is what a device clock running
 *     ahead produces — stayed there.
 *  2. The drain claims strictly in order, so that one row held back every later
 *     punch the same employee had made. One stranded row, six frozen chips.
 *  3. There was no way to see any of it. A run that claimed nothing logged
 *     nothing, so "never attempted" and "attempted forty times" looked
 *     identical from the outside.
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

jest.mock("../services/offline/NetworkListener", () => ({
  __esModule: true,
  fetchIsOnline: jest.fn(() => Promise.resolve(true)),
  fetchShouldAttemptRequest: jest.fn(() => Promise.resolve(true)),
  isOnline: jest.fn(() => true),
}));

import {
  QUEUE_ACTION,
  QUEUE_STATUS,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  RETRY_DELAYS_MS,
  countByStatus,
  enqueue,
  findById,
  listAll,
  markRetry,
  peekNextRow,
  wakePending,
} from "../services/offline/AttendanceQueueRepository";
import {
  resetSyncService,
  syncPendingAttendance,
} from "../services/offline/AttendanceSyncService";
import { PUSH_RESULT, pushCheckin } from "../services/offline/AttendanceApi";

const { __resetAll } = require("../test-utils/expoSqliteMock");

const EMPLOYEE = "0202";
const MAX_LADDER_MS = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

/** The 2 Sep queue, as the employee's history screen showed it. */
const punch = (overrides = {}) => ({
  employeeId: EMPLOYEE,
  attendanceType: "manual",
  action: QUEUE_ACTION.CHECKIN,
  timestamp: "2026-09-02 05:13:00",
  ...overrides,
});

const accepted = (docname) => ({
  result: PUSH_RESULT.INSERTED,
  serverCheckinId: docname,
  message: "Attendance recorded",
  response: { inserted: [docname] },
});

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  jest.clearAllMocks();
  pushCheckin.mockReset();
});

describe("wakePending", () => {
  it("repairs a row scheduled beyond any real backoff", async () => {
    const { row } = await enqueue(punch());
    // What a phone whose clock ran a day ahead leaves behind when it corrects.
    await markRetry({ id: row.id, error: "Network Error", now: Date.now() + 86_400_000 });

    const before = await findById(row.id);
    expect(before.nextAttemptAt).toBeGreaterThan(Date.now() + MAX_LADDER_MS);

    expect(await wakePending()).toBe(1);
    expect((await findById(row.id)).nextAttemptAt).toBe(0);
  });

  // The ladder is the mechanism that stops the app hammering a server that is
  // having a bad afternoon. Repairing a clock artefact must not become a way
  // around it.
  it("leaves an honest backoff alone", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });

    const scheduled = (await findById(row.id)).nextAttemptAt;
    expect(scheduled).toBeGreaterThan(Date.now());

    expect(await wakePending()).toBe(0);
    expect((await findById(row.id)).nextAttemptAt).toBe(scheduled);
  });

  it("makes every pending row due when a person asks", async () => {
    const first = await enqueue(punch());
    const second = await enqueue(
      punch({ action: QUEUE_ACTION.CHECKOUT, timestamp: "2026-09-02 16:09:00" }),
    );
    await markRetry({ id: first.row.id, error: "Network Error" });
    await markRetry({ id: second.row.id, error: "Network Error" });

    expect(await wakePending({ force: true })).toBe(2);
    expect((await findById(first.row.id)).nextAttemptAt).toBe(0);
    expect((await findById(second.row.id)).nextAttemptAt).toBe(0);
  });

  it("does not touch blocked or rejected rows, which have their own schedules", async () => {
    const { row } = await enqueue(punch());
    const { markBlocked } = require("../services/offline/AttendanceQueueRepository");
    await markBlocked({ id: row.id, failureClass: "auth", error: "Not permitted" });

    const blockedNext = (await findById(row.id)).nextAttemptAt;
    expect(await wakePending({ force: true })).toBe(0);
    expect((await findById(row.id)).nextAttemptAt).toBe(blockedNext);
  });
});

describe("one stranded row no longer freezes the whole queue", () => {
  /**
   * The screenshot: an IN at 05:13 followed by five more punches, all reading
   * "Pending sync". Only the first is actually stuck — and because the drain
   * claims in order, that was enough to strand the rest indefinitely.
   */
  const seedTheDay = async () => {
    const head = await enqueue(punch({ timestamp: "2026-09-02 05:13:01" }));
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT, timestamp: "2026-09-02 05:13:20" }));
    await enqueue(punch({ timestamp: "2026-09-02 05:13:41" }));
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT, timestamp: "2026-09-02 16:09:00" }));

    // The head is scheduled past the end of the ladder — the clock artefact.
    await markRetry({
      id: head.row.id,
      error: "Network Error",
      now: Date.now() + 86_400_000,
    });

    return head.row.id;
  };

  it("drains all of them once the head is repaired", async () => {
    await seedTheDay();
    pushCheckin.mockImplementation((row) => Promise.resolve(accepted(`CI-${row.id}`)));

    const summary = await syncPendingAttendance({
      trigger: "launch",
      employeeId: EMPLOYEE,
    });

    expect(summary.wokenPending).toBe(1);
    expect(summary.synced).toBe(4);

    const rows = await listAll();
    expect(rows.every((row) => row.status === QUEUE_STATUS.SYNCED)).toBe(true);
  });

  // FIFO is correctness here, not tidiness: a check-out uploaded before its
  // check-in makes a session the backend cannot reconcile.
  it("still uploads them oldest first", async () => {
    await seedTheDay();
    pushCheckin.mockImplementation((row) => Promise.resolve(accepted(`CI-${row.id}`)));

    await syncPendingAttendance({ trigger: "launch", employeeId: EMPLOYEE });

    expect(pushCheckin.mock.calls.map(([row]) => row.timestamp)).toEqual([
      "2026-09-02 05:13:01",
      "2026-09-02 05:13:20",
      "2026-09-02 05:13:41",
      "2026-09-02 16:09:00",
    ]);
  });

  // What the pull-to-refresh on the history screen now does. The employee is
  // looking at the row and asking; waiting out its backoff is not an answer.
  it("attempts a row mid-backoff when the employee pulls to refresh", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });
    pushCheckin.mockResolvedValue(accepted("CI-1"));

    const ignored = await syncPendingAttendance({
      trigger: "interval",
      employeeId: EMPLOYEE,
    });
    expect(ignored.synced).toBe(0);
    expect(pushCheckin).not.toHaveBeenCalled();

    const pulled = await syncPendingAttendance({
      trigger: "history-pull-to-refresh",
      wakeAllBlocked: true,
      wakeAllPending: true,
      employeeId: EMPLOYEE,
    });

    expect(pulled.synced).toBe(1);
    expect((await findById(row.id)).status).toBe(QUEUE_STATUS.SYNCED);
  });

  // Another employee's punches are skipped, not woken. Scoping the drain is
  // what replaced clearing the queue on logout.
  it("wakes nobody else's rows", async () => {
    const mine = await enqueue(punch());
    const theirs = await enqueue(punch({ employeeId: "0303" }));
    await markRetry({ id: mine.row.id, error: "Network Error", now: Date.now() + 86_400_000 });
    await markRetry({ id: theirs.row.id, error: "Network Error", now: Date.now() + 86_400_000 });
    pushCheckin.mockImplementation((row) => Promise.resolve(accepted(`CI-${row.id}`)));

    await syncPendingAttendance({ trigger: "launch", employeeId: EMPLOYEE });

    expect((await findById(mine.row.id)).status).toBe(QUEUE_STATUS.SYNCED);
    expect((await findById(theirs.row.id)).status).toBe(QUEUE_STATUS.PENDING);
  });
});

describe("what support can see", () => {
  it("reports the head of the queue without claiming it", async () => {
    await enqueue(punch({ timestamp: "2026-09-02 16:09:00", action: QUEUE_ACTION.CHECKOUT }));
    const oldest = await enqueue(punch({ timestamp: "2026-09-02 05:13:01" }));

    const head = await peekNextRow({ employeeId: EMPLOYEE });

    expect(head.id).toBe(oldest.row.id);
    expect(head.status).toBe(QUEUE_STATUS.PENDING);
  });

  it("scopes the head to the employee asking", async () => {
    await enqueue(punch({ employeeId: "0303", timestamp: "2026-09-01 05:00:00" }));
    const mine = await enqueue(punch());

    expect((await peekNextRow({ employeeId: EMPLOYEE })).id).toBe(mine.row.id);
  });

  it("has no head to report on an empty queue", async () => {
    expect(await peekNextRow({ employeeId: EMPLOYEE })).toBeNull();
  });

  // How long a punch has been waiting is the difference between ordinary
  // queueing and a queue that has stopped moving, and the count alone could not
  // express it.
  it("dates the oldest punch still in motion", async () => {
    const createdAt = Date.now() - 3 * 60 * 60 * 1000;
    await enqueue(punch({ now: createdAt }));
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT, timestamp: "2026-09-02 16:09:00" }));

    const counts = await countByStatus(EMPLOYEE);

    expect(counts.pendingCount).toBe(2);
    expect(counts.oldestPendingAt).toBe(createdAt);
  });

  it("reports no date when nothing is waiting", async () => {
    expect((await countByStatus(EMPLOYEE)).oldestPendingAt).toBeNull();
  });

  it("logs a line for a run that claimed nothing", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });

    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncPendingAttendance({ trigger: "interval", employeeId: EMPLOYEE });

    // The whole point: this run is indistinguishable from no run at all from
    // outside the device, and it is the shape the stuck queue was in for a day.
    const runLine = log.mock.calls.find(([message]) =>
      String(message).includes("Run (interval)"),
    );
    log.mockRestore();

    expect(pushCheckin).not.toHaveBeenCalled();
    expect(runLine).toBeTruthy();
    // `ran: false` with a reason, because the row's backoff has not elapsed —
    // the run returned before touching the radio, which is what makes a
    // one-minute heartbeat affordable. The head row is still reported, which is
    // the whole point: a frozen queue must not look like an empty one.
    expect(runLine[1]).toMatchObject({
      ran: false,
      reason: "nothing-due",
      scope: EMPLOYEE,
    });
    expect(runLine[1].head).toMatchObject({
      id: row.id,
      status: QUEUE_STATUS.PENDING,
      attempts: 1,
      punchedAt: "2026-09-02 05:13:00",
    });
    // A real due time, so "waiting" and "never attempted" read differently.
    expect(runLine[1].head.nextAttemptAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("says nothing at all when the queue is empty", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncPendingAttendance({ trigger: "interval", employeeId: EMPLOYEE });
    const lines = log.mock.calls.filter(([message]) =>
      String(message).includes("Run ("),
    );
    log.mockRestore();

    // A one-minute heartbeat on an empty queue must not bury the lines that
    // matter. "No unresolved row and nothing happened" is the only silence.
    expect(lines).toHaveLength(0);
  });

  // What makes asking every minute affordable: an idle tick is one indexed
  // query, with no NetInfo call and no request behind it.
  it("does not touch the radio when nothing is due", async () => {
    const { fetchShouldAttemptRequest } = require("../services/offline/NetworkListener");
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });
    fetchShouldAttemptRequest.mockClear();

    const summary = await syncPendingAttendance({
      trigger: "interval",
      employeeId: EMPLOYEE,
    });

    expect(summary.reason).toBe("nothing-due");
    expect(fetchShouldAttemptRequest).not.toHaveBeenCalled();
    expect(pushCheckin).not.toHaveBeenCalled();
  });

  it("still asks the radio the moment a row comes due", async () => {
    const { fetchShouldAttemptRequest } = require("../services/offline/NetworkListener");
    await enqueue(punch());
    fetchShouldAttemptRequest.mockClear();
    pushCheckin.mockResolvedValue(accepted("CI-1"));

    await syncPendingAttendance({ trigger: "interval", employeeId: EMPLOYEE });

    expect(fetchShouldAttemptRequest).toHaveBeenCalled();
    expect(pushCheckin).toHaveBeenCalledTimes(1);
  });

  it("logs the head of a queue nothing has ever attempted", async () => {
    const { row } = await enqueue(punch());

    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    // No transport at all — the one case that still skips the drain entirely.
    const { fetchShouldAttemptRequest } = require("../services/offline/NetworkListener");
    fetchShouldAttemptRequest.mockResolvedValueOnce(false);

    const summary = await syncPendingAttendance({
      trigger: "launch",
      employeeId: EMPLOYEE,
    });

    const runLine = log.mock.calls.find(([message]) =>
      String(message).includes("Run (launch)"),
    );
    log.mockRestore();

    expect(summary.reason).toBe("offline");
    expect(runLine[1]).toMatchObject({ ran: false, reason: "offline" });
    expect(runLine[1].head).toMatchObject({
      id: row.id,
      attempts: 0,
      nextAttemptAt: "due",
    });
  });
});
