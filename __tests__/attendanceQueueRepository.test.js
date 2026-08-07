/**
 * @jest-environment jsdom
 *
 * jsdom, not the project default of node: the sql.js WASM runtime backing the
 * expo-sqlite mock cannot open a database under the node environment, and fails
 * with an empty error that explains nothing. See test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import {
  QUEUE_ACTION,
  QUEUE_STATUS,
  clearAttendanceQueue,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  claimNextPending,
  countByStatus,
  enqueue,
  findDuplicate,
  hasWorkDue,
  listForHistory,
  markFailed,
  markRetry,
  markSynced,
  purgeSynced,
  releaseStuckSyncing,
  retryDelayFor,
  retryFailed,
} from "../services/offline/AttendanceQueueRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * Runs against real SQLite, so the UNIQUE index and the atomic claim are
 * genuinely exercised rather than simulated.
 */
const punch = (overrides = {}) => ({
  employeeId: "TDI0167",
  attendanceType: "manual",
  action: QUEUE_ACTION.CHECKIN,
  timestamp: "2026-07-28 09:00:00",
  ...overrides,
});

beforeEach(async () => {
  __resetAll();
  resetDatabaseHandle();
});

describe("enqueue", () => {
  it("stores a punch as pending and due immediately", async () => {
    const { row, inserted } = await enqueue(punch());

    expect(inserted).toBe(true);
    expect(row).toMatchObject({
      employeeId: "TDI0167",
      action: QUEUE_ACTION.CHECKIN,
      status: QUEUE_STATUS.PENDING,
      retryCount: 0,
      nextAttemptAt: 0,
      duplicate: false,
    });
  });

  it("round-trips the payload as an object, not a JSON string", async () => {
    const { row } = await enqueue(
      punch({ payload: { location: "Doha HQ", over_time: 0 } }),
    );

    expect(row.payload).toEqual({ location: "Doha HQ", over_time: 0 });
  });

  // The local dedupe rule: one row per (employee, timestamp, action).
  it("does not insert the same punch twice", async () => {
    await enqueue(punch());
    const second = await enqueue(punch());

    expect(second.inserted).toBe(false);
    const counts = await countByStatus();
    expect(counts.total).toBe(1);
  });

  it("returns the existing row when the punch is already queued", async () => {
    const first = await enqueue(punch());
    const second = await enqueue(punch());

    expect(second.row.id).toBe(first.row.id);
  });

  it("keeps a check-out at the same instant as a separate row", async () => {
    await enqueue(punch());
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));

    const counts = await countByStatus();
    expect(counts.total).toBe(2);
  });

  it("keeps another employee's identical punch separate", async () => {
    await enqueue(punch());
    await enqueue(punch({ employeeId: "TDI0999" }));

    expect((await countByStatus()).total).toBe(2);
    expect((await countByStatus("TDI0167")).total).toBe(1);
  });

  // Two callers racing — a geofence EXIT and a tapped Check Out — must not both
  // insert. This is why the rule is a constraint and not a read-then-write check.
  it("survives concurrent enqueues of the same punch", async () => {
    const results = await Promise.all([
      enqueue(punch()),
      enqueue(punch()),
      enqueue(punch()),
    ]);

    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect((await countByStatus()).total).toBe(1);
  });

  it("rejects a punch with no employee rather than storing an orphan", async () => {
    await expect(enqueue(punch({ employeeId: null }))).rejects.toThrow(
      /employeeId is required/,
    );
  });
});

describe("claimNextPending", () => {
  it("claims oldest-first, because a check-out before its check-in is unreconcilable", async () => {
    await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    await enqueue(
      punch({
        timestamp: "2026-07-28 17:00:00",
        action: QUEUE_ACTION.CHECKOUT,
      }),
    );

    const first = await claimNextPending();
    expect(first.action).toBe(QUEUE_ACTION.CHECKIN);
  });

  it("flips the claimed row to syncing in the same statement", async () => {
    await enqueue(punch());
    const claimed = await claimNextPending();

    expect(claimed.status).toBe(QUEUE_STATUS.SYNCING);
  });

  // The lock in the sync service only covers one JS context. A background
  // relaunch running alongside the foreground app is a second one.
  it("never hands the same row to two concurrent claims", async () => {
    await enqueue(punch());

    const [a, b] = await Promise.all([claimNextPending(), claimNextPending()]);
    const claimed = [a, b].filter(Boolean);

    expect(claimed).toHaveLength(1);
  });

  it("returns null when the queue is empty", async () => {
    expect(await claimNextPending()).toBeNull();
  });

  it("skips a row whose backoff has not elapsed", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error", now: 1_000_000 });

    expect(await claimNextPending(1_000_000 + 1000)).toBeNull();
    expect(await claimNextPending(1_000_000 + RETRY_DELAYS_MS[0])).not.toBeNull();
  });
});

