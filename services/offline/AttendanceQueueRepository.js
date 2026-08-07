// src/services/offline/AttendanceQueueRepository.js
import {
  QUEUE_STATUS,
  QUEUE_TABLE,
  getDatabase,
} from "./AttendanceDatabase";

/**
 * Every read and write against `attendance_queue`, and nothing else — no HTTP,
 * no retry policy, no opinion about when a sync should run. Keeping it that way
 * is what lets the sync service be tested against a real in-memory table and the
 * table be reasoned about without reading the sync service.
 *
 * Rows come back out with `payload` and `serverResponse` already parsed and
 * `duplicate` as a boolean, so callers never have to remember which columns are
 * JSON-in-TEXT and which are SQLite's 0/1 integers.
 */

/** Retry ceiling from the spec. Past this a row is `failed` and waits for a human. */
export const MAX_RETRIES = 5;

/**
 * Backoff schedule, in ms, indexed by the attempt about to be made. The spec
 * fixes the first three; the last two continue the same escalation rather than
 * repeating 10 minutes, so a row that is failing for a reason time will not fix
 * stops costing requests quickly.
 */
export const RETRY_DELAYS_MS = [
  30 * 1000, // attempt 1 → 30s
  2 * 60 * 1000, // attempt 2 → 2m
  10 * 60 * 1000, // attempt 3 → 10m
  30 * 60 * 1000, // attempt 4 → 30m
  60 * 60 * 1000, // attempt 5 → 1h
];

/** Delay before the attempt that follows `retryCount` failures. */
export const retryDelayFor = (retryCount) =>
  RETRY_DELAYS_MS[Math.min(Math.max(retryCount, 0), RETRY_DELAYS_MS.length - 1)];

const parseJson = (value, fallback = null) => {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/** DB row → the shape the rest of the app works with. */
const hydrate = (row) => {
  if (!row) return null;

  return {
    ...row,
    duplicate: row.duplicate === 1,
    payload: parseJson(row.payload, {}),
    serverResponse: parseJson(row.serverResponse, null),
  };
};

const hydrateAll = (rows) => (Array.isArray(rows) ? rows.map(hydrate) : []);

// ----------------------
// WRITES
// ----------------------

/**
 * Adds a punch to the queue, or returns the existing row when this exact punch
 * is already queued.
 *
 * The dedupe is the UNIQUE index doing the work, not a preceding SELECT: two
 * callers racing (a geofence EXIT and a tapped Check Out, say) would both pass a
 * read-then-write check and both insert. `ON CONFLICT DO NOTHING` lets the
 * database arbitrate, and the row is read back afterwards so the caller gets the
 * winner either way.
 *
 * @returns {Promise<{row: object, inserted: boolean}>} `inserted: false` means
 *          this punch was already queued and nothing changed.
 */
export const enqueue = async ({
  employeeId,
  employeeDocname = null,
  attendanceType,
  action,
  timestamp,
  latitude = null,
  longitude = null,
  accuracy = null,
  address = null,
  deviceId = null,
  payload = {},
  now = Date.now(),
}) => {
  if (!employeeId) throw new Error("enqueue: employeeId is required");
  if (!timestamp) throw new Error("enqueue: timestamp is required");
  if (!action) throw new Error("enqueue: action is required");

  const database = await getDatabase();

  const result = await database.runAsync(
    `INSERT INTO ${QUEUE_TABLE}
       (employeeId, employeeDocname, attendanceType, action, timestamp,
        latitude, longitude, accuracy, address, deviceId, payload,
        status, retryCount, nextAttemptAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT (employeeId, timestamp, action) DO NOTHING;`,
    [
      employeeId,
      employeeDocname,
      attendanceType,
      action,
      timestamp,
      latitude,
      longitude,
      accuracy,
      address,
      deviceId,
      JSON.stringify(payload ?? {}),
      QUEUE_STATUS.PENDING,
      now,
      now,
    ],
  );

  const inserted = result?.changes > 0;

  const row = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND timestamp = ? AND action = ?
      LIMIT 1;`,
    [employeeId, timestamp, action],
  );

  return { row: hydrate(row), inserted };
};

/**
 * Atomically claims the oldest row that is due, flipping it to `syncing` in the
 * same statement that selects it.
 *
 * Two statements — SELECT then UPDATE — would let a second drain claim the same
 * row in the gap and upload the punch twice. The sync service also holds a
 * single-flight lock, but that lock only covers one JS context; this covers the
 * database, which is the thing that actually has to be right.
 *
 * @param {number} now epoch ms; rows whose backoff has not elapsed are skipped
 * @returns {Promise<object|null>} the claimed row, or null when nothing is due
 */
export const claimNextPending = async (now = Date.now()) => {
  const database = await getDatabase();

  const row = await database.getFirstAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, updatedAt = ?
      WHERE id = (
        SELECT id FROM ${QUEUE_TABLE}
         WHERE status = ? AND nextAttemptAt <= ?
         ORDER BY id ASC
         LIMIT 1
      )
      RETURNING *;`,
    [QUEUE_STATUS.SYNCING, now, QUEUE_STATUS.PENDING, now],
  );

  return hydrate(row);
};

