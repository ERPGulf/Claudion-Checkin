/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import {
  claimNextPending, countUnconfirmedAttendanceDependencies, enqueue, findById,
  markRejected, markSynced, releaseStuckSyncing, renewAttendanceClaim,
  beginAttendanceUpload, markRetry, markBlocked, markNeedsReview, releaseClaim, countOutstandingByScope,
  listUncertainUploadClaims,
  wakeBlocked, wakePending,
  recordVerificationIssue,
} from "../services/offline/AttendanceQueueRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { tenantKey: "https://attendance.example.com", employeeId: "EMP-001" };
const punch = overrides => ({ ...scope, attendanceType: "auto", action: "checkin",
  timestamp: "2026-10-14 09:00:00", payload: { photoUri: "file:///old.jpg" }, ...overrides });
beforeEach(() => { __resetAll(); resetDatabaseHandle(); });

it("a second runtime cannot release a live claimed upload", async () => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a", leaseMs: 2000 });
  expect(await releaseStuckSyncing(2000, scope)).toBe(0);
  expect(await claimNextPending(2000, { ...scope, ownerId: "runtime-b" })).toBeNull();
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: "runtime-a" });
});

it.each([markRetry, markBlocked, markNeedsReview, releaseClaim])("refuses a stale owner's queue outcome without releasing the current claim", async write => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "current-owner", leaseMs: 1000 });
  await expect(write({ id: row.id, claimOwner: "old-owner", now: 1500, error: "synthetic" }))
    .rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: "current-owner" });
});

it("an expired claim that never began an upload can resume safely", async () => {
  await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a", leaseMs: 1000 });
  expect(await releaseStuckSyncing(2000, scope)).toBe(1);
  expect(await claimNextPending(2000, { ...scope, ownerId: "runtime-b" })).toMatchObject({ claimOwner: "runtime-b" });
});

it("an expired dispatched upload is held for positive verification instead of resent", async () => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a", leaseMs: 1000 });
  await beginAttendanceUpload({ id: row.id, claimOwner: "runtime-a", now: 1500, leaseMs: 1000 });
  expect(await releaseStuckSyncing(2500, scope)).toBe(1);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 1500 });
  expect(await claimNextPending(2500, { ...scope, ownerId: "runtime-b" })).toBeNull();
});

it("new review outcomes save their reason and respect a bounded history recheck interval", async () => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a" });
  await beginAttendanceUpload({ id: row.id, claimOwner: "runtime-a", now: 1500 });
  await markNeedsReview({ id: row.id, claimOwner: "runtime-a", now: 2000,
    error: "Unconfirmed response", verificationIssue: "unrecognized-server-response" });
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 1500,
    verificationIssue: "unrecognized-server-response", verificationCheckedAt: 2000 });
  expect(await listUncertainUploadClaims(scope, 61999)).toEqual([]);
  expect((await listUncertainUploadClaims(scope, 62000)).map(item => item.id)).toEqual([row.id]);
  expect(await claimNextPending(62000, scope)).toBeNull();
});

it("legacy empty review reasons receive scoped read-only rechecks without becoming POST eligible", async () => {
  const originals = [];
  for (let minute = 0; minute < 4; minute += 1) {
    const result = await enqueue(punch({ timestamp: `2026-10-14 09:0${minute}:00`,
      ...(minute === 3 ? { tenantKey: "https://other.example.com" } : {}) }));
    originals.push(result.row);
  }
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET status = 'needs_review', failureClass = 'verification-required';");
  await db.runAsync("UPDATE attendance_queue SET verificationIssue = '' WHERE id = ?;", [originals[1].id]);
  await db.runAsync("UPDATE attendance_queue SET verificationIssue = 'company-needs-review' WHERE id = ?;", [originals[2].id]);
  const listed = await listUncertainUploadClaims(scope, 100000);
  expect(listed.map(row => row.id)).toEqual([originals[0].id, originals[1].id]);
  expect(await findById(originals[0].id)).toMatchObject({ status: "needs_review", tenantKey: scope.tenantKey,
    timestamp: originals[0].timestamp, payload: originals[0].payload, uploadAttemptAt: null });
  expect(await claimNextPending(100000, scope)).toBeNull();
});

it("rotates the bounded review checks so old inconclusive records do not starve uninspected records", async () => {
  const ids = [];
  for (let minute = 0; minute < 7; minute += 1) {
    ids.push((await enqueue(punch({ timestamp: `2026-10-14 09:0${minute}:00` }))).row.id);
  }
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = 'needs_review', failureClass = 'verification-required';");
  const first = await listUncertainUploadClaims(scope, 100000);
  expect(first.map(row => row.id)).toEqual(ids.slice(0, 5));
  for (const row of first) await recordVerificationIssue({ row, reason: "no-exact-match-in-visible-history", now: 100000 });
  const next = await listUncertainUploadClaims(scope, 160000);
  expect(next.map(row => row.id)).toEqual([ids[5], ids[6], ...ids.slice(0, 3)]);
  expect(await claimNextPending(160000, scope)).toBeNull();
});

it.each([
  ["pending", markRetry, wakePending],
  ["blocked", markBlocked, wakeBlocked],
])("respects persisted preflight Retry-After for %s rows through automatic and forced wakeups", async (status, write, wake) => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a" });
  const retryAfterAt = 602000;
  await write({ id: row.id, claimOwner: "runtime-a", now: 2000, retryAfterMs: 600000,
    error: "server_unavailable", serverResponse: { instanceAvailability: { status: "server_unavailable", retryAfterAt } } });
  expect(await findById(row.id)).toMatchObject({ status, uploadAttemptAt: null, nextAttemptAt: retryAfterAt });
  expect(await wake({ ...scope, now: 3000 })).toBe(0);
  expect(await wake({ ...scope, now: 3000, force: true })).toBe(0);
  expect(await claimNextPending(3000, scope)).toBeNull();
  await wake({ ...scope, now: retryAfterAt, force: true });
  expect(await claimNextPending(retryAfterAt, scope)).toMatchObject({ id: row.id, uploadAttemptAt: null,
    timestamp: row.timestamp, payload: row.payload });
});