describe("retry scheduling", () => {
  it("follows the specified 30s / 2m / 10m escalation", () => {
    expect(retryDelayFor(0)).toBe(30 * 1000);
    expect(retryDelayFor(1)).toBe(2 * 60 * 1000);
    expect(retryDelayFor(2)).toBe(10 * 60 * 1000);
  });

  it("keeps escalating past the third attempt rather than repeating", () => {
    expect(retryDelayFor(3)).toBeGreaterThan(retryDelayFor(2));
    expect(retryDelayFor(99)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  });

  it("returns the row to pending with the counter advanced", async () => {
    const { row } = await enqueue(punch());
    const { retryCount, nextAttemptAt } = await markRetry({
      id: row.id,
      error: "Network Error",
      now: 5000,
    });

    expect(retryCount).toBe(1);
    expect(nextAttemptAt).toBe(5000 + 30 * 1000);

    const [stored] = await listForHistory({});
    expect(stored.status).toBe(QUEUE_STATUS.PENDING);
    expect(stored.error).toBe("Network Error");
  });

  it("caps at five retries", () => {
    expect(MAX_RETRIES).toBe(5);
  });
});

describe("markSynced", () => {
  it("records the server's docname and clears any earlier error", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });
    await markSynced({
      id: row.id,
      serverCheckinId: "EMP-CKIN-07-2026-000078",
      serverResponse: { status: "success" },
    });

    const [stored] = await listForHistory({
      statuses: [QUEUE_STATUS.SYNCED],
    });

    expect(stored).toMatchObject({
      status: QUEUE_STATUS.SYNCED,
      serverCheckinId: "EMP-CKIN-07-2026-000078",
      error: null,
      duplicate: false,
    });
    expect(stored.serverResponse).toEqual({ status: "success" });
  });

  // "Already logged" is the expected outcome of a retry that was always going to
  // be redundant, so it is stored as success with the reason recorded.
  it("stores a duplicate as synced, flagged, with the server's wording", async () => {
    const { row } = await enqueue(punch());
    await markSynced({
      id: row.id,
      duplicate: true,
      duplicateMessage: "This employee already has a log with the same timestamp.",
    });

    const [stored] = await listForHistory({ statuses: [QUEUE_STATUS.SYNCED] });

    expect(stored.status).toBe(QUEUE_STATUS.SYNCED);
    expect(stored.duplicate).toBe(true);
    expect(stored.duplicateMessage).toMatch(/already has a log/);
  });
});

describe("failure handling", () => {
  it("keeps a failed row as evidence rather than deleting it", async () => {
    const { row } = await enqueue(punch());
    await markFailed({ id: row.id, error: "Employee is inactive" });

    const [stored] = await listForHistory({});
    expect(stored.status).toBe(QUEUE_STATUS.FAILED);
    expect(stored.error).toBe("Employee is inactive");
  });

  it("requeues a failed row on manual retry, due immediately", async () => {
    const { row } = await enqueue(punch());
    await markRetry({ id: row.id, error: "Network Error" });
    await markFailed({ id: row.id, error: "Gave up" });

    expect(await retryFailed({ id: row.id })).toBe(1);

    const claimed = await claimNextPending();
    expect(claimed.id).toBe(row.id);
    expect(claimed.retryCount).toBe(0);
  });

  it("leaves non-failed rows alone when retrying everything", async () => {
    const { row: failedRow } = await enqueue(punch());
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));
    await markFailed({ id: failedRow.id, error: "nope" });

    expect(await retryFailed()).toBe(1);
  });
});

// A process killed mid-request leaves a row `syncing` forever — nothing would
// ever claim it again, so the punch would sit invisible and unsent.
describe("releaseStuckSyncing", () => {
  it("returns an abandoned syncing row to the queue", async () => {
    await enqueue(punch());
    await claimNextPending();

    expect(await claimNextPending()).toBeNull();
    expect(await releaseStuckSyncing()).toBe(1);
    expect(await claimNextPending()).not.toBeNull();
  });
});

describe("purgeSynced", () => {
  it("drops synced rows past the retention window", async () => {
    const { row } = await enqueue(punch());
    await markSynced({ id: row.id, now: 1000 });

    const removed = await purgeSynced({
      olderThanMs: 100,
      now: 1000 + 500,
    });

    expect(removed).toBe(1);
    expect((await countByStatus()).total).toBe(0);
  });

  it("never ages out a failed row, however old — it is unresolved business", async () => {
    const { row } = await enqueue(punch());
    await markFailed({ id: row.id, error: "nope", now: 1000 });

    await purgeSynced({ olderThanMs: 1, now: 10_000_000 });

    expect((await countByStatus()).total).toBe(1);
  });
});

describe("reads", () => {
  it("excludes synced rows from the queue's own view", async () => {
    const { row } = await enqueue(punch());
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));
    await markSynced({ id: row.id });

    const rows = await listForHistory({});
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(QUEUE_ACTION.CHECKOUT);
  });

  it("reports every status key even when the queue is empty", async () => {
    const counts = await countByStatus();

    expect(counts).toMatchObject({
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      total: 0,
      unsynced: 0,
    });
  });

  it("counts pending, syncing and failed as unsynced, but not synced", async () => {
    const { row: a } = await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    await enqueue(punch({ timestamp: "2026-07-28 10:00:00" }));
    const { row: c } = await enqueue(punch({ timestamp: "2026-07-28 11:00:00" }));

    await markSynced({ id: a.id });
    await markFailed({ id: c.id, error: "nope" });

    const counts = await countByStatus();
    expect(counts.unsynced).toBe(2);
    expect(counts.synced).toBe(1);
  });

  it("finds an existing punch by its dedupe identity", async () => {
    await enqueue(punch());

    const found = await findDuplicate({
      employeeId: "TDI0167",
      timestamp: "2026-07-28 09:00:00",
      action: QUEUE_ACTION.CHECKIN,
    });

    expect(found).not.toBeNull();
  });

  it("reports whether a drain has anything due", async () => {
    expect(await hasWorkDue()).toBe(false);
    await enqueue(punch());
    expect(await hasWorkDue()).toBe(true);
  });
});

describe("clearAttendanceQueue", () => {
  // A queued punch outliving its employee would sync under the next user's
  // token — attendance filed against the wrong person.
  it("empties the queue on logout", async () => {
    await enqueue(punch());
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));

    await clearAttendanceQueue();

    expect((await countByStatus()).total).toBe(0);
  });
});
