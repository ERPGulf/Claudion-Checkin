/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import {
  beginDirectAttendanceReceipt, claimNextPending, enqueue, findById,
  markSynced, releaseStuckSyncing, settleDirectAttendanceNoInsert,
  countByStatus, countRecoveryByScope, listRecoveryRows, listForHistory, wakeBlocked,
} from "../services/offline/AttendanceQueueRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { tenantKey: "https://attendance.example.com:8443/site", employeeId: "SYNTHETIC-EMPLOYEE" };
const receipt = overrides => ({ ...scope, action: "checkin", timestamp: "2026-10-27 09:00:00.123456",
  payload: { location: "Synthetic office", over_time: 0 }, ownerId: "direct-runtime", now: 1000,
  assertCurrent: jest.fn(), ...overrides });

beforeEach(() => { __resetAll(); resetDatabaseHandle(); });

it("records the exact direct POST timestamp and owned dispatch atomically with no pending window", async () => {
  const db = await getDatabase();
  const run = db.runAsync;
  let release;
  let inserted;
  const started = new Promise(resolve => { inserted = resolve; });
  db.runAsync = async (sql, params) => {
    const result = await run(sql, params);
    if (sql.includes("INSERT INTO attendance_queue")) {
      inserted();
      await new Promise(resolve => { release = resolve; });
    }
    return result;
  };
  try {
    const input = receipt();
    const pending = beginDirectAttendanceReceipt(input);
    await started;
    expect(await claimNextPending(1001, scope)).toBeNull();
    const stored = await db.getFirstAsync("SELECT * FROM attendance_queue;");
    expect(stored).toMatchObject({ status: "syncing", attendanceType: "auto", claimOwner: "direct-runtime",
      uploadAttemptAt: 1000, timestamp: input.timestamp, attemptCount: 1, lastAttemptAt: 1000 });
    release();
    expect(await pending).toMatchObject({ inserted: true, row: { timestamp: input.timestamp, payload: input.payload } });
  } finally {
    db.runAsync = run;
  }
});

it("does not let two runtimes authorize the same direct request", async () => {
  const [first, second] = await Promise.all([
    beginDirectAttendanceReceipt(receipt({ ownerId: "runtime-a" })),
    beginDirectAttendanceReceipt(receipt({ ownerId: "runtime-b" })),
  ]);
  expect([first, second].filter(result => result.inserted)).toHaveLength(1);
  expect(first.row.id).toBe(second.row.id);
  const originalOwner = [first, second].find(result => result.inserted).row.claimOwner;
  expect((await findById(first.row.id)).claimOwner).toBe(originalOwner);
});

it("atomically prevents a second distinct direct request from overtaking an unconfirmed dispatch", async () => {
  const results = await Promise.all([
    beginDirectAttendanceReceipt(receipt({ ownerId: "runtime-a" })),
    beginDirectAttendanceReceipt(receipt({ ownerId: "runtime-b", action: "checkout", timestamp: "2026-10-27 17:00:00" })),
  ]);
  expect(results.filter(result => result.inserted)).toHaveLength(1);
  expect(results.find(result => !result.inserted)).toMatchObject({ row: null, reason: "earlier-attendance-unconfirmed" });
  expect(await claimNextPending(1001, scope)).toBeNull();
});

it.each(["pending", "syncing", "needs_review", "blocked"])("does not overtake earlier %s work from this employee or unknown company", async status => {
  const { row } = await enqueue({ ...scope, tenantKey: null, attendanceType: "auto", action: "checkout", timestamp: "2026-10-27 08:00:00" });
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = ? WHERE id = ?;", [status, row.id]);
  expect(await beginDirectAttendanceReceipt(receipt())).toMatchObject({ inserted: false, row: null, reason: "earlier-attendance-unconfirmed" });
  expect(await findById(row.id)).toMatchObject({ tenantKey: null, status });
});

it("ignores foreign tenant/employee work and confirmed receipts without assigning their ownership", async () => {
  const base = { ...scope, attendanceType: "auto", action: "checkout", timestamp: "2026-10-27 08:00:00" };
  await enqueue({ ...base, tenantKey: "https://other.example.com" });
  await enqueue({ ...base, employeeId: "OTHER-EMPLOYEE" });
  const { row } = await enqueue(base);
  await markSynced({ id: row.id, acceptanceConfirmed: true, serverCheckinId: "KNOWN" });
  expect(await beginDirectAttendanceReceipt(receipt())).toMatchObject({ inserted: true });
});

it("retains an expired direct dispatch for verification after restart instead of uploading it again", async () => {
  const input = receipt({ leaseMs: 1000 });
  const { row } = await beginDirectAttendanceReceipt(input);
  resetDatabaseHandle();
  expect(await releaseStuckSyncing(2000, scope)).toBe(1);
  expect(await findById(row.id)).toMatchObject({ status: "needs_review", uploadAttemptAt: 1000,
    timestamp: input.timestamp, payload: input.payload, verificationIssue: "upload-outcome-unverified" });
  expect(await claimNextPending(2000, scope)).toBeNull();
});

