// src/services/offline/AttendanceDatabase.js
import * as SQLite from "expo-sqlite";

/**
 * The offline attendance store.
 *
 * SQLite rather than AsyncStorage because this table is queried, not just read:
 * the sync drain wants "oldest actionable row", the history screen wants
 * "everything unresolved", and the dedupe rule wants an atomic "insert unless
 * this punch is already queued". Doing any of those over a JSON blob means
 * reading and rewriting the whole queue on every touch, and the dedupe check
 * stops being atomic — which matters, because a geofence event and a screen tap
 * genuinely can race.
 *
 * Every export here is async and the handle is opened lazily exactly once, so
 * nothing in this module runs at import time. Geofence listeners can call into
 * the queue seconds after an OS relaunch, before any screen has mounted; a
 * module-scope open would race that.
 */

export const DATABASE_NAME = "claudion-attendance.db";
export const QUEUE_TABLE = "attendance_queue";

/**
 * Row lifecycle.
 *
 * The old model had one failure state (`failed`) and treated it as final, which
 * is wrong for payroll: "the endpoint isn't deployed yet" and "this employee is
 * inactive" are not the same fact and must not have the same fate. They are now
 * `BLOCKED` and `REJECTED`, and only one of them ever stops trying.
 *
 *   PENDING  → in the queue, will be attempted
 *   SYNCING  → claimed by a drain, request in flight
 *   SYNCED   → the server has it (including "it already had it")
 *   BLOCKED  → the server cannot accept it *yet*. Kept forever, retried on a
 *              slow schedule. No user action can help, so none is offered.
 *   REJECTED → the server will never accept it. Kept forever, never retried,
 *              resolvable only by an attendance correction.
 *   RESOLVED → a rejected record that a correction request has superseded.
 *              Preserved for audit, excluded from every unresolved count.
 */
export const QUEUE_STATUS = {
  PENDING: "pending",
  SYNCING: "syncing",
  SYNCED: "synced",
  BLOCKED: "blocked",
  REJECTED: "rejected",
  RESOLVED: "resolved",
};

/**
 * Why a row is blocked or rejected. `status` decides what the queue *does*;
 * this decides what the UI *says*, and keeps the two from being conflated.
 */
export const FAILURE_CLASS = {
  /** The offline endpoint is not deployed on this server. */
  ENDPOINT_MISSING: "endpoint-missing",
  /** Credentials could not be used; a token refresh may fix it. */
  AUTH: "auth",
  /** Server-side configuration is incomplete. */
  CONFIGURATION: "configuration",
  /** A 4xx we could not positively identify. Blocked, never rejected. */
  UNKNOWN: "unknown",
  /** The server positively refused this record on its merits. */
  VALIDATION: "validation",
  /** Rejected only because the check-in it belongs to was rejected. */
  DEPENDENT: "dependent",
};

/** Which entry point created the row. */
export const ATTENDANCE_TYPE = {
  MANUAL: "manual",
  AUTO: "auto",
};

/** What the punch does. Maps to the backend's IN / OUT log_type. */
export const QUEUE_ACTION = {
  CHECKIN: "checkin",
  CHECKOUT: "checkout",
};

/** Backend `log_type` for a queue action, and back again. */
export const actionToLogType = (action) =>
  action === QUEUE_ACTION.CHECKOUT ? "OUT" : "IN";

export const logTypeToAction = (logType) =>
  String(logType).toUpperCase() === "OUT"
    ? QUEUE_ACTION.CHECKOUT
    : QUEUE_ACTION.CHECKIN;

/** Statuses the server has not accepted and that still need an outcome. */
export const UNRESOLVED_STATUSES = [
  QUEUE_STATUS.PENDING,
  QUEUE_STATUS.SYNCING,
  QUEUE_STATUS.BLOCKED,
  QUEUE_STATUS.REJECTED,
];

/**
 * Statuses the server might still accept.
 *
 * Deliberately excludes REJECTED: the server has already refused those, so its
 * "no open session" is correct about them and must be allowed to stand. This
 * distinction is what keeps the attendance screen's reconnect-race guard from
 * holding a session open forever on the strength of a record that will never
 * land. See hooks/useAttendanceAction.js.
 */
export const AWAITING_SERVER_STATUSES = [
  QUEUE_STATUS.PENDING,
  QUEUE_STATUS.SYNCING,
  QUEUE_STATUS.BLOCKED,
];

/**
 * Schema version. Bump it and add a `case` in `migrate` — never edit an
 * existing statement, since installs in the field are already at that version.
 */
const SCHEMA_VERSION = 2;

const CREATE_QUEUE_TABLE = `
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
    status            TEXT    NOT NULL DEFAULT '${QUEUE_STATUS.PENDING}',
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
`;

