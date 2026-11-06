/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import {
  beginAttendanceUpload, beginDirectAttendanceReceipt, claimNextPending, countOutstandingByScope, enqueue,
  findById, listAll, listUncertainUploadClaims, markBlocked, markRejected, markSynced, releaseStuckSyncing,
  pairWithOpenCheckin, renewAttendanceClaim, wakeBlocked,
  QUEUE_CLAIM_CHANGED, QUEUE_CLAIM_LEASE_MS,
} from "../services/offline/AttendanceQueueRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { employeeId: "0007", tenantKey: "https://synthetic-queue.example" };
const input = overrides => ({ ...scope, attendanceType: "auto", action: "checkin",
  timestamp: "2026-11-04 09:00:00", payload: { photoUri: "file:///synthetic-original.jpg" }, ...overrides });
const checkout = overrides => input({ action: "checkout", timestamp: "2026-11-04 17:00:00", ...overrides });

beforeEach(() => { __resetAll(); resetDatabaseHandle(); });

it("commits a legacy checkout with both pair links and one session identity already present", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  expect(child).toMatchObject({ pairedAttendanceId: parent.id, sessionId: `s-${scope.employeeId}-${parent.id}` });
  expect(await findById(parent.id)).toMatchObject({ pairedAttendanceId: child.id, sessionId: child.sessionId });
});

it("retains a complete pair when execution is lost immediately after the admission statement commits", async () => {
  const parent = (await enqueue(input())).row;
  const db = await getDatabase();
  const run = db.runAsync;
  db.runAsync = async (sql, params) => {
    const result = await run(sql, params);
    if (sql.includes("INSERT INTO attendance_queue")) {
      db.runAsync = run;
      throw new Error("synthetic termination after durable admission");
    }
    return result;
  };
  await expect(enqueue(checkout())).rejects.toThrow("synthetic termination");
  resetDatabaseHandle();
  const rows = await listAll();
  const child = rows.find(row => row.action === "checkout");
  expect(child).toMatchObject({ pairedAttendanceId: parent.id });
  expect(await findById(parent.id)).toMatchObject({ pairedAttendanceId: child.id, sessionId: child.sessionId });
});

it("rolls back checkout admission if establishing its reverse pair link fails", async () => {
  const parent = (await enqueue(input())).row;
  await (await getDatabase()).execAsync(`CREATE TEMP TRIGGER fail_pair BEFORE UPDATE OF pairedAttendanceId
    ON attendance_queue WHEN OLD.id = ${parent.id}
    BEGIN SELECT RAISE(ABORT, 'synthetic pairing write failure'); END;`);
  await expect(enqueue(checkout())).rejects.toThrow("synthetic pairing write failure");
  expect(await listAll()).toEqual([expect.objectContaining({ id: parent.id, pairedAttendanceId: null })]);
});

it("records a checkout of an already-rejected local checkin as a dependent rejection at admission", async () => {
  const parent = (await enqueue(input())).row;
  await markRejected({ id: parent.id, error: "synthetic permanent refusal" });
  const child = (await enqueue(checkout({ payload: { parentQueueRowId: parent.id } }))).row;
  expect(child).toMatchObject({ status: "rejected", failureClass: "dependent", pairedAttendanceId: parent.id });
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
});

it("retains an unproven legacy checkout for review without adopting an old rejected parent", async () => {
  const parent = (await enqueue(input())).row;
  await markRejected({ id: parent.id, error: "synthetic refusal" });
  const child = (await enqueue(checkout({ timestamp: "2026-11-05 17:00:00" }))).row;
  expect(child).toMatchObject({ status: "needs_review", failureClass: "verification-required",
    pairedAttendanceId: null, sessionId: null });
  expect(await findById(parent.id)).toMatchObject({ status: "rejected", pairedAttendanceId: null });
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
});

it("cannot leave a claimable checkout if execution is lost immediately after rejecting its checkin", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  const db = await getDatabase();
  for (const method of ["runAsync", "getAllAsync"]) {
    const original = db[method];
    db[method] = async (sql, params) => {
      const result = await original(sql, params);
      if (sql.includes("UPDATE attendance_queue")) {
        db[method] = original;
        throw new Error("synthetic termination after rejection write");
      }
      return result;
    };
  }
  await expect(markRejected({ id: parent.id, error: "synthetic refusal" })).rejects.toThrow("synthetic termination");
  resetDatabaseHandle();
  expect(await findById(child.id)).toMatchObject({ status: "rejected", failureClass: "dependent" });
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
});

