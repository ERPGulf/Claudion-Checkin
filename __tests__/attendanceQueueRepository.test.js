/**
 * @jest-environment jsdom
 *
 * jsdom, not the project default of node: the sql.js WASM runtime backing the
 * expo-sqlite mock cannot open a database under the node environment, and fails
 * with an empty error that explains nothing. See test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import {
  FAILURE_CLASS,
  QUEUE_ACTION,
  QUEUE_STATUS,
  clearAttendanceQueue,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  BLOCKED_DELAYS_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  blockedDelayFor,
  claimNextPending,
  countByStatus,
  enqueue,
  findById,
  findDuplicate,
  hasWorkDue,
  listForHistory,
  listUnresolved,
  markBlocked,
  markRejected,
  markResolved,
  markRetry,
  markSynced,
  pairWithOpenCheckin,
  purgeSynced,
  releaseStuckSyncing,
  retryDelayFor,
  wakeBlocked,
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
  // Front-loaded: most transient failures are a lift or a few seconds of bad
  // signal, and a punch that could land five seconds later should.
  it("retries within seconds, then escalates", () => {
    expect(retryDelayFor(0)).toBe(5 * 1000);
    expect(retryDelayFor(1)).toBe(15 * 1000);
    expect(retryDelayFor(2)).toBe(45 * 1000);
  });

  it("keeps escalating past the third attempt rather than repeating", () => {
    expect(retryDelayFor(3)).toBeGreaterThan(retryDelayFor(2));
    expect(retryDelayFor(99)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  });

  // The ceiling is five minutes rather than an hour, so a longer-lived failure
  // still gets a dozen attempts inside the window instead of two.
  it("settles at five minutes", () => {
    expect(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]).toBe(5 * 60 * 1000);
  });

  it("returns the row to pending with the counter advanced", async () => {
    const { row } = await enqueue(punch());
    const { retryCount, nextAttemptAt } = await markRetry({
      id: row.id,
      error: "Network Error",
      now: 5000,
    });

    expect(retryCount).toBe(1);
    expect(nextAttemptAt).toBe(5000 + 5 * 1000);

    const [stored] = await listForHistory({});
    expect(stored.status).toBe(QUEUE_STATUS.PENDING);
    expect(stored.error).toBe("Network Error");
  });

  // What matters is the wall-clock window before a row is parked as `blocked`
  // (which shows the employee an administrator banner), not the attempt count.
  // Fifteen attempts on this ladder spans a little under an hour — the same
  // patience the old five-attempt slow ladder had, spent as quick tries.
  it("keeps trying for about an hour before parking the row", () => {
    expect(MAX_RETRIES).toBe(15);

    const window = Array.from({ length: MAX_RETRIES }, (_, attempt) =>
      retryDelayFor(attempt),
    ).reduce((total, delay) => total + delay, 0);

    expect(window).toBeGreaterThan(45 * 60 * 1000);
    expect(window).toBeLessThan(75 * 60 * 1000);
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

describe("blocked rows", () => {
  it("keeps the record and schedules a slow retry", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({
      id: row.id,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
      error: "has no attribute 'add_offline_employee_checkins'",
      now: 1_000_000,
    });

    const stored = await findById(row.id);
    expect(stored.status).toBe(QUEUE_STATUS.BLOCKED);
    expect(stored.failureClass).toBe(FAILURE_CLASS.ENDPOINT_MISSING);
    expect(stored.blockedSince).toBe(1_000_000);
    expect(stored.nextAttemptAt).toBe(1_000_000 + BLOCKED_DELAYS_MS[0]);
  });

  // The transient counter drives a cap; a blocked row must never age into a
  // terminal state, so it must not advance that counter.
  it("does not advance the transient retry counter", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({ id: row.id });

    expect((await findById(row.id)).retryCount).toBe(0);
  });

  it("is not claimable until it is woken", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({ id: row.id });

    expect(await claimNextPending()).toBeNull();
  });

  it("decays to a one-hour floor and stays there", async () => {
    expect(blockedDelayFor(0)).toBe(60 * 1000);
    expect(blockedDelayFor(99)).toBe(60 * 60 * 1000);
  });

  // The ladder is positioned by elapsed blocked time, so waking a row early
  // cannot walk it down to the floor faster than real time does.
  it("keeps its original blockedSince across repeated blocks", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({ id: row.id, now: 1_000_000 });
    await markBlocked({ id: row.id, now: 1_000_000 + 60_000 });

    expect((await findById(row.id)).blockedSince).toBe(1_000_000);
  });
});

describe("waking blocked rows", () => {
  it("respects the backoff on a scheduled wake", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({ id: row.id, now: 1_000_000 });

    expect(await wakeBlocked({ now: 1_000_000 + 1000 })).toBe(0);
    expect(
      await wakeBlocked({ now: 1_000_000 + BLOCKED_DELAYS_MS[0] }),
    ).toBe(1);
  });

  // Launch, reconnect and token refresh are the events that genuinely change
  // the odds, so they ignore the ladder entirely.
  it("ignores the backoff when forced", async () => {
    const { row } = await enqueue(punch());
    await markBlocked({ id: row.id, now: 1_000_000 });

    expect(await wakeBlocked({ force: true, now: 1_000_000 + 1 })).toBe(1);
    expect((await findById(row.id)).status).toBe(QUEUE_STATUS.PENDING);
  });

  // A fresh token says nothing about an endpoint that is still not deployed.
  it("can wake only one failure class", async () => {
    const { row: authRow } = await enqueue(punch());
    const { row: endpointRow } = await enqueue(
      punch({ action: QUEUE_ACTION.CHECKOUT }),
    );

    await markBlocked({ id: authRow.id, failureClass: FAILURE_CLASS.AUTH });
    await markBlocked({
      id: endpointRow.id,
      failureClass: FAILURE_CLASS.ENDPOINT_MISSING,
    });

    const woken = await wakeBlocked({
      force: true,
      failureClass: FAILURE_CLASS.AUTH,
    });

    expect(woken).toBe(1);
    expect((await findById(authRow.id)).status).toBe(QUEUE_STATUS.PENDING);
    expect((await findById(endpointRow.id)).status).toBe(QUEUE_STATUS.BLOCKED);
  });
});

describe("rejected rows and the session cascade", () => {
  /** Queues a check-in and a check-out, paired as one attendance session. */
  const queueSession = async () => {
    const { row: checkin } = await enqueue(
      punch({ timestamp: "2026-07-28 09:00:00" }),
    );
    const { row: checkout } = await enqueue(
      punch({
        timestamp: "2026-07-28 17:00:00",
        action: QUEUE_ACTION.CHECKOUT,
      }),
    );
    await pairWithOpenCheckin({
      checkoutId: checkout.id,
      employeeId: "TDI0167",
      timestamp: "2026-07-28 17:00:00",
    });
    return { checkin, checkout };
  };

  it("pairs a check-out with the check-in it closes", async () => {
    const { checkin, checkout } = await queueSession();

    const storedIn = await findById(checkin.id);
    const storedOut = await findById(checkout.id);

    expect(storedIn.pairedAttendanceId).toBe(checkout.id);
    expect(storedOut.pairedAttendanceId).toBe(checkin.id);
    expect(storedIn.sessionId).toBe(storedOut.sessionId);
  });

  // The data-integrity rule: uploading the OUT alone would leave the server
  // holding a check-out with no matching check-in.
  it("cascades a rejected check-in to its check-out", async () => {
    const { checkin, checkout } = await queueSession();

    const { cascaded } = await markRejected({
      id: checkin.id,
      error: "Employee is inactive",
    });

    expect(cascaded).toBe(1);
    const storedOut = await findById(checkout.id);
    expect(storedOut.status).toBe(QUEUE_STATUS.REJECTED);
    expect(storedOut.failureClass).toBe(FAILURE_CLASS.DEPENDENT);
    expect(storedOut.error).toMatch(/Dependent on rejected check-in/);
  });

  it("never uploads the orphaned check-out — it is no longer claimable", async () => {
    const { checkin } = await queueSession();
    await markRejected({ id: checkin.id, error: "Employee is inactive" });

    expect(await claimNextPending()).toBeNull();
  });

  // A punch already on the server is a fact and cannot be un-sent.
  it("does not cascade onto a pair that already synced", async () => {
    const { checkin, checkout } = await queueSession();
    await markSynced({ id: checkout.id, serverCheckinId: "EMP-CKIN-1" });

    const { cascaded } = await markRejected({ id: checkin.id, error: "nope" });

    expect(cascaded).toBe(0);
    expect((await findById(checkout.id)).status).toBe(QUEUE_STATUS.SYNCED);
  });

  // A check-out whose check-in synced online has no local pair, and that is
  // normal — the server already holds the other half.
  it("leaves a standalone check-out unpaired and claimable", async () => {
    const { row } = await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));

    const paired = await pairWithOpenCheckin({
      checkoutId: row.id,
      employeeId: "TDI0167",
      timestamp: row.timestamp,
    });

    expect(paired).toBeNull();
    expect(await claimNextPending()).not.toBeNull();
  });

  it("stops retrying a rejected row", async () => {
    const { row } = await enqueue(punch());
    await markRejected({ id: row.id, error: "Employee is inactive" });

    expect(await claimNextPending()).toBeNull();
    expect(await wakeBlocked({ force: true })).toBe(0);
  });
});

