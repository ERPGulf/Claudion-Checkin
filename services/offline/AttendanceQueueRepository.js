// src/services/offline/AttendanceQueueRepository.js
import {
  AWAITING_SERVER_STATUSES,
  FAILURE_CLASS,
  QUEUE_ACTION,
  QUEUE_STATUS,
  QUEUE_TABLE,
  UNRESOLVED_STATUSES,
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

/** Retry ceiling for ordinary transient failures. */
export const MAX_RETRIES = 5;

/**
 * Backoff for transient failures, in ms, indexed by the attempt about to be
 * made. The first three are the specified 30s / 2m / 10m; the last two continue
 * the escalation rather than repeating, so a row failing for a reason time will
 * not fix stops costing requests quickly.
 */
export const RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

/**
 * Backoff for BLOCKED rows — a different problem, so a different ladder.
 *
 * A blocked row is waiting on a person: someone deploying an endpoint, fixing a
 * configuration, restoring a permission. That takes hours or days, so the
 * schedule decays quickly to a floor and stays there. It never terminates —
 * blocked records are retried forever, because the fix lands server-side with no
 * client action and the alternative is losing payroll data.
 *
 * The floor is what stops "never stop retrying" from meaning "hammer the
 * server": at steady state one attempt per six hours, per device.
 */
export const BLOCKED_DELAYS_MS = [
  5 * 60 * 1000, // 5m  — a deploy that is already in flight
  30 * 60 * 1000, // 30m
  2 * 60 * 60 * 1000, // 2h
  6 * 60 * 60 * 1000, // 6h — the floor, repeated forever
];

/** Delay before the attempt that follows `retryCount` transient failures. */
export const retryDelayFor = (retryCount) =>
  RETRY_DELAYS_MS[Math.min(Math.max(retryCount, 0), RETRY_DELAYS_MS.length - 1)];

/** Delay before the next attempt on a row blocked `blockedCount` times. */
export const blockedDelayFor = (blockedCount) =>
  BLOCKED_DELAYS_MS[
    Math.min(Math.max(blockedCount, 0), BLOCKED_DELAYS_MS.length - 1)
  ];

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

const placeholdersFor = (values) => values.map(() => "?").join(", ");

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
  sessionId = null,
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
        status, retryCount, nextAttemptAt, sessionId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
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
      sessionId,
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
 * Links a queued check-out to the check-in it closes.
 *
 * Pairing is derived from the queue, deliberately, and NOT from the session
 * state machine. `performSessionTransition` holds its lock across the whole
 * `execute()` call, and `readSession()` takes that same lock — reading the
 * session from inside the enqueue path would deadlock. The queue already knows
 * everything needed: the most recent unpaired check-in for this employee at or
 * before this check-out is, by construction, the one it closes.
 *
 * A check-out with no local check-in is normal and left unpaired: it means the
 * check-in synced while online, so the server already has it and there is
 * nothing to keep consistent.
 *
 * @returns {Promise<object|null>} the check-in it was paired with, or null
 */
export const pairWithOpenCheckin = async ({
  checkoutId,
  employeeId,
  timestamp,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  const checkin = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE employeeId = ?
        AND action = ?
        AND pairedAttendanceId IS NULL
        AND timestamp <= ?
        AND status IN (${placeholdersFor(UNRESOLVED_STATUSES)})
      ORDER BY timestamp DESC, id DESC
      LIMIT 1;`,
    [employeeId, QUEUE_ACTION.CHECKIN, timestamp, ...UNRESOLVED_STATUSES],
  );

  if (!checkin) return null;

  // One id for the pair, so the cascade and the correction flow can both address
  // "this attendance session" rather than two unrelated rows.
  const sessionId = checkin.sessionId || `s-${employeeId}-${checkin.id}`;

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET pairedAttendanceId = ?, sessionId = ?, updatedAt = ?
      WHERE id = ?;`,
    [checkoutId, sessionId, now, checkin.id],
  );

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET pairedAttendanceId = ?, sessionId = ?, updatedAt = ?
      WHERE id = ?;`,
    [checkin.id, sessionId, now, checkoutId],
  );

  return hydrate({ ...checkin, sessionId });
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
 * Only `pending` rows are claimable. Blocked rows are woken back to pending by
 * `wakeBlocked` on their own schedule, which keeps "is it due" in one place and
 * stops a blocked row being picked up before its backoff has elapsed.
 *
 * `employeeId` scopes the claim to one employee's punches. A queued punch is
 * uploaded with whatever token the device currently holds, so draining another
 * employee's rows after a user switch would file their attendance against the
 * person now logged in. Scoping *skips* those rows rather than deleting them —
 * they are still that employee's data, and they drain normally the next time
 * they log in on this device. Omitting it drains everything, which is only ever
 * correct in tests.
 *
 * ## Strict per-employee ordering
 *
 * `ORDER BY timestamp ASC` alone does NOT give FIFO, because the ordering is
 * applied only to rows that are claimable *right now*. An older punch that is
 * `blocked`, or `pending` but still inside its retry backoff, is invisible to
 * that ORDER BY — so a newer punch is claimed and uploaded ahead of it. For a
 * check-out followed by a check-in that inverts the employee's day: the server
 * receives the IN while it still believes the earlier session is open, which is
 * precisely the duplicate-session failure this queue exists to prevent.
 *
 * So the NOT EXISTS below makes each employee's queue strictly head-of-line: a
 * row is claimable only when nothing older for that employee is still capable of
 * reaching the server. "Older" is `(timestamp, id)`, the same total order the
 * ORDER BY uses, so the two cannot disagree.
 *
 * Which statuses count as a dependency is the same judgement
 * `mayAffectServerCount` makes, and for the same reason:
 *
 *  - `pending` / `syncing` — will land, possibly in a moment. Must block.
 *  - `blocked` — will land once auth or configuration is fixed. Must block.
 *  - `blocked` + `endpoint-missing` — can never land without a deployment, and
 *    is kept forever. Blocking on it would stall the employee's queue
 *    permanently, so it is explicitly excluded.
 *  - `rejected` / `resolved` / `synced` — the server is done with them.
 *
 * This is one statement, so the check and the claim cannot be separated by
 * another drain: there is no window in which two contexts both decide a row is
 * at the head.
 */
export const claimNextPending = async (now = Date.now(), { employeeId = null } = {}) => {
  const database = await getDatabase();

  const scope = employeeId ? " AND candidate.employeeId = ?" : "";
  const scopeParams = employeeId ? [employeeId] : [];

  const row = await database.getFirstAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, updatedAt = ?
      WHERE id = (
        SELECT candidate.id FROM ${QUEUE_TABLE} AS candidate
         WHERE candidate.status = ? AND candidate.nextAttemptAt <= ?${scope}
           AND NOT EXISTS (
             SELECT 1 FROM ${QUEUE_TABLE} AS older
              WHERE older.employeeId = candidate.employeeId
                AND (older.timestamp < candidate.timestamp
                     OR (older.timestamp = candidate.timestamp
                         AND older.id < candidate.id))
                AND (
                  older.status IN (?, ?)
                  OR (older.status = ? AND IFNULL(older.failureClass, '') <> ?)
                )
           )
         ORDER BY candidate.timestamp ASC, candidate.id ASC
         LIMIT 1
      )
      RETURNING *;`,
    [
      QUEUE_STATUS.SYNCING,
      now,
      QUEUE_STATUS.PENDING,
      now,
      ...scopeParams,
      QUEUE_STATUS.PENDING,
      QUEUE_STATUS.SYNCING,
      QUEUE_STATUS.BLOCKED,
      FAILURE_CLASS.ENDPOINT_MISSING,
    ],
  );

  return hydrate(row);
};

