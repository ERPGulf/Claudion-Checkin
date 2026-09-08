/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { claimNextPending, countRecoveryByScope, enqueue, findById, listRecoveryRows, markBlocked, markSynced, purgeSynced } from "../services/offline/AttendanceQueueRepository";
import { inspectAttendanceQueue } from "../services/offline/AttendanceDiagnostics";
import { clearOfflineAttendance } from "../services/offline/AttendanceQueueService";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { employeeId: "0007", tenantKey: "https://synthetic.example.com" };
const seed = overrides => enqueue({ ...scope, attendanceType: "manual", action: "checkin", timestamp: "2026-06-01 09:00:00", ...overrides });
const input = { targets: [{ date: "2026-06-01", employees: ["0007", "0008"] }], scope };

beforeEach(() => { __resetAll(); resetDatabaseHandle(); });

it("finds all statuses and keeps leading-zero IDs, evidence and explicit no-match results", async () => {
  const statuses = ["pending", "syncing", "blocked", "rejected", "resolved", "synced", "failed", "invalid", "duplicate", "needs_review"];
  const db = await getDatabase();
  for (const [index, status] of statuses.entries()) {
    const { row } = await seed({ timestamp: `2026-06-01 09:${String(index).padStart(2, "0")}:00`, payload: { photoUri: "file:///original.jpg" } });
    await db.runAsync("UPDATE attendance_queue SET status = ?, error = ?, retryCount = 12 WHERE id = ?", [status, "original failure", row.id]);
  }
  const report = await inspectAttendanceQueue(input);
  expect(report.matches).toHaveLength(statuses.length);
  expect(report.unmatched).toEqual([{ date: "2026-06-01", employeeId: "0008" }]);
  expect(report.matches.every(row => row.includedInRecovery)).toBe(true);
  expect(report.matches.filter(row => row.includedInBaselinePendingSync).map(row => row.status)).toEqual(statuses.slice(0, 4));
  expect(report.matches.find(row => row.status === "failed")).toMatchObject({
    employeeId: "0007", retryCount: 12, lastError: "original failure", drainRetryable: false,
    payload: { photoUri: "file:///original.jpg" }, lastAttemptAt: null,
  });
  const counts = await countRecoveryByScope(scope);
  const rows = await listRecoveryRows(scope);
  expect(counts.recoverableCount).toBe(rows.filter(row => ["pending", "blocked"].includes(row.status)).length);
  expect(counts.reviewCount).toBe(6);
});

it("diagnoses FIFO and tenant exclusion with the same conditions as the atomic claim", async () => {
  const old = await seed();
  const next = await seed({ action: "checkout", timestamp: "2026-06-01 18:00:00" });
  const unknown = await seed({ tenantKey: null, timestamp: "2026-06-01 08:00:00" });
  const other = await seed({ tenantKey: "https://other.example.com" });
  let report = await inspectAttendanceQueue(input);
  expect(report.matches.every(row => !row.claimableNow)).toBe(true);
  expect(report.matches.find(row => row.id === unknown.row.id)).toMatchObject({ includedInRecovery: true, drainRetryable: false });
  expect(report.matches.find(row => row.id === other.row.id)).toMatchObject({ includedInRecovery: false, drainRetryable: false });
  expect(await claimNextPending(Date.now(), scope)).toBeNull();
  await markSynced({ id: unknown.row.id });
  report = await inspectAttendanceQueue(input);
  expect(report.matches.filter(row => row.claimableNow).map(row => row.id)).toEqual([old.row.id]);
  const claimed = await claimNextPending(Date.now(), scope);
  expect(claimed.id).toBe(old.row.id);
  expect(claimed.attemptCount).toBe(1);
  expect(claimed.lastAttemptAt).not.toBeNull();
  expect((await findById(next.row.id)).status).toBe("pending");
});

it("keeps all evidence through logout, restart and former age cleanup", async () => {
  const db = await getDatabase();
  for (const [index, status] of ["pending", "blocked", "needs_review", "synced", "resolved", "failed"].entries()) {
    const { row } = await seed({ timestamp: `2026-06-01 09:0${index}:00`, now: 1000 });
    await db.runAsync("UPDATE attendance_queue SET status = ?, duplicate = 1 WHERE id = ?", [status, row.id]);
  }
  const before = await listRecoveryRows(scope);
  await clearOfflineAttendance();
  await purgeSynced({ olderThanMs: 1, now: 999999999 });
  resetDatabaseHandle();
  expect(await listRecoveryRows(scope)).toEqual(before);
});

it("reports blocked as retryable but not immediately claimable until woken", async () => {
  const { row } = await seed();
  await markBlocked({ id: row.id, now: 1000 });
  const report = await inspectAttendanceQueue({ ...input, now: 1001 });
  expect(report.matches[0]).toMatchObject({ drainRetryable: true, claimableNow: false });
});

it("does not truncate historical matches behind 500 unrelated records", async () => {
  await seed();
  const db = await getDatabase();
  await db.execAsync(`WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x < 501)
    INSERT INTO attendance_queue(employeeId, attendanceType, action, timestamp, payload, createdAt, updatedAt)
    SELECT 'ANOTHER', 'auto', 'checkin', 'time-' || x, '{}', 1, 1 FROM seq;`);
  expect((await inspectAttendanceQueue(input)).matches).toHaveLength(1);
});

it("preserves malformed original JSON in diagnostics instead of presenting an empty object as the original", async () => {
  const { row } = await seed();
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET payload = ?, serverResponse = ? WHERE id = ?",
    ["{broken original", "unparseable original response", row.id]);
  const report = await inspectAttendanceQueue(input);
  expect(report.matches[0]).toMatchObject({ rawPayload: "{broken original", rawServerResponse: "unparseable original response" });
});