describe("resolving with a correction", () => {
  it("resolves both halves of the session, so one request covers it", async () => {
    const { row: checkin } = await enqueue(
      punch({ timestamp: "2026-07-28 09:00:00" }),
    );
    const { row: checkout } = await enqueue(
      punch({ timestamp: "2026-07-28 17:00:00", action: QUEUE_ACTION.CHECKOUT }),
    );
    await pairWithOpenCheckin({
      checkoutId: checkout.id,
      employeeId: "TDI0167",
      timestamp: "2026-07-28 17:00:00",
    });
    await markRejected({ id: checkin.id, error: "Employee is inactive" });

    const changed = await markResolved({
      id: checkin.id,
      resolutionDocname: "HR-ATT-REQ-0001",
    });

    expect(changed).toBe(2);
    expect((await findById(checkin.id)).resolutionDocname).toBe(
      "HR-ATT-REQ-0001",
    );
    expect((await findById(checkout.id)).status).toBe(QUEUE_STATUS.RESOLVED);
  });

  // Preserved, not deleted: it is the evidence of what was originally punched,
  // and payroll disputes are settled with exactly that.
  it("keeps the record after resolving it", async () => {
    const { row } = await enqueue(punch());
    await markRejected({ id: row.id, error: "nope" });
    await markResolved({ id: row.id, resolutionDocname: "HR-ATT-REQ-0002" });

    const stored = await findById(row.id);
    expect(stored).not.toBeNull();
    expect(stored.timestamp).toBe("2026-07-28 09:00:00");
  });

  it("does not resolve a row that was never rejected", async () => {
    const { row } = await enqueue(punch());
    expect(await markResolved({ id: row.id })).toBe(0);
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

  it.each([
    ["blocked", async (id) => markBlocked({ id, now: 1000 })],
    ["rejected", async (id) => markRejected({ id, error: "nope", now: 1000 })],
  ])("never ages out a %s row, however old", async (_label, mark) => {
    const { row } = await enqueue(punch());
    await mark(row.id);

    await purgeSynced({ olderThanMs: 1, now: 10_000_000 });

    expect((await countByStatus()).total).toBe(1);
  });
});

describe("reads", () => {
  it("lists only rows still needing an outcome", async () => {
    const { row } = await enqueue(punch());
    await enqueue(punch({ action: QUEUE_ACTION.CHECKOUT }));
    await markSynced({ id: row.id });

    const rows = await listUnresolved({});
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(QUEUE_ACTION.CHECKOUT);
  });

  it("includes synced rows in the history view, so a punch never blinks out", async () => {
    const { row } = await enqueue(punch());
    await markSynced({ id: row.id });

    expect(await listForHistory({})).toHaveLength(1);
  });

  // Regression: the history call site used to enumerate statuses itself, and
  // kept naming `failed` after the split — which dropped blocked and rejected
  // rows out of the employee's own attendance history.
  it("shows every state the timeline draws a chip for", async () => {
    const { row: blocked } = await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    const { row: rejected } = await enqueue(punch({ timestamp: "2026-07-28 10:00:00" }));
    const { row: resolved } = await enqueue(punch({ timestamp: "2026-07-28 11:00:00" }));
    const { row: synced } = await enqueue(punch({ timestamp: "2026-07-28 12:00:00" }));
    await enqueue(punch({ timestamp: "2026-07-28 13:00:00" })); // pending

    await markBlocked({ id: blocked.id });
    await markRejected({ id: rejected.id, error: "nope" });
    await markRejected({ id: resolved.id, error: "nope" });
    await markResolved({ id: resolved.id, resolutionDocname: "HR-ATT-REQ-1" });
    await markSynced({ id: synced.id });

    const statuses = (await listForHistory({})).map((r) => r.status).sort();

    expect(statuses).toEqual([
      QUEUE_STATUS.BLOCKED,
      QUEUE_STATUS.PENDING,
      QUEUE_STATUS.REJECTED,
      QUEUE_STATUS.RESOLVED,
      QUEUE_STATUS.SYNCED,
    ].sort());
  });

  it("reports every status key even when the queue is empty", async () => {
    const counts = await countByStatus();

    expect(counts).toMatchObject({
      pendingCount: 0,
      syncingCount: 0,
      syncedCount: 0,
      blockedCount: 0,
      rejectedCount: 0,
      resolvedCount: 0,
      unresolvedCount: 0,
      awaitingServerCount: 0,
      total: 0,
    });
  });

  /**
   * The two derived totals differ by exactly one status, and that difference is
   * load-bearing: `awaitingServerCount` feeds the attendance screen's reconnect
   * guard, and counting a rejected row there would hold a session open forever
   * on the strength of a punch the server has already refused.
   */
  it("separates 'still unresolved' from 'the server might still take it'", async () => {
    const { row: synced } = await enqueue(punch({ timestamp: "2026-07-28 09:00:00" }));
    await enqueue(punch({ timestamp: "2026-07-28 10:00:00" })); // pending
    const { row: blocked } = await enqueue(punch({ timestamp: "2026-07-28 11:00:00" }));
    const { row: rejected } = await enqueue(punch({ timestamp: "2026-07-28 12:00:00" }));

    await markSynced({ id: synced.id });
    await markBlocked({ id: blocked.id });
    await markRejected({ id: rejected.id, error: "Employee is inactive" });

    const counts = await countByStatus();

    expect(counts.unresolvedCount).toBe(3); // pending + blocked + rejected
    expect(counts.awaitingServerCount).toBe(2); // pending + blocked, NOT rejected
    expect(counts.syncedCount).toBe(1);
  });

  it("drops a resolved row out of every unresolved count", async () => {
    const { row } = await enqueue(punch());
    await markRejected({ id: row.id, error: "nope" });
    await markResolved({ id: row.id, resolutionDocname: "HR-ATT-REQ-1" });

    const counts = await countByStatus();
    expect(counts.unresolvedCount).toBe(0);
    expect(counts.resolvedCount).toBe(1);
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
