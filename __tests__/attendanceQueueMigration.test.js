/**
 * @jest-environment jsdom
 *
 * jsdom because the expo-sqlite mock is WASM-backed — see
 * test-utils/expoSqliteMock.js.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));

import * as SQLite from "expo-sqlite";
import {
  DATABASE_NAME,
  FAILURE_CLASS,
  QUEUE_STATUS,
  QUEUE_TABLE,
  getDatabase,
  resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import { countByStatus, listAll } from "../services/offline/AttendanceQueueRepository";

const { __resetAll } = require("../test-utils/expoSqliteMock");

/**
 * The v1 → v2 migration.
 *
 * A queued punch is payroll data that exists in exactly one place, so a
 * migration that drops rows is unrecoverable. These tests build a real v1 table,
 * open it through the production path, and check what survived.
 */

/** The v1 schema, verbatim — do not "fix" this to match v2. */
const V1_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ${QUEUE_TABLE} (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId        TEXT    NOT NULL,
    employeeDocname   TEXT,
    attendanceType    TEXT    NOT NULL,
    action            TEXT    NOT NULL,
    timestamp         TEXT    NOT NULL,
    latitude          REAL,
    longitude         REAL,
    accuracy          REAL,
    address           TEXT,
    deviceId          TEXT,
    payload           TEXT    NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'pending',
    retryCount        INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt     INTEGER NOT NULL DEFAULT 0,
    serverCheckinId   TEXT,
    serverResponse    TEXT,
    duplicate         INTEGER NOT NULL DEFAULT 0,
    duplicateMessage  TEXT,
    error             TEXT,
    createdAt         INTEGER NOT NULL,
    updatedAt         INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_${QUEUE_TABLE}_dedupe
    ON ${QUEUE_TABLE} (employeeId, timestamp, action);
  PRAGMA user_version = 1;
`;

/** Seeds a database at v1 with one row per legacy status. */
const seedV1 = async () => {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(V1_SCHEMA);

  const insert = async (status, timestamp, error = null) =>
    db.runAsync(
      `INSERT INTO ${QUEUE_TABLE}
         (employeeId, attendanceType, action, timestamp, payload, status,
          error, createdAt, updatedAt)
       VALUES (?, 'manual', 'checkin', ?, '{}', ?, ?, 1000, 2000);`,
      ["TDI0167", timestamp, status, error],
    );

  await insert("pending", "2026-07-28 09:00:00");
  await insert("synced", "2026-07-28 10:00:00");
  await insert("failed", "2026-07-28 11:00:00", "Employee is inactive");
  await insert("failed", "2026-07-28 12:00:00", "has no attribute 'x'");
};

beforeEach(() => {
  __resetAll();
  resetDatabaseHandle();
});

describe("v1 → v2", () => {
  it("keeps every row", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();

    expect((await listAll()).length).toBe(4);
  });

  it("advances the schema version", async () => {
    await seedV1();
    resetDatabaseHandle();

    const db = await getDatabase();
    const row = await db.getFirstAsync("PRAGMA user_version;");

    expect(Number(row.user_version)).toBe(2);
  });

  it("adds the v2 columns", async () => {
    await seedV1();
    resetDatabaseHandle();

    const db = await getDatabase();
    const columns = await db.getAllAsync(`PRAGMA table_info(${QUEUE_TABLE});`);
    const names = columns.map((c) => c.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "failureClass",
        "blockedSince",
        "resolutionDocname",
        "resolvedAt",
        "sessionId",
        "pairedAttendanceId",
      ]),
    );
  });

  /**
   * The principle of the redesign, applied backwards.
   *
   * v1 could not tell "not deployed yet" from "invalid", so every one of its
   * `failed` rows is of unknown class. The only safe reading is the one that
   * keeps trying — migrating them to `rejected` would abandon payroll records
   * on the strength of a classification the old code was never able to make.
   */
  it("migrates every legacy `failed` row to blocked, never rejected", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();
    const counts = await countByStatus();

    expect(counts.blockedCount).toBe(2);
    expect(counts.rejectedCount).toBe(0);
  });

  it("marks migrated rows as unknown-class and records when they blocked", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();
    const migrated = (await listAll()).filter(
      (row) => row.status === QUEUE_STATUS.BLOCKED,
    );

    migrated.forEach((row) => {
      expect(row.failureClass).toBe(FAILURE_CLASS.UNKNOWN);
      expect(row.blockedSince).toBe(2000); // the row's updatedAt
    });
  });

  it("leaves pending and synced rows exactly as they were", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();
    const counts = await countByStatus();

    expect(counts.pendingCount).toBe(1);
    expect(counts.syncedCount).toBe(1);
  });

  it("preserves the data on a migrated row, not just its status", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();
    const [row] = (await listAll()).filter(
      (r) => r.timestamp === "2026-07-28 11:00:00",
    );

    expect(row.employeeId).toBe("TDI0167");
    expect(row.error).toBe("Employee is inactive");
    expect(row.createdAt).toBe(1000);
  });

  // The database opens lazily from geofence listeners after an OS relaunch, so
  // the migration must be safe to run with no UI and no second attempt.
  it("is idempotent across repeated opens", async () => {
    await seedV1();
    resetDatabaseHandle();

    await getDatabase();
    resetDatabaseHandle();
    await getDatabase();

    expect((await listAll()).length).toBe(4);
    expect((await countByStatus()).blockedCount).toBe(2);
  });
});

describe("a fresh install", () => {
  it("goes straight to v2 with every column present", async () => {
    const db = await getDatabase();

    const version = await db.getFirstAsync("PRAGMA user_version;");
    expect(Number(version.user_version)).toBe(2);

    const columns = await db.getAllAsync(`PRAGMA table_info(${QUEUE_TABLE});`);
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["failureClass", "sessionId", "pairedAttendanceId"]),
    );
  });

  it("starts empty", async () => {
    await getDatabase();
    expect((await countByStatus()).total).toBe(0);
  });
});
