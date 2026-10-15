/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import * as SQLite from "expo-sqlite";
import {
  AUTO_EVENT_TABLE, DATABASE_NAME, QUEUE_TABLE, getDatabase, resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import { enqueue, listAll } from "../services/offline/AttendanceQueueRepository";
import {
  AUTO_EVENT_STATUS, claimEvent, countReviewEvents, findEvent,
  hasEarlierUnresolvedEvent, ingestNativeEvent, listPendingEvents,
  listReviewEvents, updateEvent,
  updateClaimedEvent,
} from "../services/offline/AutoAttendanceEventRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const scope = { tenantKey: "https://attendance.example.com", employeeId: "EMP-001" };
const event = (eventId, sequence = 1, overrides = {}) => ({
  eventId, sequence, ...scope, identifier: "office-main", nativeIdentifier: "native-office-1",
  registrationId: "registration-1", transition: "ENTER", timestamp: 1791800000000 + sequence,
  geotagging: 2, latitude: 25.28, longitude: 51.52, radius: 100, ...overrides,
});

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
});

it("retains offline ENTER and EXIT independently before either is consumed", async () => {
  await ingestNativeEvent(event("enter", 1));
  await ingestNativeEvent(event("exit", 2, { transition: "EXIT" }));
  expect((await listPendingEvents(scope)).map(row => row.eventId)).toEqual(["enter", "exit"]);
  expect((await findEvent("enter")).event.transition).toBe("ENTER");
});

it("ingests repeated native delivery idempotently without resetting a saved outcome", async () => {
  await ingestNativeEvent(event("enter"));
  await updateEvent("enter", { status: AUTO_EVENT_STATUS.HANDLED, outcome: { queued: true }, queueRowId: 7 });
  const replay = await ingestNativeEvent(event("enter", 99, { transition: "EXIT" }));
  expect(replay).toMatchObject({ status: "handled", queueRowId: 7, outcome: { queued: true }, sequence: 1 });
  expect(replay.event.transition).toBe("ENTER");
});

it("processes rapid transitions by persisted native sequence even if ingestion arrives out of order", async () => {
  await ingestNativeEvent(event("third", 3), { now: 10 });
  await ingestNativeEvent(event("second", 2, { transition: "EXIT" }), { now: 20 });
  await ingestNativeEvent(event("first", 1), { now: 30 });
  expect((await listPendingEvents(scope)).map(row => row.eventId)).toEqual(["first", "second", "third"]);
});

it("does not list a matching employee code belonging to another tenant", async () => {
  await ingestNativeEvent(event("mine"));
  await ingestNativeEvent(event("other", 2, { tenantKey: "https://other.example.com" }));
  expect((await listPendingEvents(scope)).map(row => row.eventId)).toEqual(["mine"]);
});

it("retains unknown legacy provenance for review without adding an attendance punch", async () => {
  const legacy = { identifier: "office-main", transition: "ENTER", timestamp: 1791800000000 };
  const first = await ingestNativeEvent(legacy);
  const second = await ingestNativeEvent(legacy);
  expect(second.eventId).toBe(first.eventId);
  expect(first).toMatchObject({ status: "needs_review", tenantKey: null, employeeId: null });
  expect(await listPendingEvents(scope)).toEqual([]);
  expect(await countReviewEvents(scope)).toBe(1);
  expect(await listAll()).toEqual([]);
});

it("retains stale native callback metadata and omits unexpected credential fields", async () => {
  const row = await ingestNativeEvent(event("stale", 1, { captureIssue: "stale-registration", access_token: "synthetic-secret" }));
  expect(row).toMatchObject({ status: "needs_review", reason: "native-capture-issue" });
  expect(row.event).not.toHaveProperty("access_token");
  expect((await listReviewEvents(scope))[0].eventId).toBe("stale");
});