/**
 * The local duplicate rule — one row per (employee, timestamp, action) —
 * expressed as a constraint rather than a read-then-write check, so two
 * concurrent enqueues cannot both pass the check and both insert.
 */
const CREATE_DEDUPE_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_${QUEUE_TABLE}_dedupe
    ON ${QUEUE_TABLE} (employeeId, timestamp, action);
`;

/** Supports the drain's "oldest actionable row first" scan. */
const CREATE_DRAIN_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_${QUEUE_TABLE}_drain
    ON ${QUEUE_TABLE} (status, nextAttemptAt, id);
`;

/** Supports the history merge, which reads everything not yet on the server. */
const CREATE_HISTORY_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_${QUEUE_TABLE}_history
    ON ${QUEUE_TABLE} (employeeId, timestamp);
`;

/** Supports the cascade, which walks from a check-in to its check-out. */
const CREATE_SESSION_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_${QUEUE_TABLE}_session
    ON ${QUEUE_TABLE} (employeeId, sessionId);
`;

/**
 * v1 → v2: the four-state failure model and session pairing.
 *
 * `ALTER TABLE ADD COLUMN` is used rather than a table rebuild because it is
 * atomic, cannot lose rows, and needs no temporary copy — this migration can run
 * from a background relaunch with the OS free to kill the process at any point,
 * and a half-copied table would be unrecoverable.
 *
 * Existing `failed` rows become **blocked, not rejected**. That is the whole
 * principle of this redesign applied backwards: those rows were classified under
 * a model that could not tell "not deployed yet" from "invalid", so the only
 * safe reading is the one that keeps trying and never discards.
 */
const MIGRATE_V2 = `
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN failureClass TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN blockedSince INTEGER;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN resolutionDocname TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN resolvedAt INTEGER;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN sessionId TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN pairedAttendanceId INTEGER;

  UPDATE ${QUEUE_TABLE}
     SET status = '${QUEUE_STATUS.BLOCKED}',
         failureClass = '${FAILURE_CLASS.UNKNOWN}',
         blockedSince = updatedAt
   WHERE status = 'failed';
`;

/** v2 columns, inlined for a fresh install so it skips straight to the top. */
const CREATE_V2_COLUMNS = `
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN failureClass TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN blockedSince INTEGER;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN resolutionDocname TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN resolvedAt INTEGER;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN sessionId TEXT;
  ALTER TABLE ${QUEUE_TABLE} ADD COLUMN pairedAttendanceId INTEGER;
`;

const migrate = async (database) => {
  const row = await database.getFirstAsync("PRAGMA user_version;");
  const current = Number(row?.user_version) || 0;

  if (current >= SCHEMA_VERSION) return;

  // Statement-per-version, applied in order, so a device two versions behind
  // catches up in one open. Each step is wrapped in its own transaction: a
  // process killed between steps resumes from the version it reached.
  if (current < 1) {
    await database.execAsync(`
      BEGIN;
      ${CREATE_QUEUE_TABLE}
      ${CREATE_DEDUPE_INDEX}
      ${CREATE_DRAIN_INDEX}
      ${CREATE_HISTORY_INDEX}
      ${CREATE_V2_COLUMNS}
      ${CREATE_SESSION_INDEX}
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
    return;
  }

  if (current < 2) {
    await database.execAsync(`
      BEGIN;
      ${MIGRATE_V2}
      ${CREATE_SESSION_INDEX}
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }
};

let databasePromise = null;

/**
 * The shared handle. Concurrent callers await the same open — an important
 * detail here, since the sync drain, a geofence listener and the history screen
 * can all reach for the database within the same tick of a cold start.
 *
 * A failed open clears the cached promise so the next caller retries rather
 * than inheriting a permanently rejected one.
 */
export const getDatabase = () => {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
      // WAL keeps the history screen's reads from blocking on the drain's
      // writes; foreign_keys is set for the benefit of any later migration.
      await database.execAsync(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;",
      );
      await migrate(database);
      return database;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
};

/** Drops the cached handle. Tests use it; app code should not need it. */
export const resetDatabaseHandle = () => {
  databasePromise = null;
};

/**
 * Empties the queue. Called on logout alongside the config cache — a queued
 * punch belongs to the employee who made it, and must never sync under the next
 * user's token.
 */
export const clearAttendanceQueue = async () => {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM ${QUEUE_TABLE};`);
};

export default {
  ATTENDANCE_TYPE,
  AWAITING_SERVER_STATUSES,
  DATABASE_NAME,
  FAILURE_CLASS,
  QUEUE_ACTION,
  QUEUE_STATUS,
  QUEUE_TABLE,
  UNRESOLVED_STATUSES,
  actionToLogType,
  clearAttendanceQueue,
  getDatabase,
  logTypeToAction,
  resetDatabaseHandle,
};