it("checks current authorization after database preparation and requires explicit source identity", async () => {
  const denied = new Error("Synthetic policy changed");
  await expect(beginDirectAttendanceReceipt(receipt({ assertCurrent: () => { throw denied; } }))).rejects.toBe(denied);
  await expect(beginDirectAttendanceReceipt(receipt({ tenantKey: null }))).rejects.toThrow(/scope/);
  await expect(beginDirectAttendanceReceipt(receipt({ timestamp: " " }))).rejects.toThrow(/timestamp/);
  expect(await (await getDatabase()).getFirstAsync("SELECT * FROM attendance_queue;")).toBeNull();
});

it("retains a proven no-insert refusal without retry or review counts when offline admission is denied", async () => {
  const { row } = await beginDirectAttendanceReceipt(receipt());
  const cancelled = await settleDirectAttendanceNoInsert({ id: row.id, claimOwner: row.claimOwner,
    failureClass: "auth", error: "Synthetic authentication refusal", serverResponse: { message: "Synthetic refusal" }, now: 1500 });
  expect(cancelled).toMatchObject({ status: "cancelled", uploadAttemptAt: null, claimOwner: null,
    verificationIssue: "known-not-inserted", timestamp: row.timestamp, payload: row.payload,
    lastAttemptAt: row.lastAttemptAt, attemptCount: row.attemptCount });
  expect(await countByStatus(scope.employeeId)).toMatchObject({ total: 1, cancelledCount: 1, unresolvedCount: 0, awaitingServerCount: 0 });
  expect(await countRecoveryByScope(scope)).toMatchObject({ recoverableCount: 0, reviewCount: 0 });
  expect((await listRecoveryRows(scope)).map(item => item.id)).toEqual([row.id]);
  expect((await listForHistory({ employeeId: scope.employeeId })).map(item => item.id)).toEqual([row.id]);
  expect(await wakeBlocked({ ...scope, force: true, now: 2000 })).toBe(0);
  expect(await claimNextPending(2000, scope)).toBeNull();
});

it("converts the same owned receipt to pending only after explicit offline admission", async () => {
  const { row } = await beginDirectAttendanceReceipt(receipt());
  const accepted = await settleDirectAttendanceNoInsert({ id: row.id, claimOwner: row.claimOwner,
    queueForDelivery: true, failureClass: "configuration", error: "Synthetic known refusal", assertCurrent: jest.fn(), now: 1500 });
  expect(accepted).toMatchObject({ id: row.id, status: "pending", uploadAttemptAt: null,
    verificationIssue: null, verificationCheckedAt: null, timestamp: row.timestamp, payload: row.payload });
  expect(await claimNextPending(1500, scope)).toMatchObject({ id: row.id, timestamp: row.timestamp });
});

it("refuses revoked offline admission after database preparation without clearing dispatch evidence", async () => {
  const { row } = await beginDirectAttendanceReceipt(receipt());
  const revoked = Object.assign(new Error("Synthetic offline policy revoked"), { code: "FEATURE_DISABLED" });
  const assertCurrent = jest.fn(() => { throw revoked; });
  await expect(settleDirectAttendanceNoInsert({ id: row.id, claimOwner: row.claimOwner,
    queueForDelivery: true, assertCurrent, now: 1500 })).rejects.toBe(revoked);
  expect(assertCurrent).toHaveBeenCalledTimes(1);
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: row.claimOwner, uploadAttemptAt: 1000 });
  expect(await settleDirectAttendanceNoInsert({ id: row.id, claimOwner: row.claimOwner, now: 1500 }))
    .toMatchObject({ status: "cancelled", verificationIssue: "known-not-inserted", uploadAttemptAt: null });
});

it("cannot cancel or release another runtime's direct dispatch", async () => {
  const { row } = await beginDirectAttendanceReceipt(receipt());
  await expect(settleDirectAttendanceNoInsert({ id: row.id, claimOwner: "other-runtime", now: 1500 }))
    .rejects.toMatchObject({ code: "ATTENDANCE_QUEUE_CLAIM_CHANGED" });
  expect(await findById(row.id)).toMatchObject({ status: "syncing", claimOwner: row.claimOwner, uploadAttemptAt: 1000 });
});

it("keeps an older cancelled status without no-insert proof in recovery review", async () => {
  const { row } = await enqueue({ ...scope, attendanceType: "auto", action: "checkout", timestamp: "2026-10-27 08:00:00" });
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = 'cancelled' WHERE id = ?;", [row.id]);
  expect(await countRecoveryByScope(scope)).toMatchObject({ recoverableCount: 0, reviewCount: 1 });
  expect((await listRecoveryRows(scope)).map(item => item.id)).toEqual([row.id]);
  expect(await findById(row.id)).toMatchObject({ verificationIssue: null, timestamp: row.timestamp });
});
