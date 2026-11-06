/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import { getDatabase, resetDatabaseHandle, QUEUE_TABLE } from "../services/offline/AttendanceDatabase";
import { enqueue, hasBackgroundSyncWork } from "../services/offline/AttendanceQueueRepository";
import { ingestNativeEvent, updateEvent, hasBackgroundEventWork } from "../services/offline/AutoAttendanceEventRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { tenantKey: "https://synthetic.example", employeeId: "EMP-SYNTHETIC" };
const event = (eventId, sequence) => ({
  ...scope, eventId, sequence, transition: "ENTER", timestamp: 1791800000000 + sequence,
  identifier: "office-main", registrationId: "synthetic-registration", geotagging: 2,
});
const queue = async (index = 0, extra = {}) => (await enqueue({
  ...scope, attendanceType: "auto", action: "checkin", timestamp: `2026-10-12 09:00:0${index}`, ...extra,
})).row;

beforeEach(() => { __resetAll(); resetDatabaseHandle(); });

it.each(["pending", "syncing", "blocked"])("keeps scoped %s work scheduled even when its backoff/lease is not due", async status => {
  const row = await queue();
  const db = await getDatabase();
  await db.runAsync(`UPDATE ${QUEUE_TABLE} SET status = ?, nextAttemptAt = ?, claimExpiresAt = ? WHERE id = ?`,
    [status, Date.now() + 600000, Date.now() + 120000, row.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(true);
  expect(await hasBackgroundSyncWork({ ...scope, tenantKey: "https://other.example" })).toBe(false);
});

it.each(["rejected", "cancelled", "resolved", "synced", "needs_review"])("does not keep the worker alive for a %s row requiring no automatic processing", async status => {
  const row = await queue();
  await (await getDatabase()).runAsync(`UPDATE ${QUEUE_TABLE} SET status = ?, acceptanceConfirmed = 1 WHERE id = ?`, [status, row.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(false);
});

it("does not retry forever for a missing endpoint, but keeps the row and the actionable rows behind it", async () => {
  const stranded = await queue(0);
  const db = await getDatabase();
  await db.runAsync(`UPDATE ${QUEUE_TABLE} SET status = 'blocked', failureClass = 'endpoint-missing' WHERE id = ?`, [stranded.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(false);
  expect(await db.getFirstAsync(`SELECT status, failureClass FROM ${QUEUE_TABLE} WHERE id = ?`, [stranded.id]))
    .toEqual({ status: "blocked", failureClass: "endpoint-missing" });
  // Its own checkout cannot reach the server before that checkin, so it waits
  // with it instead of becoming a pending row that holds everything back.
  expect(await queue(1, { action: "checkout" })).toMatchObject(
    { pairedAttendanceId: stranded.id, status: "blocked", failureClass: "endpoint-missing" });
  expect(await hasBackgroundSyncWork(scope)).toBe(false);
  // A punch the online endpoint can still accept must keep waking the worker.
  await queue(2);
  expect(await hasBackgroundSyncWork(scope)).toBe(true);
});

it("keeps other blocked failure classes retrying", async () => {
  const row = await queue();
  await (await getDatabase()).runAsync(`UPDATE ${QUEUE_TABLE} SET status = 'blocked', failureClass = 'auth' WHERE id = ?`, [row.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(true);
});

it("retries only read-only automatic verification for an uncertain outbox upload", async () => {
  const row = await queue();
  const db = await getDatabase();
  await db.runAsync(`UPDATE ${QUEUE_TABLE} SET status = 'needs_review', failureClass = 'verification-required',
    verificationIssue = 'no-exact-match-in-visible-history', uploadAttemptAt = ? WHERE id = ?`, [Date.now(), row.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(true);
  await db.runAsync(`UPDATE ${QUEUE_TABLE} SET verificationIssue = 'original-data-needs-review' WHERE id = ?`, [row.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(false);
});

it("does not repeatedly wake rows whose older dependency requires manual review", async () => {
  const first = await queue(0);
  await queue(1);
  await (await getDatabase()).runAsync(`UPDATE ${QUEUE_TABLE} SET status = 'needs_review' WHERE id = ?`, [first.id]);
  expect(await hasBackgroundSyncWork(scope)).toBe(false);
});

it("keeps a pending native receipt retryable but stops new actions after policy revocation", async () => {
  await ingestNativeEvent(event("pending", 1));
  expect(await hasBackgroundEventWork(scope)).toBe(true);
  expect(await hasBackgroundEventWork(scope, { allowNewAttendance: false })).toBe(false);
  await updateEvent("pending", { onlineAttemptAt: Date.now(), punchTimestamp: "2026-10-12 09:00:00" });
  expect(await hasBackgroundEventWork(scope, { allowNewAttendance: false })).toBe(true);
});

it("does not keep later native receipts waking behind manual review", async () => {
  await ingestNativeEvent(event("review", 1));
  await ingestNativeEvent(event("later", 2));
  await updateEvent("review", { status: "needs_review", reason: "source-event-collision" });
  expect(await hasBackgroundEventWork(scope)).toBe(false);
  // Positive dispatch evidence qualifies only for the existing history verifier.
  await updateEvent("review", { onlineAttemptAt: Date.now() });
  expect(await hasBackgroundEventWork(scope, { allowNewAttendance: false })).toBe(true);
});

it("ignores invalid structural review when deciding whether valid native receipts can progress", async () => {
  await ingestNativeEvent(event("invalid", 1));
  await ingestNativeEvent(event("later", 2));
  await updateEvent("invalid", { status: "needs_review", reason: "invalid-native-event" });
  expect(await hasBackgroundEventWork(scope)).toBe(true);
});
