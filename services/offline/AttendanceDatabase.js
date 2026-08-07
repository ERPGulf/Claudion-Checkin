// src/services/offline/AttendanceDatabase.js
import * as SQLite from "expo-sqlite";

/**
 * The offline attendance store.
 *
 * SQLite rather than AsyncStorage because this table is queried, not just read:
 * the sync drain wants "oldest pending row whose backoff has elapsed", the
 * history screen wants "everything unsynced", and the dedupe rule wants an
 * atomic "insert unless this punch is already queued". Doing any of those over a
 * JSON blob means reading and rewriting the whole queue on every touch, and the
 * dedupe check stops being atomic — which matters, because a geofence event and
 * a screen tap genuinely can race.
 *
 * Every export here is async and the handle is opened lazily exactly once, so
 * nothing in this module runs at import time. Geofence listeners can call into
 * the queue seconds after an OS relaunch, before any screen has mounted; a
 * module-scope open would race that.
 */

export const DATABASE_NAME = "claudion-attendance.db";
export const QUEUE_TABLE = "attendance_queue";

/** Row lifecycle. `synced` is terminal-happy, `failed` is terminal-sad. */
export const QUEUE_STATUS = {
  PENDING: "pending",
  SYNCING: "syncing",
  SYNCED: "synced",
  FAILED: "failed",
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

/**
 * Schema version. Bump it and add a `case` in `migrate` — never edit an
 * existing statement, since installs in the field are already at that version.
 */
const SCHEMA_VERSION = 1;

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
 * The local duplicate rule from the spec — one row per (employee, timestamp,
 * action) — expressed as a constraint rather than a read-then-write check, so
 * two concurrent enqueues cannot both pass the check and both insert.
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

const migrate = async (database) => {
  const row = await database.getFirstAsync("PRAGMA user_version;");
  const current = Number(row?.user_version) || 0;

  if (current >= SCHEMA_VERSION) return;

  // Statement-per-version, applied in order, so a device two versions behind
  // catches up in one open.
  if (current < 1) {
    await database.execAsync(`
      ${CREATE_QUEUE_TABLE}
      ${CREATE_DEDUPE_INDEX}
      ${CREATE_DRAIN_INDEX}
      ${CREATE_HISTORY_INDEX}
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
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
 * Empties the queue. Called on logout alongside `clearSessionState()` — a
 * queued punch belongs to the employee who made it, and must never sync under
 * the next user's token.
 */
export const clearAttendanceQueue = async () => {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM ${QUEUE_TABLE};`);
};

export default {
  ATTENDANCE_TYPE,
  DATABASE_NAME,
  QUEUE_ACTION,
  QUEUE_STATUS,
  QUEUE_TABLE,
  actionToLogType,
  clearAttendanceQueue,
  getDatabase,
  logTypeToAction,
  resetDatabaseHandle,
};