it("a migrated syncing row without owner cannot prove no upload occurred", async () => {
  const { row } = await enqueue(punch());
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = 'syncing' WHERE id = ?", [row.id]);
  await releaseStuckSyncing(1000, scope);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", claimOwner: null });
});

it("renewal and outcome writes require the current unexpired owner", async () => {
  const { row } = await enqueue(punch());
  await claimNextPending(1000, { ...scope, ownerId: "runtime-a", leaseMs: 1000 });
  await expect(renewAttendanceClaim({ id: row.id, claimOwner: "runtime-b", now: 1500 })).rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  await expect(markSynced({ id: row.id, claimOwner: "runtime-a", now: 2000, serverCheckinId: "LATE" })).rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  await releaseStuckSyncing(2000, scope);
  await claimNextPending(2000, { ...scope, ownerId: "runtime-b" });
  await expect(markRejected({ id: row.id, claimOwner: "runtime-a", now: 2100 })).rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: "runtime-b" });
});

it("manual dependencies include retained historical and unknown-tenant rows without adopting foreign tenants", async () => {
  await enqueue(punch({ sourceEventId: null }));
  await enqueue(punch({ tenantKey: null, timestamp: "2026-10-14 08:00:00" }));
  await enqueue(punch({ tenantKey: "https://other.example.com", timestamp: "2026-10-14 07:00:00" }));
  expect(await countUnconfirmedAttendanceDependencies(scope)).toBe(2);
});

it("v5 migration preserves historical upload uncertainty and legacy photo data", async () => {
  const { row } = await enqueue(punch());
  const db = await getDatabase();
  await db.execAsync("UPDATE attendance_queue SET status = 'syncing'; ALTER TABLE attendance_queue DROP COLUMN claimOwner; ALTER TABLE attendance_queue DROP COLUMN claimExpiresAt; ALTER TABLE attendance_queue DROP COLUMN uploadAttemptAt; PRAGMA user_version = 5;");
  resetDatabaseHandle();
  expect((await getDatabase()).getFirstAsync).toBeDefined();
  expect((await db.getFirstAsync("PRAGMA user_version")).user_version).toBe(6);
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: null, uploadAttemptAt: null,
    payload: { photoUri: "file:///old.jpg" } });
  await releaseStuckSyncing(Date.now(), scope);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", tenantKey: scope.tenantKey });
});

it("mixed historical/native work has a deterministic order despite reversed native wall clocks", async () => {
  await enqueue(punch({ sourceEventId: "native-a" }));
  await enqueue(punch({ sourceEventId: "native-b", action: "checkout", timestamp: "2026-10-14 08:59:00" }));
  await enqueue(punch({ timestamp: "2026-10-14 08:59:59" }));
  const historical = await claimNextPending(1000, scope);
  expect(historical).toMatchObject({ sourceEventId: null, timestamp: "2026-10-14 08:59:59" });
  await markSynced({ id: historical.id, claimOwner: historical.claimOwner, now: 1001, acceptanceConfirmed: true });
  const firstNative = await claimNextPending(1002, scope);
  expect(firstNative.sourceEventId).toBe("native-a");
  await markSynced({ id: firstNative.id, claimOwner: firstNative.claimOwner, now: 1003, acceptanceConfirmed: true });
  expect((await claimNextPending(1004, scope)).sourceEventId).toBe("native-b");
});

it("unconfirmed historical success blocks strict native work until positive acceptance is recorded", async () => {
  const { row } = await enqueue(punch());
  await markSynced({ id: row.id, serverCheckinId: "UNVERIFIED" });
  await enqueue(punch({ sourceEventId: "new-native", timestamp: "2026-10-14 10:00:00" }));
  expect(await countOutstandingByScope(scope)).toBe(2);
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
  await markSynced({ id: row.id, serverCheckinId: "VERIFIED", acceptanceConfirmed: true });
  expect((await claimNextPending(Date.now(), scope)).sourceEventId).toBe("new-native");
});

it("v6 migration rollback retains v5 evidence and retries the additive step", async () => {
  const { row } = await enqueue(punch());
  const db = await getDatabase();
  await db.execAsync("ALTER TABLE attendance_queue DROP COLUMN claimOwner; ALTER TABLE attendance_queue DROP COLUMN claimExpiresAt; ALTER TABLE attendance_queue DROP COLUMN uploadAttemptAt; PRAGMA user_version = 5;");
  const exec = db.execAsync;
  db.execAsync = async sql => {
    if (sql.includes("PRAGMA user_version = 6;")) {
      db.execAsync = exec;
      return exec(sql.replace("PRAGMA user_version = 6;", "SELECT nonexistent_column FROM attendance_queue;"));
    }
    return exec(sql);
  };
  resetDatabaseHandle();
  await expect(getDatabase()).rejects.toThrow();
  expect((await db.getFirstAsync("PRAGMA user_version")).user_version).toBe(5);
  expect((await db.getAllAsync("PRAGMA table_info(attendance_queue)")).map(column => column.name)).not.toContain("claimOwner");
  expect(await findById(row.id)).toMatchObject({ payload: { photoUri: "file:///old.jpg" }, tenantKey: scope.tenantKey });
  expect((await db.getFirstAsync("PRAGMA user_version")).user_version).toBe(6);
});