it("deduplicates concurrent legacy checkout admissions without leaving a reverse link to a nonexistent row", async () => {
  const parent = (await enqueue(input())).row;
  const admissions = await Promise.all([enqueue(checkout()), enqueue(checkout())]);
  expect(admissions.map(result => result.inserted).sort()).toEqual([false, true]);
  expect(admissions[0].row.id).toBe(admissions[1].row.id);
  expect(await findById(parent.id)).toMatchObject({ pairedAttendanceId: admissions[0].row.id });
  expect(await listAll()).toHaveLength(2);
});

it("keeps legacy NULL provenance separate from a known tenant when establishing a pair", async () => {
  const unknown = (await enqueue(input({ tenantKey: null }))).row;
  const child = (await enqueue(checkout())).row;
  expect(child).toMatchObject({ tenantKey: scope.tenantKey, pairedAttendanceId: null });
  expect(await findById(unknown.id)).toMatchObject({ tenantKey: null, pairedAttendanceId: null });
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
});

it("recovers a never-dispatched future lease after clock rewind and refuses the previous owner's settlement", async () => {
  const row = (await enqueue(input())).row;
  await claimNextPending(10000000, { ...scope, ownerId: "before-clock-rewind" });
  expect(await releaseStuckSyncing(1000, scope)).toBe(1);
  const next = await claimNextPending(1001, { ...scope, ownerId: "after-clock-rewind" });
  expect(next).toMatchObject({ id: row.id, uploadAttemptAt: null, claimOwner: "after-clock-rewind" });
  await expect(markSynced({ id: row.id, claimOwner: "before-clock-rewind", now: 1002, acceptanceConfirmed: true }))
    .rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect((await findById(row.id)).payload).toEqual(input().payload);
});

it("retains a dispatched future lease for verification after clock rewind, never for a second POST", async () => {
  const row = (await enqueue(input())).row;
  await claimNextPending(10000000, { ...scope, ownerId: "before-clock-rewind" });
  await beginAttendanceUpload({ id: row.id, claimOwner: "before-clock-rewind", now: 10000001 });
  expect(await releaseStuckSyncing(1000, scope)).toBe(1);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 10000001,
    verificationIssue: "upload-outcome-unverified", timestamp: input().timestamp, payload: input().payload });
  expect(await claimNextPending(1001, scope)).toBeNull();
});

it("does not let a clock-rewound owner record a new dispatch before the stale lease is repaired", async () => {
  const row = (await enqueue(input())).row;
  await claimNextPending(10000000, { ...scope, ownerId: "before-clock-rewind" });
  await expect(beginAttendanceUpload({ id: row.id, claimOwner: "before-clock-rewind", now: 1000 }))
    .rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect((await findById(row.id)).uploadAttemptAt).toBeNull();
});

it("keeps a future direct-online receipt uncertain through a simulated process restart", async () => {
  const admission = await beginDirectAttendanceReceipt({ ...input(), now: 10000000,
    ownerId: "direct-before-restart", assertCurrent: () => {} });
  resetDatabaseHandle();
  await releaseStuckSyncing(1000, scope);
  expect(await findById(admission.row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 10000000 });
  expect(await claimNextPending(1001, scope)).toBeNull();
});

it("preserves live bounded claims, but recovers dispatched claims normally after a forward clock jump", async () => {
  const row = (await enqueue(input())).row;
  await claimNextPending(1000, { ...scope, ownerId: "live-owner" });
  expect(await releaseStuckSyncing(1000, scope)).toBe(0);
  expect(await releaseStuckSyncing(1000 + QUEUE_CLAIM_LEASE_MS - 1, scope)).toBe(0);
  await beginAttendanceUpload({ id: row.id, claimOwner: "live-owner", now: 1001 });
  await releaseStuckSyncing(10000000, scope);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 1001 });
  expect(await claimNextPending(10000001, scope)).toBeNull();
});

it("rolls back the entire rejection if a dependent write fails", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  const db = await getDatabase();
  await db.execAsync(`CREATE TEMP TRIGGER fail_cascade BEFORE UPDATE OF status ON attendance_queue
    WHEN OLD.id = ${child.id} BEGIN SELECT RAISE(ABORT, 'synthetic cascade failure'); END;`);
  await expect(markRejected({ id: parent.id, error: "synthetic refusal" })).rejects.toThrow("synthetic cascade failure");
  expect(await findById(parent.id)).toMatchObject({ status: "pending", pairedAttendanceId: child.id });
  expect(await findById(child.id)).toMatchObject({ status: "pending", pairedAttendanceId: parent.id });
});