/**
 * Marks a row accepted by the server.
 *
 * `duplicate` rows land here too, deliberately: "this punch already exists" is
 * the desired end state, so it is recorded as synced with the flag set rather
 * than as a failure. `error` is cleared — a row that succeeded on its third
 * attempt should not keep showing the first attempt's message.
 */
export const markSynced = async ({
  id,
  serverCheckinId = null,
  serverResponse = null,
  duplicate = false,
  duplicateMessage = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, serverCheckinId = ?, serverResponse = ?,
            duplicate = ?, duplicateMessage = ?, error = NULL, updatedAt = ?
      WHERE id = ?;`,
    [
      QUEUE_STATUS.SYNCED,
      serverCheckinId,
      serverResponse ? JSON.stringify(serverResponse) : null,
      duplicate ? 1 : 0,
      duplicateMessage,
      now,
      id,
    ],
  );
};

/**
 * Returns a row to `pending` with its backoff armed, after a failure worth
 * repeating.
 *
 * @returns {Promise<{retryCount: number, nextAttemptAt: number}>}
 */
export const markRetry = async ({
  id,
  error = null,
  serverResponse = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  const current = await database.getFirstAsync(
    `SELECT retryCount FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );

  const retryCount = (Number(current?.retryCount) || 0) + 1;
  const nextAttemptAt = now + retryDelayFor(retryCount - 1);

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, retryCount = ?, nextAttemptAt = ?,
            error = ?, serverResponse = ?, updatedAt = ?
      WHERE id = ?;`,
    [
      QUEUE_STATUS.PENDING,
      retryCount,
      nextAttemptAt,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      id,
    ],
  );

  return { retryCount, nextAttemptAt };
};

/**
 * Gives up on a row: a terminal server verdict, or the retry cap.
 *
 * The row is kept, not deleted. It is evidence that the employee tried to punch,
 * it is what the history screen shows as Failed, and it is what a manual retry
 * later resurrects.
 */
export const markFailed = async ({
  id,
  error = null,
  serverResponse = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, error = ?, serverResponse = ?, updatedAt = ?
      WHERE id = ?;`,
    [
      QUEUE_STATUS.FAILED,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      id,
    ],
  );
};

/**
 * Puts failed rows back in the queue, due immediately, with the retry counter
 * cleared. Backs the manual "Retry" affordance.
 *
 * @param {number|null} id a single row, or null for every failed row
 * @returns {Promise<number>} how many rows were requeued
 */
export const retryFailed = async ({ id = null, now = Date.now() } = {}) => {
  const database = await getDatabase();

  const result = id
    ? await database.runAsync(
        `UPDATE ${QUEUE_TABLE}
            SET status = ?, retryCount = 0, nextAttemptAt = 0,
                error = NULL, updatedAt = ?
          WHERE id = ? AND status = ?;`,
        [QUEUE_STATUS.PENDING, now, id, QUEUE_STATUS.FAILED],
      )
    : await database.runAsync(
        `UPDATE ${QUEUE_TABLE}
            SET status = ?, retryCount = 0, nextAttemptAt = 0,
                error = NULL, updatedAt = ?
          WHERE status = ?;`,
        [QUEUE_STATUS.PENDING, now, QUEUE_STATUS.FAILED],
      );

  return result?.changes ?? 0;
};

/**
 * Releases rows stuck in `syncing`.
 *
 * A row is left in that state whenever the process dies mid-request — an OS
 * kill during a background sync, a crash, a force-quit. Nothing would ever claim
 * it again, so the punch would sit invisible and unsent forever. Called at
 * startup, before the first drain.
 *
 * @returns {Promise<number>} how many rows were released
 */