/**
 * Marks a row accepted by the server.
 *
 * `duplicate` rows land here too, deliberately: "this punch already exists" is
 * the desired end state, so it is recorded as synced with the flag set rather
 * than as a failure.
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
            duplicate = ?, duplicateMessage = ?, error = NULL,
            failureClass = NULL, blockedSince = NULL, updatedAt = ?
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
 * Returns a row to `pending` with its transient backoff armed.
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
 * Parks a row the server cannot accept yet.
 *
 * `retryCount` is deliberately NOT advanced — that counter drives the transient
 * ladder and its cap, and a blocked row must never age into a terminal state.
 * The blocked schedule is driven by how long the row has been blocked instead,
 * which is what `blockedSince` records.
 *
 * @returns {Promise<{nextAttemptAt: number, blockedSince: number}>}
 */
export const markBlocked = async ({
  id,
  failureClass = FAILURE_CLASS.UNKNOWN,
  error = null,
  serverResponse = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  const current = await database.getFirstAsync(
    `SELECT blockedSince FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );

  const blockedSince = Number(current?.blockedSince) || now;
  // Position on the ladder from elapsed blocked time rather than an attempt
  // counter, so waking a row early (launch, reconnect, token refresh) cannot
  // walk it down to the floor faster than real time does.
  const elapsed = now - blockedSince;
  const step = BLOCKED_DELAYS_MS.findIndex((delay) => elapsed < delay);
  const nextAttemptAt =
    now + blockedDelayFor(step === -1 ? BLOCKED_DELAYS_MS.length - 1 : step);

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, failureClass = ?, blockedSince = ?, nextAttemptAt = ?,
            error = ?, serverResponse = ?, updatedAt = ?
      WHERE id = ?;`,
    [
      QUEUE_STATUS.BLOCKED,
      failureClass,
      blockedSince,
      nextAttemptAt,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      id,
    ],
  );

  return { nextAttemptAt, blockedSince };
};

/**
 * Records a row the server will never accept, and cascades to the rest of its
 * attendance session.
 *
 * The cascade is the data-integrity rule: a check-out whose check-in was
 * rejected must not be uploaded on its own, or the server ends up holding an OUT
 * with no matching IN — a session no report can reconcile and no one can
 * correct cleanly. One rejected punch invalidates the session, and one
 * correction request resolves the whole thing.
 *
 * @returns {Promise<{cascaded: number}>} how many paired rows were also rejected
 */
export const markRejected = async ({
  id,
  failureClass = FAILURE_CLASS.VALIDATION,
  error = null,
  serverResponse = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, failureClass = ?, error = ?, serverResponse = ?,
            nextAttemptAt = 0, updatedAt = ?
      WHERE id = ?;`,
    [
      QUEUE_STATUS.REJECTED,
      failureClass,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      id,
    ],
  );

  const row = await database.getFirstAsync(
    `SELECT pairedAttendanceId FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );

  const pairedId = row?.pairedAttendanceId;
  if (!pairedId) return { cascaded: 0 };

  // Only rows still awaiting an outcome. A pair already synced is a fact on the
  // server and cannot be un-sent; a pair already rejected needs no second
  // rejection.
  const cascade = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, failureClass = ?, error = ?, nextAttemptAt = 0,
            updatedAt = ?
      WHERE id = ? AND status IN (${placeholdersFor(AWAITING_SERVER_STATUSES)});`,
    [
      QUEUE_STATUS.REJECTED,
      FAILURE_CLASS.DEPENDENT,
      "Dependent on rejected check-in.",
      now,
      pairedId,
      ...AWAITING_SERVER_STATUSES,
    ],
  );

  return { cascaded: cascade?.changes ?? 0 };
};

/**
 * Marks a rejected record superseded by an attendance correction request, and
 * carries the whole session with it.
 *
 * The row is kept, not deleted — it is the evidence of what the employee
 * originally punched, and payroll disputes are settled with exactly that. It
 * simply stops counting as unresolved, which is what clears the banner.
 *
 * @returns {Promise<number>} how many rows were resolved (1, or 2 for a pair)
 */
export const markResolved = async ({
  id,
  resolutionDocname = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();

  const row = await database.getFirstAsync(
    `SELECT pairedAttendanceId FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );

  const ids = [id];
  if (row?.pairedAttendanceId) ids.push(row.pairedAttendanceId);

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, resolutionDocname = ?, resolvedAt = ?, updatedAt = ?
      WHERE id IN (${placeholdersFor(ids)}) AND status = ?;`,
    [
      QUEUE_STATUS.RESOLVED,
      resolutionDocname,
      now,
      now,
      ...ids,
      QUEUE_STATUS.REJECTED,
    ],
  );

  return result?.changes ?? 0;
};

/**
 * Returns blocked rows to the queue.
 *
 * `force` ignores the backoff, for the events that genuinely change the odds:
 * an app launch (the server may have been upgraded since), a reconnect, and a
 * successful token refresh. The scheduled tick passes `force: false` and
 * respects the ladder.
 *
 * `failureClass` narrows it — a token refresh should wake auth-blocked rows
 * without also re-attempting rows blocked on a missing endpoint.
 *
 * @returns {Promise<number>} how many rows were woken
 */
export const wakeBlocked = async ({
  force = false,
  failureClass = null,
  now = Date.now(),
} = {}) => {
  const database = await getDatabase();

  const conditions = ["status = ?"];
  const params = [QUEUE_STATUS.BLOCKED];

  if (!force) {
    conditions.push("nextAttemptAt <= ?");
    params.push(now);
  }

  if (failureClass) {
    conditions.push("failureClass = ?");
    params.push(failureClass);
  }

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, nextAttemptAt = 0, updatedAt = ?
      WHERE ${conditions.join(" AND ")};`,
    [QUEUE_STATUS.PENDING, now, ...params],
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
 * `failureClass` and `blockedSince` are preserved: a row that was blocked, woken
 * and then stranded mid-attempt must not lose its history and restart the
 * blocked ladder from the top.
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
 * Only `synced`. Blocked, rejected and resolved rows are never aged out:
 * the first two are unresolved business however old, and the third is the audit
 * trail behind a correction request.
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

/** Both rows of an attendance session, oldest first. */
export const findSessionRows = async (sessionId) => {
  if (!sessionId) return [];
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE sessionId = ? ORDER BY timestamp ASC, id ASC;`,
    [sessionId],
  );
  return hydrateAll(rows);
};

/**
 * Rows the employee still needs an outcome on, newest first — what the banner
 * and the sync sheet describe.
 */
export const listUnresolved = async ({ employeeId = null, limit = 100 } = {}) => {
  const database = await getDatabase();

  const params = [...UNRESOLVED_STATUSES];
  let where = `status IN (${placeholdersFor(UNRESOLVED_STATUSES)})`;
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

/**
 * Rows for the history screen, newest first.
 *
 * Defaults to every state the timeline draws a chip for. Synced rows are
 * included so a punch does not blink out between uploading and the history query
 * refetching; `mergeQueuedRecords` drops each one once the server's copy arrives.
 */
export const listForHistory = async ({
  employeeId = null,
  statuses = [
    QUEUE_STATUS.PENDING,
    QUEUE_STATUS.SYNCING,
    QUEUE_STATUS.BLOCKED,
    QUEUE_STATUS.REJECTED,
    QUEUE_STATUS.RESOLVED,
    QUEUE_STATUS.SYNCED,
  ],
  limit = 200,
} = {}) => {
  const database = await getDatabase();

  const params = [...statuses];
  let where = `status IN (${placeholdersFor(statuses)})`;
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
 * Row counts, one named field per status plus the three derived totals the app
 * actually asks about.
 *
 * The old single `unsynced` field served three callers that wanted three
 * different things, which is exactly the kind of shared derived value that
 * breaks silently when a status is added. Each consumer now names what it means:
 *
 *  - `pendingCount` / `syncingCount` — work in motion, for the sync indicator
 *  - `blockedCount` — waiting on an administrator
 *  - `rejectedCount` — waiting on a correction
 *  - `unresolvedCount` — anything without an outcome, for the history badge
 *  - `awaitingServerCount` — **excludes rejected.** The attendance screen's
 *    reconnect guard uses this: the server has already refused rejected rows, so
 *    its "no open session" is correct about them and must be allowed to close
 *    the session. Counting them would hold a session open forever.
 *  - `mayAffectServerCount` — awaiting rows that could still change what the
 *    server thinks, which is a stricter question than "is anything queued".
 *
 * ## Why `mayAffectServerCount` exists
 *
 * `awaitingServerCount` counts every blocked row, and blocked rows are kept
 * forever by design. That is right for a row blocked on auth or on server
 * configuration: someone refreshes a token or fixes a setting and the row lands,
 * so until then the server's view of the session is genuinely unsettled.
 *
 * It is wrong for `endpoint-missing`. That row is blocked on a deployment, not
 * on anything that will resolve on its own, and while it sits there
 * `awaitingServerCount` never returns to zero. A caller that waits for zero
 * before acting — `reconcilePresence` waits before it will open a session —
 * would stop working permanently on any tenant without the offline endpoint
 * deployed. One undeployable row would disable automatic check-in for good.
 *
 * So this count asks the narrower question the guards actually mean: *could any
 * of these still create or close a session on the server?* Only
 * `endpoint-missing` is excluded, and only while blocked — the row is still
 * kept, still retried, and still counted everywhere else. If the endpoint is
 * later deployed, one success flips it back and it is counted again.
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
    [QUEUE_STATUS.BLOCKED]: 0,
    [QUEUE_STATUS.REJECTED]: 0,
    [QUEUE_STATUS.RESOLVED]: 0,
    total: 0,
  };

  (rows ?? []).forEach(({ status, total }) => {
    const value = Number(total) || 0;
    if (status in counts) counts[status] = value;
    counts.total += value;
  });

  counts.pendingCount = counts[QUEUE_STATUS.PENDING];
  counts.syncingCount = counts[QUEUE_STATUS.SYNCING];
  counts.syncedCount = counts[QUEUE_STATUS.SYNCED];
  counts.blockedCount = counts[QUEUE_STATUS.BLOCKED];
  counts.rejectedCount = counts[QUEUE_STATUS.REJECTED];
  counts.resolvedCount = counts[QUEUE_STATUS.RESOLVED];

  counts.unresolvedCount =
    counts.pendingCount +
    counts.syncingCount +
    counts.blockedCount +
    counts.rejectedCount;

  counts.awaitingServerCount =
    counts.pendingCount + counts.syncingCount + counts.blockedCount;

  // Blocked rows split by *why*. Only the undeliverable class is separated out;
  // auth, configuration and unknown all remain things that can still land.
  const blockedRows = employeeId
    ? await database.getAllAsync(
        `SELECT failureClass, COUNT(*) AS total FROM ${QUEUE_TABLE}
          WHERE status = ? AND employeeId = ? GROUP BY failureClass;`,
        [QUEUE_STATUS.BLOCKED, employeeId],
      )
    : await database.getAllAsync(
        `SELECT failureClass, COUNT(*) AS total FROM ${QUEUE_TABLE}
          WHERE status = ? GROUP BY failureClass;`,
        [QUEUE_STATUS.BLOCKED],
      );

  counts.blockedUndeliverableCount = (blockedRows ?? []).reduce(
    (total, { failureClass, total: rowTotal }) =>
      failureClass === FAILURE_CLASS.ENDPOINT_MISSING
        ? total + (Number(rowTotal) || 0)
        : total,
    0,
  );

  counts.mayAffectServerCount =
    counts.awaitingServerCount - counts.blockedUndeliverableCount;

  return counts;
};

/** Whether a drain has anything to do at `now`, including due blocked rows. */
export const hasWorkDue = async (now = Date.now()) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT 1 AS due FROM ${QUEUE_TABLE}
      WHERE status IN (?, ?) AND nextAttemptAt <= ? LIMIT 1;`,
    [QUEUE_STATUS.PENDING, QUEUE_STATUS.BLOCKED, now],
  );
  return !!row;
};

export default {
  BLOCKED_DELAYS_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  blockedDelayFor,
  claimNextPending,
  countByStatus,
  enqueue,
  findById,
  findDuplicate,
  findSessionRows,
  hasWorkDue,
  listAll,
  listForHistory,
  listUnresolved,
  markBlocked,
  markRejected,
  markResolved,
  markRetry,
  markSynced,
  pairWithOpenCheckin,
  purgeSynced,
  releaseStuckSyncing,
  retryDelayFor,
  wakeBlocked,
};