it("a stale rejection cannot mutate either row after a new owner takes the parent", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  await claimNextPending(1000, { ...scope, ownerId: "old-owner", leaseMs: 1000 });
  await releaseStuckSyncing(2000, scope);
  await claimNextPending(2001, { ...scope, ownerId: "new-owner" });
  await expect(markRejected({ id: parent.id, claimOwner: "old-owner", now: 2002, error: "obsolete refusal" }))
    .rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect(await findById(parent.id)).toMatchObject({ status: "syncing", claimOwner: "new-owner" });
  expect(await findById(child.id)).toMatchObject({ status: "pending", error: null });
});

it("retains an already-dispatched historical dependent for verification instead of rejecting or resending it", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  await (await getDatabase()).runAsync(`UPDATE attendance_queue SET status = 'syncing',
    uploadAttemptAt = 1200, claimOwner = 'historical-owner', claimExpiresAt = 2000,
    serverResponse = '{"original":"retained"}' WHERE id = ?;`, [child.id]);
  expect(await markRejected({ id: String(parent.id), error: "synthetic refusal", now: 1300 })).toEqual({ cascaded: 1 });
  expect(await findById(child.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 1200,
    claimOwner: null, verificationIssue: "upload-outcome-unverified", serverResponse: { original: "retained" } });
  expect(await claimNextPending(1400, scope)).toBeNull();
});

it("pairs an explicitly identified native parent despite reversed wall-clock timestamps", async () => {
  const parent = (await enqueue(input({ sourceEventId: "native-parent" }))).row;
  const child = (await enqueue(checkout({ timestamp: "2026-11-04 08:59:00", sourceEventId: "native-child",
    payload: { sourceParentEventId: "native-parent" } }))).row;
  expect(child.pairedAttendanceId).toBe(parent.id);
  expect((await claimNextPending(1000, scope)).id).toBe(parent.id);
  await markSynced({ id: parent.id, acceptanceConfirmed: true, now: 1001 });
  expect((await claimNextPending(1002, scope)).id).toBe(child.id);
});

it("a retained legacy pair with a rejected parent is not claimable even if its old cascade was interrupted", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = 'rejected' WHERE id = ?;", [parent.id]);
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
  expect(await findById(child.id)).toMatchObject({ status: "pending", pairedAttendanceId: parent.id,
    timestamp: checkout().timestamp, payload: checkout().payload });
});

it.each([0, Infinity, QUEUE_CLAIM_LEASE_MS + 1])("rejects an invalid or overlong lease (%s) before claim/admission writes", async leaseMs => {
  const row = (await enqueue(input())).row;
  await expect(claimNextPending(1000, { ...scope, ownerId: "invalid-owner", leaseMs })).rejects.toThrow("Invalid attendance upload claim");
  await expect(beginDirectAttendanceReceipt({ ...checkout(), now: 1000, ownerId: "invalid-direct", leaseMs,
    assertCurrent: () => {} })).rejects.toThrow("Invalid attendance upload claim");
  await claimNextPending(1001, { ...scope, ownerId: "valid-owner" });
  await expect(renewAttendanceClaim({ id: row.id, claimOwner: "valid-owner", now: 1002, leaseMs }))
    .rejects.toThrow("Invalid attendance upload claim");
  expect(await listAll()).toHaveLength(1);
  expect(await findById(row.id)).toMatchObject({ claimOwner: "valid-owner", uploadAttemptAt: null });
});

it("repairs future verification scheduling without losing the original dispatched timestamp", async () => {
  const row = (await enqueue(input())).row;
  await claimNextPending(10000000, { ...scope, ownerId: "before-rewind" });
  await beginAttendanceUpload({ id: row.id, claimOwner: "before-rewind", now: 10000001 });
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET verificationCheckedAt = 10000002 WHERE id = ?;", [row.id]);
  await releaseStuckSyncing(1000, scope);
  expect(await findById(row.id)).toMatchObject({ uploadAttemptAt: 10000001, verificationCheckedAt: null });
  expect((await listUncertainUploadClaims(scope, 1001)).map(item => item.id)).toEqual([row.id]);
});

it("clock recovery never releases another known tenant or attributes a NULL-provenance claim", async () => {
  const own = (await enqueue(input())).row;
  const other = (await enqueue(input({ tenantKey: "https://other-queue.example" }))).row;
  const unknown = (await enqueue(input({ tenantKey: null }))).row;
  await (await getDatabase()).runAsync(`UPDATE attendance_queue SET status = 'syncing',
    claimOwner = 'before-rewind', claimExpiresAt = 10120000, uploadAttemptAt = 10000000;`);
  expect(await releaseStuckSyncing(1000, scope)).toBe(1);
  expect(await findById(own.id)).toMatchObject({ status: "needs_review" });
  expect(await findById(other.id)).toMatchObject({ status: "syncing", tenantKey: "https://other-queue.example" });
  expect(await findById(unknown.id)).toMatchObject({ status: "syncing", tenantKey: null });
});