export const releaseStuckSyncing = async (now = Date.now()) => {
  const database = await getDatabase();

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, nextAttemptAt = 0, updatedAt = ?
      WHERE status = ?;`,
    [QUEUE_STATUS.PENDING, now, QUEUE_STATUS.SYNCING],
  );

  return result?.changes ?? 0;
};

/**
 * Drops synced rows older than the retention window.
 *
 * Only `synced` rows: a `failed` row is unresolved business and is never aged
 * out, however old it is.
 *
 * @returns {Promise<number>} how many rows were removed
 */
export const purgeSynced = async ({
  olderThanMs = 7 * 24 * 60 * 60 * 1000,
  now = Date.now(),
} = {}) => {
  const database = await getDatabase();

  const result = await database.runAsync(
    `DELETE FROM ${QUEUE_TABLE}
      WHERE status = ? AND updatedAt < ?;`,
    [QUEUE_STATUS.SYNCED, now - olderThanMs],
  );

  return result?.changes ?? 0;
};

// ----------------------
// READS
// ----------------------

/** One row by id. */
export const findById = async (id) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );
  return hydrate(row);
};

/** Whether this exact punch is already queued, in any state. */
export const findDuplicate = async ({ employeeId, timestamp, action }) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND timestamp = ? AND action = ?
      LIMIT 1;`,
    [employeeId, timestamp, action],
  );
  return hydrate(row);
};

/**
 * Rows for the history screen, newest first.
 *
 * Defaults to everything the server does not yet know about. Synced rows are
 * excluded because the server's own record replaces them in the merged
 * timeline — including them would double every punch.
 */
export const listForHistory = async ({
  employeeId = null,
  statuses = [QUEUE_STATUS.PENDING, QUEUE_STATUS.SYNCING, QUEUE_STATUS.FAILED],
  limit = 200,
} = {}) => {
  const database = await getDatabase();

  const placeholders = statuses.map(() => "?").join(", ");
  const params = [...statuses];

  let where = `status IN (${placeholders})`;
  if (employeeId) {
    where += " AND employeeId = ?";
    params.push(employeeId);
  }
  params.push(limit);

  const rows = await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE ${where}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?;`,
    params,
  );

  return hydrateAll(rows);
};

/** Every row, newest first. Diagnostics and tests. */
export const listAll = async ({ limit = 500 } = {}) => {
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE} ORDER BY id DESC LIMIT ?;`,
    [limit],
  );
  return hydrateAll(rows);
};

/**
 * Row counts per status, as a fully-populated object — every status key is
 * present with 0 rather than absent, so callers can read `counts.failed`
 * without guarding.
 */
export const countByStatus = async (employeeId = null) => {
  const database = await getDatabase();

  const rows = employeeId
    ? await database.getAllAsync(
        `SELECT status, COUNT(*) AS total FROM ${QUEUE_TABLE}
          WHERE employeeId = ? GROUP BY status;`,
        [employeeId],
      )
    : await database.getAllAsync(
        `SELECT status, COUNT(*) AS total FROM ${QUEUE_TABLE} GROUP BY status;`,
      );

  const counts = {
    [QUEUE_STATUS.PENDING]: 0,
    [QUEUE_STATUS.SYNCING]: 0,
    [QUEUE_STATUS.SYNCED]: 0,
    [QUEUE_STATUS.FAILED]: 0,
    total: 0,
  };

  (rows ?? []).forEach(({ status, total }) => {
    const value = Number(total) || 0;
    if (status in counts) counts[status] = value;
    counts.total += value;
  });

  // What the UI actually asks about: "is there anything not on the server yet?"
  counts.unsynced =
    counts[QUEUE_STATUS.PENDING] +
    counts[QUEUE_STATUS.SYNCING] +
    counts[QUEUE_STATUS.FAILED];

  return counts;
};

/** Whether a drain has anything to do at `now`. */
export const hasWorkDue = async (now = Date.now()) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT 1 AS due FROM ${QUEUE_TABLE}
      WHERE status = ? AND nextAttemptAt <= ? LIMIT 1;`,
    [QUEUE_STATUS.PENDING, now],
  );
  return !!row;
};

export default {
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  claimNextPending,
  countByStatus,
  enqueue,
  findById,
  findDuplicate,
  hasWorkDue,
  listAll,
  listForHistory,
  markFailed,
  markRetry,
  markSynced,
  purgeSynced,
  releaseStuckSyncing,
  retryDelayFor,
  retryFailed,
};