it("atomically gives only one concurrent processor a native receipt", async () => {
  await ingestNativeEvent(event("enter"));
  const claims = await Promise.all([claimEvent("enter"), claimEvent("enter")]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect((await findEvent("enter")).status).toBe("processing");
});

it("does not release a live processor's claim when another JavaScript context starts", async () => {
  await ingestNativeEvent(event("enter"));
  await claimEvent("enter", { ownerId: "runtime-a", now: 1000, leaseMs: 120000 });
  expect(await claimEvent("enter", { ownerId: "runtime-b", now: 2000 })).toBeNull();
  expect(await updateClaimedEvent("enter", "runtime-a", { punchTimestamp: "2026-10-12 09:00:00" }, { now: 3000 })).toMatchObject({ claimOwner: "runtime-a", claimExpiresAt: 123000 });
});

it("reclaims only an expired processor while retaining its durable online dispatch evidence", async () => {
  await ingestNativeEvent(event("enter"));
  await claimEvent("enter", { ownerId: "runtime-a", now: 1000, leaseMs: 100 });
  await updateClaimedEvent("enter", "runtime-a", { onlineAttemptAt: 1001 }, { now: 1001, leaseMs: 100 });
  expect(await claimEvent("enter", { ownerId: "runtime-b", now: 1100 })).toBeNull();
  expect(await claimEvent("enter", { ownerId: "runtime-b", now: 1101 })).toMatchObject({ claimOwner: "runtime-b", onlineAttemptAt: 1001 });
});

it("prevents an expired or replaced owner from recording another POST or changing an outcome", async () => {
  await ingestNativeEvent(event("enter"));
  await claimEvent("enter", { ownerId: "runtime-a", now: 1000, leaseMs: 100 });
  expect(await updateClaimedEvent("enter", "runtime-a", { onlineAttemptAt: 1100 }, { now: 1100 })).toBeNull();
  await claimEvent("enter", { ownerId: "runtime-b", now: 1100 });
  expect(await updateClaimedEvent("enter", "runtime-a", { status: "handled" }, { now: 1101 })).toBeNull();
  expect(await updateClaimedEvent("enter", "runtime-b", { status: "needs_review", reason: "uncertain" }, { now: 1101 })).toMatchObject({ status: "needs_review", claimOwner: null, claimExpiresAt: null });
  expect(await claimEvent("enter", { ownerId: "runtime-c", now: 999999 })).toBeNull();
});

it("restores an interrupted online attempt as processing with durable dispatch evidence", async () => {
  await ingestNativeEvent(event("enter"));
  await claimEvent("enter");
  await updateEvent("enter", { punchTimestamp: "2026-10-12 09:00:00", onlineAttemptAt: 1791800000000 });
  resetDatabaseHandle();
  expect((await listPendingEvents(scope))[0]).toMatchObject({
    status: "processing", punchTimestamp: "2026-10-12 09:00:00", onlineAttemptAt: 1791800000000,
  });
  expect(await claimEvent("enter")).toBeNull();
});

it("holds a later event behind an uncertain earlier event until the earlier outcome is verified", async () => {
  const first = await ingestNativeEvent(event("enter", 1));
  const second = await ingestNativeEvent(event("exit", 2, { transition: "EXIT" }));
  await updateEvent(first.eventId, { status: "needs_review", reason: "unconfirmed-online-attempt" });
  expect(await hasEarlierUnresolvedEvent(second)).toBe(true);
  await updateEvent(first.eventId, { status: "handled", outcome: { serverConfirmed: true } });
  expect(await hasEarlierUnresolvedEvent(second)).toBe(false);
});

it("does not let another tenant's uncertain event block this tenant", async () => {
  await ingestNativeEvent(event("foreign", 1, { tenantKey: "https://other.example.com", captureIssue: "stale-registration" }));
  const row = await ingestNativeEvent(event("mine", 2));
  expect(await hasEarlierUnresolvedEvent(row)).toBe(false);
});

it("upgrades an existing v4 database additively without attributing or losing historical rows", async () => {
  const db = await getDatabase();
  await enqueue({ employeeId: "EMP-OLD", attendanceType: "manual", action: "checkin", timestamp: "2026-10-01 08:00:00", payload: { photoUri: "file:///old.jpg" } });
  await db.execAsync(`DROP INDEX idx_${QUEUE_TABLE}_source_event;
    ALTER TABLE ${QUEUE_TABLE} DROP COLUMN sourceEventId;
    DROP TABLE ${AUTO_EVENT_TABLE}; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN claimOwner; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN claimExpiresAt; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN uploadAttemptAt; PRAGMA user_version = 4;`);
  const before = await db.getAllAsync(`SELECT * FROM ${QUEUE_TABLE};`);
  resetDatabaseHandle();
  const upgraded = await getDatabase();
  expect((await upgraded.getFirstAsync("PRAGMA user_version;")).user_version).toBe(6);
  expect(await upgraded.getAllAsync(`SELECT * FROM ${QUEUE_TABLE};`)).toEqual(before.map(row => ({ ...row, sourceEventId: null,
    claimOwner: null, claimExpiresAt: null, uploadAttemptAt: null })));
  expect(await upgraded.getAllAsync(`SELECT * FROM ${AUTO_EVENT_TABLE};`)).toEqual([]);
});

it("rolls back a failed v5 upgrade so the next open can retry with historical data intact", async () => {
  const db = await getDatabase();
  await enqueue({ employeeId: "EMP-OLD", attendanceType: "auto", action: "checkout", timestamp: "2026-10-01 18:00:00" });
  await db.execAsync(`DROP INDEX idx_${QUEUE_TABLE}_source_event;
    ALTER TABLE ${QUEUE_TABLE} DROP COLUMN sourceEventId;
    DROP TABLE ${AUTO_EVENT_TABLE}; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN claimOwner; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN claimExpiresAt; ALTER TABLE ${QUEUE_TABLE} DROP COLUMN uploadAttemptAt; PRAGMA user_version = 4;`);
  const exec = db.execAsync;
  let failed = false;
  db.execAsync = async sql => {
    if (!failed && sql.includes(`CREATE TABLE IF NOT EXISTS ${AUTO_EVENT_TABLE}`)) {
      failed = true;
      return exec(sql.replace("PRAGMA user_version = 5;", "SELECT missing_column FROM attendance_queue;"));
    }
    return exec(sql);
  };
  resetDatabaseHandle();
  await expect(getDatabase()).rejects.toThrow();
  expect((await db.getFirstAsync("PRAGMA user_version;")).user_version).toBe(4);
  const recovered = await getDatabase();
  expect((await recovered.getFirstAsync("PRAGMA user_version;")).user_version).toBe(6);
  expect(await listAll()).toHaveLength(1);
  db.execAsync = exec;
  expect(await SQLite.openDatabaseAsync(DATABASE_NAME)).toBe(recovered);
});