it("compatibility pairing preserves a dispatched old checkout as review evidence after parent rejection", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET pairedAttendanceId = NULL, sessionId = NULL;");
  await markRejected({ id: parent.id, error: "synthetic refusal" });
  await db.runAsync(`UPDATE attendance_queue SET status = 'syncing', uploadAttemptAt = 1000,
    claimOwner = 'legacy-owner', claimExpiresAt = 121000, verificationCheckedAt = 10000000 WHERE id = ?;`, [child.id]);
  await pairWithOpenCheckin({ checkoutId: child.id, ...scope, timestamp: child.timestamp, now: 2000 });
  expect(await findById(child.id)).toMatchObject({ status: "needs_review", failureClass: "verification-required",
    uploadAttemptAt: 1000, pairedAttendanceId: parent.id, verificationIssue: "upload-outcome-unverified",
    verificationCheckedAt: null, claimOwner: null });
  expect(await findById(parent.id)).toMatchObject({ pairedAttendanceId: child.id, status: "rejected" });
  expect(await claimNextPending(2001, scope)).toBeNull();
});

it("compatibility pairing rolls back both links when either row's update aborts", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET pairedAttendanceId = NULL, sessionId = NULL;");
  await db.execAsync(`CREATE TEMP TRIGGER fail_old_pair BEFORE UPDATE OF pairedAttendanceId
    ON attendance_queue WHEN OLD.id = ${child.id}
    BEGIN SELECT RAISE(ABORT, 'synthetic compatibility pair failure'); END;`);
  await expect(pairWithOpenCheckin({ checkoutId: child.id, ...scope, timestamp: child.timestamp }))
    .rejects.toThrow("synthetic compatibility pair failure");
  expect(await findById(parent.id)).toMatchObject({ pairedAttendanceId: null, sessionId: null });
  expect(await findById(child.id)).toMatchObject({ pairedAttendanceId: null, sessionId: null });
});

it("an endpoint-missing checkin takes its checkout with it, so later punches are not held back", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  expect((await claimNextPending(Date.now(), { ...scope, ownerId: "owner" })).id).toBe(parent.id);
  await markBlocked({ id: parent.id, claimOwner: "owner", failureClass: "endpoint-missing", error: "synthetic" });
  expect(await findById(child.id)).toMatchObject({ status: "blocked", failureClass: "endpoint-missing",
    pairedAttendanceId: parent.id, uploadAttemptAt: null });
  expect(await countOutstandingByScope(scope)).toBe(0);
  // The next day's online automatic punch is no longer refused as "earlier attendance unconfirmed".
  expect((await beginDirectAttendanceReceipt({ ...scope, action: "checkin", timestamp: "2026-11-05 09:00:00",
    ownerId: "direct", assertCurrent: () => {} })).inserted).toBe(true);
  // After a deployment both wake, and the checkout still cannot overtake its checkin.
  expect(await wakeBlocked({ force: true, ...scope })).toBe(2);
  expect((await claimNextPending(Date.now(), { ...scope, ownerId: "after" })).id).toBe(parent.id);
  expect(await claimNextPending(Date.now(), { ...scope, ownerId: "early" })).toBeNull();
  await markSynced({ id: parent.id, claimOwner: "after", acceptanceConfirmed: true });
  expect((await claimNextPending(Date.now(), { ...scope, ownerId: "next" })).id).toBe(child.id);
});

it.each([["auth", null], ["endpoint-missing", 1793800000000]])(
  "a %s block leaves its paired checkout untouched (dispatched at %s)", async (failureClass, uploadAttemptAt) => {
    const parent = (await enqueue(input())).row;
    const child = (await enqueue(checkout())).row;
    await (await getDatabase()).runAsync("UPDATE attendance_queue SET uploadAttemptAt = ? WHERE id = ?", [uploadAttemptAt, child.id]);
    await markBlocked({ id: parent.id, failureClass, error: "synthetic" });
    expect(await findById(child.id)).toMatchObject({ status: "pending", failureClass: null, uploadAttemptAt });
  });

it("a stale claimant's endpoint-missing block changes neither row", async () => {
  const parent = (await enqueue(input())).row;
  const child = (await enqueue(checkout())).row;
  await claimNextPending(Date.now(), { ...scope, ownerId: "current" });
  await expect(markBlocked({ id: parent.id, claimOwner: "stale", failureClass: "endpoint-missing" }))
    .rejects.toMatchObject({ code: QUEUE_CLAIM_CHANGED });
  expect(await findById(parent.id)).toMatchObject({ status: "syncing", claimOwner: "current" });
  expect(await findById(child.id)).toMatchObject({ status: "pending", failureClass: null });
});
