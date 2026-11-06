// src/services/offline/AttendanceQueueRepository.js
import {
  AWAITING_SERVER_STATUSES,
  ATTENDANCE_TYPE,
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

/**
 * Retry ceiling for ordinary transient failures.
 *
 * High because the ladder below is fast: what matters is not the number of
 * attempts but how long the row keeps getting them before it is parked as
 * `blocked`, since parking it shows the employee an administrator banner. Fifteen
 * attempts on the schedule below spans a little under an hour, which is about
 * what five attempts on the old slow ladder spanned — the same patience, spent
 * as many quick tries instead of a few widely-spaced ones.
 */
export const MAX_RETRIES = 15;

/**
 * Backoff for transient failures, in ms, indexed by the attempt about to be
 * made.
 *
 * Deliberately front-loaded: the first retry is five seconds after the failure,
 * because the overwhelming majority of these are a lift, a stairwell, a car park or
 * a few seconds of bad signal, and a punch that could have landed at 05:13:05
 * has no business waiting until 05:13:35. It settles at five minutes rather than
 * escalating to an hour, so a row that is failing for a longer-lived reason
 * still gets a dozen attempts inside the window instead of two.
 *
 * The old schedule (30s / 2m / 10m / 30m / 1h) was sized to protect the server
 * from a client that might be wrong about being online. It has cost real
 * attendance latency, and the protection is better provided by the things that
 * cannot be tuned away: one row per request, one drain at a time, and a halt on
 * the first transient failure.
 */
export const RETRY_DELAYS_MS = [
  5 * 1000,
  15 * 1000,
  45 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
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
 * server": at steady state one attempt per hour, per device. It was six hours,
 * which meant a punch could sit for most of a working day after the fix that
 * would have let it through had already been deployed.
 */
export const BLOCKED_DELAYS_MS = [
  60 * 1000, // 1m  — a deploy or a restart that is already in flight
  5 * 60 * 1000, // 5m
  20 * 60 * 1000, // 20m
  60 * 60 * 1000, // 1h — the floor, repeated forever
];

/** Delay before the attempt that follows `retryCount` transient failures. */
export const retryDelayFor = (retryCount) =>
  RETRY_DELAYS_MS[Math.min(Math.max(retryCount, 0), RETRY_DELAYS_MS.length - 1)];

/** Delay before the next attempt on a row blocked `blockedCount` times. */
export const blockedDelayFor = (blockedCount) =>
  BLOCKED_DELAYS_MS[
    Math.min(Math.max(blockedCount, 0), BLOCKED_DELAYS_MS.length - 1)
  ];

// Review recovery is a bounded, read-only history check. It never makes an
// uncertain upload eligible for another POST, including older rows that did
// not record a reason when they entered review.
export const REVIEW_RECHECK_INTERVAL_MS = 60 * 1000;
const REVIEW_RECHECK_ROWS_PER_RUN = 5;
export const REVIEW_RECHECK_ISSUES = [
  "upload-outcome-unverified",
  "server-unavailable",
  "no-exact-match-in-visible-history",
  "unrecognized-server-response",
  "multiple-server-records",
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
    verificationEvidence: parseJson(row.verificationEvidence, null),
  };
};

const hydrateAll = (rows) => (Array.isArray(rows) ? rows.map(hydrate) : []);

const placeholdersFor = (values) => values.map(() => "?").join(", ");

// UI reads may include unattributed legacy evidence without adopting it. A
// known foreign tenant is always excluded when a tenant scope is supplied.
const readScope = (employeeId, tenantKey, includeUnknownTenant) => {
  const conditions = [];
  const params = [];
  if (employeeId) {
    conditions.push("employeeId = ?");
    params.push(employeeId);
  }
  if (tenantKey) {
    conditions.push(includeUnknownTenant ? "(tenantKey = ? OR tenantKey IS NULL)" : "tenantKey = ?");
    params.push(tenantKey);
  }
  return { sql: conditions.length ? ` AND ${conditions.join(" AND ")}` : "", params };
};

const retryAfterDelay = (value) => Number.isFinite(value) && value > 0 ? value : 0;

// Preflight Retry-After is app-owned metadata on a never-dispatched row. It
// must survive both the clock-skew repair and an explicit Sync now action.
const PREFLIGHT_RETRY_AFTER_SQL = `COALESCE(CASE
  WHEN uploadAttemptAt IS NULL AND json_valid(serverResponse)
    THEN json_extract(serverResponse, '$.instanceAvailability.retryAfterAt')
  END, 0) <= ?`;

// An unresolved older row that holds `candidate` back; shared with explainUnclaimable.
const OLDER_DEPENDENCY_SQL = `older.employeeId = candidate.employeeId
       AND (older.tenantKey IS candidate.tenantKey OR older.tenantKey IS NULL)
       AND ((older.tenantKey IS NULL AND candidate.tenantKey IS NOT NULL)
         OR CASE
           WHEN candidate.sourceEventId IS NOT NULL AND older.tenantKey IS candidate.tenantKey
             THEN (older.sourceEventId IS NULL OR older.id < candidate.id)
           WHEN candidate.sourceEventId IS NULL AND older.sourceEventId IS NOT NULL
             AND older.tenantKey IS candidate.tenantKey THEN 0
           ELSE (older.timestamp < candidate.timestamp
             OR (older.timestamp = candidate.timestamp AND older.id < candidate.id)) END)
       AND (older.status IN ('pending', 'syncing', 'needs_review')
         OR (older.status = 'synced' AND older.acceptanceConfirmed <> 1)
         OR (older.status = 'blocked' AND IFNULL(older.failureClass, '') <> 'endpoint-missing'))`;

// Shared by the atomic claim and read-only support diagnostics. Do not infer
// claimability just from status/due time: an older row or pair can prevent it.
const CLAIM_DEPENDENCIES_SQL = `
  NOT EXISTS (
    SELECT 1 FROM ${QUEUE_TABLE} AS older
     WHERE ${OLDER_DEPENDENCY_SQL}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${QUEUE_TABLE} AS paired
     WHERE paired.id = candidate.pairedAttendanceId
       AND (paired.tenantKey IS NOT candidate.tenantKey OR paired.employeeId <> candidate.employeeId)
       AND paired.status IN ('pending', 'syncing', 'blocked', 'needs_review')
  ) AND (
    candidate.action <> 'checkout' OR candidate.pairedAttendanceId IS NULL OR EXISTS (
      SELECT 1 FROM ${QUEUE_TABLE} AS checkin
       WHERE checkin.id = candidate.pairedAttendanceId AND checkin.action = 'checkin'
         AND checkin.tenantKey IS candidate.tenantKey AND checkin.employeeId = candidate.employeeId
         AND checkin.status = 'synced' AND checkin.acceptanceConfirmed = 1
    )
  ) AND (
    (CASE WHEN json_valid(candidate.payload) THEN json_extract(candidate.payload, '$.sourceParentEventId') END) IS NULL OR EXISTS (
      SELECT 1 FROM ${QUEUE_TABLE} AS parent
       WHERE parent.sourceEventId = (CASE WHEN json_valid(candidate.payload) THEN json_extract(candidate.payload, '$.sourceParentEventId') END)
         AND parent.tenantKey IS candidate.tenantKey AND parent.employeeId = candidate.employeeId
         AND parent.status = 'synced' AND parent.acceptanceConfirmed = 1
    )
  )`;

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
  tenantKey = null,
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
  sourceEventId = null,
  assertCurrent,
  now = Date.now(),
}) => {
  if (!employeeId) throw new Error("enqueue: employeeId is required");
  if (!timestamp) throw new Error("enqueue: timestamp is required");
  if (!action) throw new Error("enqueue: action is required");

  const database = await getDatabase();

  if (typeof assertCurrent === "function") {
    // Recovery of an accepted row is evidence, not new admission. Keep it
    // available after policy changes while guarding the actual new INSERT.
    const sourceRow = sourceEventId ? await database.getFirstAsync(
      `SELECT * FROM ${QUEUE_TABLE}
        WHERE tenantKey IS ? AND employeeId = ? AND sourceEventId = ? LIMIT 1;`,
      [tenantKey, employeeId, sourceEventId],
    ) : null;
    const existing = sourceRow ?? await database.getFirstAsync(
      `SELECT * FROM ${QUEUE_TABLE}
        WHERE tenantKey IS ? AND employeeId = ? AND timestamp = ? AND action = ? LIMIT 1;`,
      [tenantKey, employeeId, timestamp, action],
    );
    if (existing) return { row: hydrate(existing), inserted: false };
    // This callback is synchronous: no awaited policy/DB preparation may
    // separate current authorization from submitting the database write.
    assertCurrent();
  }

  // A checkout of a checkin stranded on `endpoint-missing` is admitted blocked
  // with it, for the reason given on markBlocked.
  const result = await database.runAsync(
    `WITH input(employeeId, employeeDocname, tenantKey, attendanceType, action, timestamp,
       latitude, longitude, accuracy, address, deviceId, payload, sessionId, sourceEventId, now)
       AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)),
     admission AS MATERIALIZED (
       SELECT input.* FROM input WHERE NOT EXISTS (
         SELECT 1 FROM ${QUEUE_TABLE} AS existing WHERE existing.tenantKey IS input.tenantKey
           AND existing.employeeId = input.employeeId AND (
             (existing.timestamp = input.timestamp AND existing.action = input.action)
             OR (input.sourceEventId IS NOT NULL AND existing.sourceEventId = input.sourceEventId))
       )
     ), parent AS MATERIALIZED (
       SELECT checkin.* FROM ${QUEUE_TABLE} AS checkin JOIN admission AS input
        WHERE input.action = 'checkout' AND checkin.action = 'checkin'
          AND checkin.employeeId = input.employeeId AND checkin.tenantKey IS input.tenantKey
          AND IFNULL(json_extract(input.payload, '$.parentServerConfirmed'), 0) <> 1
          AND checkin.pairedAttendanceId IS NULL
          AND CASE
            WHEN json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
              THEN checkin.id = json_extract(input.payload, '$.parentQueueRowId')
            WHEN json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL
              THEN checkin.sourceEventId = json_extract(input.payload, '$.sourceParentEventId')
            ELSE checkin.timestamp <= input.timestamp END
          AND (checkin.status IN ('pending', 'syncing', 'blocked', 'rejected', 'needs_review')
            OR (checkin.status = 'synced' AND (json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
              OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL)))
        ORDER BY checkin.timestamp DESC, checkin.id DESC LIMIT 1
     ), next_id AS MATERIALIZED (
       SELECT MAX(COALESCE((SELECT MAX(id) FROM ${QUEUE_TABLE}), 0),
         COALESCE((SELECT seq FROM sqlite_sequence WHERE name = '${QUEUE_TABLE}'), 0)) + 1 AS value
     )
     INSERT INTO ${QUEUE_TABLE}
       (id, employeeId, employeeDocname, tenantKey, attendanceType, action, timestamp,
        latitude, longitude, accuracy, address, deviceId, payload,
        status, retryCount, nextAttemptAt, sessionId, sourceEventId, createdAt, updatedAt,
        pairedAttendanceId, failureClass, error, blockedSince)
     SELECT next_id.value, input.employeeId, input.employeeDocname, input.tenantKey,
       input.attendanceType, input.action, input.timestamp, input.latitude, input.longitude,
       input.accuracy, input.address, input.deviceId, input.payload,
       CASE WHEN parent.status = 'rejected' THEN
         CASE WHEN json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL THEN 'rejected' ELSE 'needs_review' END
         WHEN parent.id IS NULL AND (json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL) THEN 'needs_review'
         WHEN parent.status = 'blocked' AND parent.failureClass = 'endpoint-missing' THEN 'blocked'
         ELSE 'pending' END, 0,
       CASE WHEN parent.status = 'blocked' AND parent.failureClass = 'endpoint-missing'
         THEN parent.nextAttemptAt ELSE 0 END,
       CASE WHEN parent.id IS NULL OR (parent.status = 'rejected'
         AND json_extract(input.payload, '$.parentQueueRowId') IS NULL
         AND json_extract(input.payload, '$.sourceParentEventId') IS NULL) THEN input.sessionId
         ELSE COALESCE(parent.sessionId, 's-' || input.employeeId || '-' || parent.id) END,
       input.sourceEventId, input.now, input.now,
       CASE WHEN parent.status = 'rejected' AND json_extract(input.payload, '$.parentQueueRowId') IS NULL
         AND json_extract(input.payload, '$.sourceParentEventId') IS NULL THEN NULL ELSE parent.id END,
       CASE WHEN parent.status = 'rejected' THEN
         CASE WHEN json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL THEN 'dependent' ELSE 'verification-required' END
         WHEN parent.id IS NULL AND (json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL) THEN 'verification-required'
         WHEN parent.status = 'blocked' AND parent.failureClass = 'endpoint-missing' THEN 'endpoint-missing' END,
       CASE WHEN parent.status = 'rejected' THEN
         CASE WHEN json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL
           THEN 'Dependent on rejected check-in.' ELSE 'The current attendance parent could not be proven.' END
         WHEN parent.id IS NULL AND (json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
           OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL) THEN 'The current attendance parent could not be proven.'
         WHEN parent.status = 'blocked' AND parent.failureClass = 'endpoint-missing' THEN 'Dependent on blocked check-in.' END,
       CASE WHEN parent.status = 'blocked' AND parent.failureClass = 'endpoint-missing' THEN parent.blockedSince END
       FROM admission AS input CROSS JOIN next_id LEFT JOIN parent ON 1 = 1
     UNION ALL
     SELECT parent.id, parent.employeeId, parent.employeeDocname, parent.tenantKey,
       parent.attendanceType, parent.action, parent.timestamp, parent.latitude, parent.longitude,
       parent.accuracy, parent.address, parent.deviceId, parent.payload, parent.status,
       parent.retryCount, parent.nextAttemptAt,
       COALESCE(parent.sessionId, 's-' || parent.employeeId || '-' || parent.id),
       parent.sourceEventId, parent.createdAt, input.now, next_id.value, parent.failureClass, parent.error,
       parent.blockedSince
       FROM parent CROSS JOIN admission AS input CROSS JOIN next_id
        WHERE parent.status <> 'rejected' OR json_extract(input.payload, '$.parentQueueRowId') IS NOT NULL
          OR json_extract(input.payload, '$.sourceParentEventId') IS NOT NULL
     ON CONFLICT(id) DO UPDATE SET pairedAttendanceId = excluded.pairedAttendanceId,
       sessionId = excluded.sessionId, updatedAt = excluded.updatedAt
     ON CONFLICT DO NOTHING;`,
    [
      employeeId,
      employeeDocname,
      tenantKey,
      attendanceType,
      action,
      timestamp,
      latitude,
      longitude,
      accuracy,
      address,
      deviceId,
      JSON.stringify(payload ?? {}),
      sessionId,
      sourceEventId,
      now,
    ],
  );

  const inserted = result?.changes > 0;

  const sourceRow = sourceEventId ? await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE tenantKey IS ? AND employeeId = ? AND sourceEventId = ? LIMIT 1;`,
    [tenantKey, employeeId, sourceEventId],
  ) : null;
  const row = sourceRow ?? await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE tenantKey IS ? AND employeeId = ? AND timestamp = ? AND action = ?
      LIMIT 1;`,
    [tenantKey, employeeId, timestamp, action],
  );

  return { row: hydrate(row), inserted };
};

/**
 * A legacy direct automatic POST needs durable dispatch evidence too. Insert
 * it already owned and dispatched in one statement: exposing a pending row
 * before a second UPDATE would allow another runtime to upload it first.
 * This receipt records online intent, not admission to offline attendance.
 */
export const beginDirectAttendanceReceipt = async ({
  employeeId,
  employeeDocname = null,
  tenantKey,
  action,
  timestamp,
  latitude = null,
  longitude = null,
  accuracy = null,
  address = null,
  deviceId = null,
  payload = {},
  sessionId = null,
  sourceEventId = null,
  ownerId = `direct:${Date.now()}:${Math.random()}`,
  leaseMs = QUEUE_CLAIM_LEASE_MS,
  assertCurrent,
  now = Date.now(),
}) => {
  if (!employeeId || !tenantKey) throw new Error("Direct attendance receipt requires employee and tenant scope.");
  if (typeof timestamp !== "string" || !timestamp.trim()) throw new Error("Direct attendance receipt requires its exact POST timestamp.");
  if (![QUEUE_ACTION.CHECKIN, QUEUE_ACTION.CHECKOUT].includes(action)) throw new Error("Direct attendance receipt requires a valid action.");
  if (!ownerId) throw new Error("Direct attendance receipt requires a claim owner.");
  validateClaim(ownerId, now, leaseMs);
  if (typeof assertCurrent !== "function") throw new Error("Direct attendance receipt requires a current authorization check.");
  const database = await getDatabase();
  assertCurrent();
  const result = await database.runAsync(
    `INSERT INTO ${QUEUE_TABLE}
       (employeeId, employeeDocname, tenantKey, attendanceType, action, timestamp,
        latitude, longitude, accuracy, address, deviceId, payload,
        status, retryCount, nextAttemptAt, sessionId, sourceEventId, createdAt, updatedAt,
        claimOwner, claimExpiresAt, uploadAttemptAt, lastAttemptAt, attemptCount)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM ${QUEUE_TABLE} AS older
         WHERE older.employeeId = ? AND (older.tenantKey = ? OR older.tenantKey IS NULL)
           AND (older.status IN ('pending', 'syncing', 'needs_review')
             OR (older.status = 'synced' AND older.acceptanceConfirmed <> 1)
             OR (older.status = 'blocked' AND IFNULL(older.failureClass, '') <> 'endpoint-missing'))
      )
     ON CONFLICT DO NOTHING;`,
    [employeeId, employeeDocname, tenantKey, ATTENDANCE_TYPE.AUTO, action, timestamp,
      latitude, longitude, accuracy, address, deviceId, JSON.stringify(payload ?? {}),
      QUEUE_STATUS.SYNCING, sessionId, sourceEventId, now, now,
      ownerId, now + leaseMs, now, now, employeeId, tenantKey],
  );
  const sourceRow = sourceEventId ? await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE tenantKey = ? AND employeeId = ? AND sourceEventId = ? LIMIT 1;`,
    [tenantKey, employeeId, sourceEventId],
  ) : null;
  const row = sourceRow ?? await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE tenantKey = ? AND employeeId = ? AND timestamp = ? AND action = ? LIMIT 1;`,
    [tenantKey, employeeId, timestamp, action],
  );
  return { row: hydrate(row), inserted: result?.changes > 0,
    ...(!row ? { reason: "earlier-attendance-unconfirmed" } : {}) };
};

/** Historical test fixtures use timestamp FIFO, without inventing native event provenance. */
export const readSyncTestRange = async ({ tenantKey, employeeId }) => {
  const database = await getDatabase();
  return database.getFirstAsync(
    `SELECT MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM ${QUEUE_TABLE}
      WHERE tenantKey = ? AND employeeId = ? AND json_valid(payload)
        AND json_extract(payload, '$.syncTest.batchId') IS NOT NULL;`,
    [tenantKey, employeeId],
  );
};

/**
 * Insert a complete historical fixture in one statement, with both pair links
 * already present before a concurrent worker can claim either row. Explicit
 * IDs respect sqlite_sequence as well as MAX(id), so removed IDs are not reused.
 * This seeds test history; it does not transition the employee's live session.
 */
export const enqueueSyncTestPair = async ({ tenantKey, employeeId, employeeDocname,
  checkinTime, checkoutTime, reverse, sessionId, payload, location, assertCurrent, now = Date.now() }) => {
  if (!tenantKey || !employeeId || !sessionId || typeof assertCurrent !== "function" ||
    !checkinTime || !checkoutTime || checkinTime >= checkoutTime) throw new Error("Invalid attendance test pair.");
  const database = await getDatabase();
  const entries = reverse
    ? [QUEUE_ACTION.CHECKOUT, checkoutTime, QUEUE_ACTION.CHECKIN, checkinTime]
    : [QUEUE_ACTION.CHECKIN, checkinTime, QUEUE_ACTION.CHECKOUT, checkoutTime];
  assertCurrent();
  await database.runAsync(
    `WITH next_id AS MATERIALIZED (
       SELECT MAX(COALESCE((SELECT MAX(id) FROM ${QUEUE_TABLE}), 0),
         COALESCE((SELECT seq FROM sqlite_sequence WHERE name = '${QUEUE_TABLE}'), 0)) + 1 AS value
     ), pair(action, timestamp, position) AS (VALUES (?, ?, 0), (?, ?, 1))
     INSERT INTO ${QUEUE_TABLE}
       (id, employeeId, employeeDocname, tenantKey, attendanceType, action, timestamp,
        latitude, longitude, address, deviceId, payload, status, retryCount, nextAttemptAt,
        pairedAttendanceId, sessionId, createdAt, updatedAt)
     SELECT n.value + p.position, ?, ?, ?, ?, p.action, p.timestamp,
       ?, ?, ?, 'MobileAPP', ?, 'pending', 0, 0, n.value + 1 - p.position, ?, ?, ?
       FROM next_id n CROSS JOIN pair p ORDER BY p.position;`,
    [...entries, employeeId, employeeDocname ?? null, tenantKey, ATTENDANCE_TYPE.AUTO,
      location?.latitude ?? null, location?.longitude ?? null, location?.name ?? null,
      JSON.stringify(payload), sessionId, now, now],
  );
  return hydrateAll(await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE tenantKey = ? AND employeeId = ? AND sessionId = ? ORDER BY id;`,
    [tenantKey, employeeId, sessionId],
  ));
};

/** Durable handoff recovery is keyed by native identity, never a new clock offset. */
export const findBySourceEventId = async ({ sourceEventId, tenantKey, employeeId }) => {
  if (!sourceEventId || !tenantKey || !employeeId) return null;
  const database = await getDatabase();
  return hydrate(await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE sourceEventId = ? AND tenantKey = ? AND employeeId = ? LIMIT 1;`,
    [sourceEventId, tenantKey, employeeId],
  ));
};

/**
 * Ordering includes retained unknown provenance as a conservative dependency.
 * A same-code row belonging to a different known tenant must not block this one.
 */
export const countUnconfirmedNativePunches = async ({ tenantKey, employeeId }) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE tenantKey = ? AND employeeId = ? AND sourceEventId IS NOT NULL
        AND status NOT IN (?, ?)
        AND (status <> ? OR acceptanceConfirmed <> 1);`,
    [tenantKey, employeeId, QUEUE_STATUS.RESOLVED, "cancelled", QUEUE_STATUS.SYNCED],
  );
  return Number(row?.total) || 0;
};

/** A tapped action cannot overtake historical work or unknown ownership. */
export const countUnconfirmedAttendanceDependencies = async ({ tenantKey, employeeId }) => {
  if (!tenantKey || !employeeId) throw new Error("Attendance ordering scope missing.");
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND (tenantKey = ? OR tenantKey IS NULL)
        AND (status IN ('pending', 'syncing', 'blocked', 'needs_review')
          OR (status = 'synced' AND acceptanceConfirmed <> 1));`,
    [employeeId, tenantKey],
  );
  return Number(row?.total) || 0;
};

export const QUEUE_CLAIM_CHANGED = "ATTENDANCE_QUEUE_CLAIM_CHANGED";
export const QUEUE_CLAIM_LEASE_MS = 120000;
const claimChanged = () => Object.assign(new Error("Attendance upload claim changed."), { code: QUEUE_CLAIM_CHANGED });
const validateClaim = (ownerId, now, leaseMs) => {
  if (typeof ownerId !== "string" || !ownerId.trim() || !Number.isFinite(now) || now < 0 ||
    !Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > QUEUE_CLAIM_LEASE_MS) {
    throw new Error("Invalid attendance upload claim.");
  }
};
const claimPredicate = (claimOwner, now) => claimOwner == null
  ? { sql: "", params: [] }
  : { sql: " AND status = 'syncing' AND claimOwner = ? AND claimExpiresAt > ? AND claimExpiresAt <= ?",
    params: [claimOwner, now, now + QUEUE_CLAIM_LEASE_MS] };
const requireClaimWrite = (result, claimOwner) => {
  if (claimOwner != null && !result?.changes) throw claimChanged();
  return result;
};

/**
 * Only a positive no-insert refusal may clear a direct dispatch marker. The
 * caller separately checks offline admission before opting into delivery;
 * otherwise the refused intent remains visible as a terminal receipt.
 */
export const settleDirectAttendanceNoInsert = async ({
  id, claimOwner, queueForDelivery = false, failureClass = FAILURE_CLASS.UNKNOWN,
  error = null, serverResponse = null, assertCurrent, now = Date.now(),
}) => {
  if (!claimOwner) throw claimChanged();
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);
  const deliver = queueForDelivery === true;
  if (deliver) {
    if (typeof assertCurrent !== "function") throw new Error("Direct attendance delivery requires a current authorization check.");
    assertCurrent();
  }
  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE} SET status = ?, failureClass = ?, error = ?, serverResponse = ?,
       uploadAttemptAt = NULL, claimOwner = NULL, claimExpiresAt = NULL, nextAttemptAt = 0,
       verificationIssue = ?, verificationCheckedAt = ?, updatedAt = ?
      WHERE id = ?${claim.sql};`,
    [deliver ? QUEUE_STATUS.PENDING : QUEUE_STATUS.CANCELLED, failureClass, error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      deliver ? null : "known-not-inserted", deliver ? null : now, now, id, ...claim.params],
  );
  requireClaimWrite(result, claimOwner);
  return findById(id);
};

export const renewAttendanceClaim = async ({ id, claimOwner, now = Date.now(), leaseMs = QUEUE_CLAIM_LEASE_MS, beginUpload = false }) => {
  if (!claimOwner) throw claimChanged();
  validateClaim(claimOwner, now, leaseMs);
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `UPDATE ${QUEUE_TABLE} SET claimExpiresAt = ?,
       uploadAttemptAt = CASE WHEN ? THEN COALESCE(uploadAttemptAt, ?) ELSE uploadAttemptAt END
      WHERE id = ? AND status = 'syncing' AND claimOwner = ? AND claimExpiresAt > ?
        AND claimExpiresAt <= ? RETURNING *;`,
    [now + leaseMs, beginUpload ? 1 : 0, now, id, claimOwner, now, now + QUEUE_CLAIM_LEASE_MS],
  );
  if (!row) throw claimChanged();
  return hydrate(row);
};
export const beginAttendanceUpload = options => renewAttendanceClaim({ ...options, beginUpload: true });

export const countOutstandingByScope = async ({ tenantKey, employeeId }) => {
  if (!tenantKey || !employeeId) throw new Error("Attendance ordering scope missing.");
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND (tenantKey = ? OR tenantKey IS NULL)
        AND (status IN (?, ?, ?)
          OR (status = 'synced' AND acceptanceConfirmed <> 1)
          OR (status = ? AND IFNULL(failureClass, '') <> ?));`,
    [employeeId, tenantKey, QUEUE_STATUS.PENDING, QUEUE_STATUS.SYNCING,
      QUEUE_STATUS.NEEDS_REVIEW, QUEUE_STATUS.BLOCKED, FAILURE_CLASS.ENDPOINT_MISSING],
  );
  return Number(row?.total) || 0;
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
  tenantKey = null,
  timestamp,
  sourceParentEventId = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();
  // Compatibility repair for an existing unpaired row. New admission already
  // commits both links in enqueue's single INSERT/UPSERT statement.
  const rows = await database.getAllAsync(
    `WITH checkout AS MATERIALIZED (
       SELECT * FROM ${QUEUE_TABLE} WHERE id = ? AND employeeId = ? AND tenantKey IS ?
         AND action = 'checkout' AND timestamp = ?
     ), parent AS MATERIALIZED (
       SELECT checkin.* FROM ${QUEUE_TABLE} AS checkin JOIN checkout
        WHERE checkin.employeeId = checkout.employeeId AND checkin.tenantKey IS checkout.tenantKey
          AND checkin.action = 'checkin'
          AND (checkin.pairedAttendanceId IS NULL OR checkin.pairedAttendanceId = checkout.id)
          AND (checkout.pairedAttendanceId IS NULL OR checkout.pairedAttendanceId = checkin.id)
          AND ((? IS NULL AND checkin.timestamp <= checkout.timestamp) OR checkin.sourceEventId = ?)
          AND checkin.status IN (${placeholdersFor(UNRESOLVED_STATUSES)})
        ORDER BY checkin.timestamp DESC, checkin.id DESC LIMIT 1
     )
     UPDATE ${QUEUE_TABLE} SET pairedAttendanceId = CASE WHEN action = 'checkout'
         THEN (SELECT id FROM parent) ELSE (SELECT id FROM checkout) END,
       sessionId = (SELECT COALESCE(sessionId, 's-' || employeeId || '-' || id) FROM parent),
       status = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
           AND status IN ('pending', 'syncing', 'blocked')
         THEN CASE WHEN uploadAttemptAt IS NULL THEN 'rejected' ELSE 'needs_review' END ELSE status END,
       failureClass = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
           AND status IN ('pending', 'syncing', 'blocked')
         THEN CASE WHEN uploadAttemptAt IS NULL THEN 'dependent' ELSE 'verification-required' END ELSE failureClass END,
       error = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
           AND status IN ('pending', 'syncing', 'blocked')
         THEN 'Dependent on rejected check-in.' ELSE error END,
       verificationIssue = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
           AND status IN ('pending', 'syncing', 'blocked') AND uploadAttemptAt IS NOT NULL
         THEN 'upload-outcome-unverified' ELSE verificationIssue END,
       verificationCheckedAt = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
           AND status IN ('pending', 'syncing', 'blocked') AND uploadAttemptAt IS NOT NULL
         THEN NULL ELSE verificationCheckedAt END,
       claimOwner = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
         THEN NULL ELSE claimOwner END,
       claimExpiresAt = CASE WHEN action = 'checkout' AND (SELECT status FROM parent) = 'rejected'
         THEN NULL ELSE claimExpiresAt END,
       updatedAt = ?
      WHERE EXISTS (SELECT 1 FROM parent) AND id IN (
        SELECT id FROM parent UNION ALL SELECT id FROM checkout
      ) RETURNING *;`,
    [checkoutId, employeeId, tenantKey, timestamp, sourceParentEventId, sourceParentEventId,
      ...UNRESOLVED_STATUSES, now],
  );
  return hydrate(rows.find(row => row.action === QUEUE_ACTION.CHECKIN) ?? null);
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
 * row is claimable only when earlier work is settled: retained NULL tenant work
 * blocks known scopes; same-scope historical rows precede new native rows and
 * retain `(timestamp, id)` order; native rows retain insertion order. Mixing
 * native ID and legacy wall-clock comparisons pairwise would create dependency
 * cycles after a clock correction, so these precedence tiers are explicit.
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
export const claimNextPending = async (
  now = Date.now(),
  { employeeId = null, tenantKey = null, ownerId = `upload:${Date.now()}:${Math.random()}`, leaseMs = QUEUE_CLAIM_LEASE_MS } = {},
) => {
  validateClaim(ownerId, now, leaseMs);
  const database = await getDatabase();

  const scope = [];
  const scopeParams = [];
  if (employeeId) {
    scope.push("candidate.employeeId = ?");
    scopeParams.push(employeeId);
  }
  if (tenantKey) {
    scope.push("candidate.tenantKey = ?");
    scopeParams.push(tenantKey);
  }
  const scopeSql = scope.length ? ` AND ${scope.join(" AND ")}` : "";

  const row = await database.getFirstAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, updatedAt = ?, lastAttemptAt = ?, attemptCount = attemptCount + 1,
            claimOwner = ?, claimExpiresAt = ?
      WHERE id = (
        SELECT candidate.id FROM ${QUEUE_TABLE} AS candidate
         WHERE candidate.status = ? AND candidate.nextAttemptAt <= ?${scopeSql}
           AND ${CLAIM_DEPENDENCIES_SQL}
         ORDER BY candidate.timestamp ASC, candidate.id ASC
         LIMIT 1
      )
      RETURNING *;`,
    [
      QUEUE_STATUS.SYNCING,
      now,
      now,
      ownerId,
      now + leaseMs,
      QUEUE_STATUS.PENDING,
      now,
      ...scopeParams,
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
  claimOwner = null,
  serverCheckinId = null,
  serverResponse = null,
  duplicate = false,
  duplicateMessage = null,
  acceptanceConfirmed = false,
  verificationEvidence = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, serverCheckinId = ?, serverResponse = ?,
            duplicate = ?, duplicateMessage = ?, error = NULL,
            failureClass = NULL, blockedSince = NULL, updatedAt = ?,
            acceptanceConfirmed = ?, verifiedAt = ?, verificationEvidence = ?,
            claimOwner = NULL, claimExpiresAt = NULL
      WHERE id = ?${claim.sql};`,
    [
      QUEUE_STATUS.SYNCED,
      serverCheckinId,
      serverResponse ? JSON.stringify(serverResponse) : null,
      duplicate ? 1 : 0,
      duplicateMessage,
      now,
      acceptanceConfirmed ? 1 : 0,
      verificationEvidence ? now : null,
      verificationEvidence ? JSON.stringify(verificationEvidence) : null,
      id,
      ...claim.params,
    ],
  );
  requireClaimWrite(result, claimOwner);
};

/** A server answer that cannot prove acceptance must not silently complete. */
export const markNeedsReview = async ({ id, claimOwner = null, error, serverResponse = null, duplicate = false,
  verificationIssue = "upload-outcome-unverified", now = Date.now() }) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);
  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE} SET status = ?, failureClass = 'verification-required',
       error = ?, serverResponse = ?, duplicate = ?, duplicateMessage = ?,
       nextAttemptAt = 0, updatedAt = ?, verificationIssue = ?, verificationCheckedAt = ?,
       claimOwner = NULL, claimExpiresAt = NULL
       WHERE id = ? AND status = ?${claim.sql};`,
    [QUEUE_STATUS.NEEDS_REVIEW, error, serverResponse ? JSON.stringify(serverResponse) : null,
      duplicate ? 1 : 0, duplicate ? error : null, now,
      verificationIssue || "upload-outcome-unverified", now, id, QUEUE_STATUS.SYNCING, ...claim.params],
  );
  requireClaimWrite(result, claimOwner);
};

/** Positive server evidence only; preserve the original outcome in the evidence. */
export const recordServerVerification = async ({ row, evidence, now = Date.now() }) => {
  const database = await getDatabase();
  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE} SET verifiedAt = ?, verificationEvidence = ?, status = ?,
       acceptanceConfirmed = 1, serverCheckinId = ?, claimOwner = NULL, claimExpiresAt = NULL,
       verificationCheckedAt = ?, verificationIssue = NULL
     WHERE id = ? AND tenantKey = ? AND employeeId = ? AND timestamp = ?
       AND action = ? AND status = ? AND updatedAt = ? AND verificationCheckedAt IS ?;`,
    [now, JSON.stringify({ ...evidence, originalStatus: row.verificationEvidence?.originalStatus ?? row.status }), QUEUE_STATUS.SYNCED, evidence.name, now,
      row.id, row.tenantKey, row.employeeId, row.timestamp, row.action, row.status, row.updatedAt, row.verificationCheckedAt],
  );
  return result?.changes ?? 0;
};

/** An inconclusive read is durable review information, never proof of absence. */
export const recordVerificationIssue = async ({ row, reason, now = Date.now() }) => {
  const database = await getDatabase();
  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE} SET verificationCheckedAt = ?, verificationIssue = ?
      WHERE id = ? AND tenantKey = ? AND employeeId = ? AND timestamp = ?
        AND action = ? AND status = ? AND updatedAt = ? AND verificationCheckedAt IS ?;`,
    [now, reason, row.id, row.tenantKey, row.employeeId, row.timestamp, row.action, row.status, row.updatedAt, row.verificationCheckedAt],
  );
  return result?.changes ?? 0;
};

/**
 * Returns a row to `pending` with its transient backoff armed.
 *
 * @returns {Promise<{retryCount: number, nextAttemptAt: number}>}
 */
export const markRetry = async ({
  id,
  claimOwner = null,
  error = null,
  serverResponse = null,
  retryAfterMs = 0,
  now = Date.now(),
}) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);

  const current = await database.getFirstAsync(
    `SELECT retryCount FROM ${QUEUE_TABLE} WHERE id = ?;`,
    [id],
  );

  const retryCount = (Number(current?.retryCount) || 0) + 1;
  const nextAttemptAt = now + Math.max(retryDelayFor(retryCount - 1), retryAfterDelay(retryAfterMs));

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, retryCount = ?, nextAttemptAt = ?,
            error = ?, serverResponse = ?, updatedAt = ?, claimOwner = NULL, claimExpiresAt = NULL
      WHERE id = ?${claim.sql};`,
    [
      QUEUE_STATUS.PENDING,
      retryCount,
      nextAttemptAt,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      id,
      ...claim.params,
    ],
  );
  requireClaimWrite(result, claimOwner);

  return { retryCount, nextAttemptAt };
};

/** Returns a claimed row to pending when identity changed before submission. */
export const releaseClaim = async ({ id, claimOwner = null, now = Date.now() }) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);
  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = ?, nextAttemptAt = 0, updatedAt = ?, claimOwner = NULL, claimExpiresAt = NULL
      WHERE id = ? AND status = ?${claim.sql};`,
    [QUEUE_STATUS.PENDING, now, id, QUEUE_STATUS.SYNCING, ...claim.params],
  );
  requireClaimWrite(result, claimOwner);
  return result?.changes ?? 0;
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
  claimOwner = null,
  failureClass = FAILURE_CLASS.UNKNOWN,
  error = null,
  serverResponse = null,
  retryAfterMs = 0,
  now = Date.now(),
}) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);

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
    now + Math.max(blockedDelayFor(step === -1 ? BLOCKED_DELAYS_MS.length - 1 : step), retryAfterDelay(retryAfterMs));

  // `endpoint-missing` does not hold newer rows back (OLDER_DEPENDENCY_SQL), but
  // a paired checkout cannot be claimed before its checkin is confirmed. Left
  // pending, that checkout would hold every later punch back until a backend
  // deployment, so it waits in the same state, in the same statement. A
  // dispatched checkout keeps its own state as evidence.
  const result = await database.runAsync(
    `WITH target AS MATERIALIZED (
       SELECT id, pairedAttendanceId, employeeId, tenantKey FROM ${QUEUE_TABLE}
        WHERE id = ?${claim.sql}
     )
     UPDATE ${QUEUE_TABLE}
        SET status = ?, failureClass = ?, blockedSince = ?, nextAttemptAt = ?,
            error = CASE WHEN id IN (SELECT id FROM target) THEN ? ELSE 'Dependent on blocked check-in.' END,
            serverResponse = CASE WHEN id IN (SELECT id FROM target) THEN ? ELSE serverResponse END,
            updatedAt = ?, claimOwner = NULL, claimExpiresAt = NULL,
            uploadAttemptAt = CASE WHEN id IN (SELECT id FROM target)
              AND ? IN ('auth', 'configuration', 'endpoint-missing') THEN NULL ELSE uploadAttemptAt END
      WHERE id IN (SELECT id FROM target) OR (? = 'endpoint-missing' AND action = 'checkout'
        AND status IN ('pending', 'blocked') AND uploadAttemptAt IS NULL
        AND EXISTS (SELECT 1 FROM target WHERE employeeId = ${QUEUE_TABLE}.employeeId
          AND tenantKey IS ${QUEUE_TABLE}.tenantKey
          AND (pairedAttendanceId = ${QUEUE_TABLE}.id OR id = ${QUEUE_TABLE}.pairedAttendanceId)));`,
    [
      id,
      ...claim.params,
      QUEUE_STATUS.BLOCKED,
      failureClass,
      blockedSince,
      nextAttemptAt,
      error,
      serverResponse ? JSON.stringify(serverResponse) : null,
      now,
      failureClass,
      failureClass,
    ],
  );
  requireClaimWrite(result, claimOwner);

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
  claimOwner = null,
  failureClass = FAILURE_CLASS.VALIDATION,
  error = null,
  serverResponse = null,
  now = Date.now(),
}) => {
  const database = await getDatabase();
  const claim = claimPredicate(claimOwner, now);

  // Root refusal and dependent outcomes commit together. A killed process must
  // never expose a rejected IN while its paired OUT is still claimable. The
  // materialized owner check also prevents a stale claimant touching the pair.
  const changed = await database.getAllAsync(
    `WITH target AS MATERIALIZED (
       SELECT id, pairedAttendanceId, employeeId, tenantKey FROM ${QUEUE_TABLE}
        WHERE id = ?${claim.sql}
     )
     UPDATE ${QUEUE_TABLE}
        SET status = CASE WHEN id = ? OR uploadAttemptAt IS NULL THEN 'rejected' ELSE 'needs_review' END,
            failureClass = CASE WHEN id = ? THEN ? WHEN uploadAttemptAt IS NULL
              THEN 'dependent' ELSE 'verification-required' END,
            error = CASE WHEN id = ? THEN ? ELSE 'Dependent on rejected check-in.' END,
            serverResponse = CASE WHEN id = ? THEN ? ELSE serverResponse END,
            verificationIssue = CASE WHEN id <> ? AND uploadAttemptAt IS NOT NULL
              THEN 'upload-outcome-unverified' ELSE verificationIssue END,
            verificationCheckedAt = CASE WHEN id <> ? AND uploadAttemptAt IS NOT NULL
              THEN NULL ELSE verificationCheckedAt END,
            nextAttemptAt = 0, updatedAt = ?, claimOwner = NULL, claimExpiresAt = NULL
      WHERE id IN (SELECT id FROM target) OR (
        EXISTS (SELECT 1 FROM target WHERE employeeId = ${QUEUE_TABLE}.employeeId
          AND tenantKey IS ${QUEUE_TABLE}.tenantKey
          AND (pairedAttendanceId = ${QUEUE_TABLE}.id OR id = ${QUEUE_TABLE}.pairedAttendanceId))
        AND status IN (${placeholdersFor(AWAITING_SERVER_STATUSES)})
      ) RETURNING id;`,
    [id, ...claim.params, id, id, failureClass, id, error,
      id, serverResponse ? JSON.stringify(serverResponse) : null, id, id, now, ...AWAITING_SERVER_STATUSES],
  );
  const targetId = Number(id);
  requireClaimWrite({ changes: changed.some(row => row.id === targetId) ? 1 : 0 }, claimOwner);
  return { cascaded: changed.filter(row => row.id !== targetId).length };
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
  employeeId = null,
  tenantKey = null,
  now = Date.now(),
} = {}) => {
  const database = await getDatabase();

  const conditions = ["status = ?", PREFLIGHT_RETRY_AFTER_SQL];
  const params = [QUEUE_STATUS.BLOCKED, now];

  if (!force) {
    conditions.push("nextAttemptAt <= ?");
    params.push(now);
  }

  if (failureClass) {
    conditions.push("failureClass = ?");
    params.push(failureClass);
  }

  if (employeeId) {
    conditions.push("employeeId = ?");
    params.push(employeeId);
  }

  if (tenantKey) {
    conditions.push("tenantKey = ?");
    params.push(tenantKey);
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
 * Un-strands `pending` rows whose next attempt sits further in the future than
 * any legitimate backoff could put it.
 *
 * `wakeBlocked` covers `blocked` rows and `releaseStuckSyncing` covers `syncing`
 * ones; until this existed, nothing ever touched a `pending` row's
 * `nextAttemptAt`, and that was a hole with real consequences. The drain claims
 * strictly in order (see `claimNextPending`), so one pending row that is not due
 * holds back every later punch for that employee — and the retry ladder is
 * scheduled from `Date.now()`. A device whose clock runs ahead when a retry is
 * scheduled and is then corrected leaves that row due at a wall-clock time that
 * may never arrive, and the whole employee's queue behind it reads "Pending
 * sync" forever with nothing to explain it.
 *
 * Two modes, because two different claims are being made:
 *
 *  - default: only rows further out than the ladder's own maximum step. No
 *    honest backoff can put a row there, so moving it is a repair, not a
 *    shortcut past the schedule. Safe on every trigger.
 *  - `force`: every pending row that is not yet due. This is a person pulling to
 *    refresh — the same reasoning as `wakeBlocked({ force: true })`, and
 *    deliberately not used by the automatic triggers, which would otherwise
 *    reset the fast ladder on every app launch and walk rows into `blocked`
 *    sooner than real time warrants.
 *
 * `status` is untouched — these rows are already pending. Only their due time
 * moves.
 *
 * @returns {Promise<number>} how many rows were made due
 */
export const wakePending = async ({
  force = false,
  employeeId = null,
  tenantKey = null,
  now = Date.now(),
  maxDelayMs = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
} = {}) => {
  const database = await getDatabase();

  const threshold = force ? now : now + maxDelayMs;
  const conditions = ["status = ?", "nextAttemptAt > ?", PREFLIGHT_RETRY_AFTER_SQL];
  const params = [QUEUE_STATUS.PENDING, threshold, now];
  if (employeeId) {
    conditions.push("employeeId = ?");
    params.push(employeeId);
  }
  if (tenantKey) {
    conditions.push("tenantKey = ?");
    params.push(tenantKey);
  }

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET nextAttemptAt = 0, updatedAt = ?
      WHERE ${conditions.join(" AND ")};`,
    [now, ...params],
  );

  return result?.changes ?? 0;
};

/**
 * Recovers expired claims without releasing live uploads in another runtime.
 *
 * A row is left in that state whenever the process dies mid-request — an OS
 * kill during a background sync, a crash, a force-quit. Nothing would ever claim
 * it again. Owned claims with no durable dispatch can return to pending after
 * expiry. Dispatched or historical no-owner claims become review evidence and
 * require positive history verification. Called before each drain.
 *
 * `failureClass` and `blockedSince` are preserved: a row that was blocked, woken
 * and then stranded mid-attempt must not lose its history and restart the
 * blocked ladder from the top.
 *
 * @returns {Promise<number>} how many rows were released
 */
export const releaseStuckSyncing = async (
  now = Date.now(),
  { employeeId = null, tenantKey = null } = {},
) => {
  if (!Number.isFinite(now) || now < 0) throw new Error("Invalid attendance claim recovery time.");
  const database = await getDatabase();
  const conditions = ["status = ?"];
  const params = [QUEUE_STATUS.SYNCING];
  // A legitimate lease never extends beyond this maximum. A future lease
  // outside that bound proves wall-clock discontinuity, not a live owner.
  conditions.push("(claimOwner IS NULL OR claimExpiresAt IS NULL OR claimExpiresAt <= ? OR claimExpiresAt > ?)");
  params.push(now, now + QUEUE_CLAIM_LEASE_MS);
  if (employeeId) {
    conditions.push("employeeId = ?");
    params.push(employeeId);
  }
  if (tenantKey) {
    conditions.push("tenantKey = ?");
    params.push(tenantKey);
  }

  const result = await database.runAsync(
    `UPDATE ${QUEUE_TABLE}
        SET status = CASE WHEN claimOwner IS NOT NULL AND uploadAttemptAt IS NULL
              THEN 'pending' ELSE 'needs_review' END,
            failureClass = CASE WHEN claimOwner IS NOT NULL AND uploadAttemptAt IS NULL
              THEN failureClass ELSE 'verification-required' END,
            verificationIssue = CASE WHEN claimOwner IS NOT NULL AND uploadAttemptAt IS NULL
              THEN verificationIssue ELSE 'upload-outcome-unverified' END,
            verificationCheckedAt = CASE WHEN claimOwner IS NOT NULL AND uploadAttemptAt IS NULL
              THEN verificationCheckedAt ELSE NULL END,
            nextAttemptAt = 0, updatedAt = ?, claimOwner = NULL, claimExpiresAt = NULL
      WHERE ${conditions.join(" AND ")};`,
    [now, ...params],
  );

  return result?.changes ?? 0;
};

/** Expired or legacy dispatched claims need positive evidence before any resend. */
export const listUncertainUploadClaims = async ({ tenantKey, employeeId }, now = Date.now()) => {
  const database = await getDatabase();
  return hydrateAll(await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE tenantKey = ? AND employeeId = ?
      AND status = 'needs_review' AND failureClass = 'verification-required'
      AND (verificationIssue IS NULL OR verificationIssue = ''
        OR verificationIssue IN (${placeholdersFor(REVIEW_RECHECK_ISSUES)}))
      AND (verificationCheckedAt IS NULL OR verificationCheckedAt <= ?)
      ORDER BY COALESCE(verificationCheckedAt, 0), timestamp, id LIMIT ${REVIEW_RECHECK_ROWS_PER_RUN};`,
    [tenantKey, employeeId, ...REVIEW_RECHECK_ISSUES, now - REVIEW_RECHECK_INTERVAL_MS],
  ));
};

/**
 * Retention is suspended. Historical success flags are not verified receipts,
 * and deleting them destroys the only recoverable original punch. Keep this
 * compatibility seam until a separately reviewed archive policy exists.
 */
export const purgeSynced = async () => 0;

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
export const findDuplicate = async ({ employeeId, timestamp, action, tenantKey = null }) => {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND timestamp = ? AND action = ? AND tenantKey IS ?
      LIMIT 1;`,
    [employeeId, timestamp, action, tenantKey],
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
export const listUnresolved = async ({ employeeId = null, tenantKey = null, includeUnknownTenant = false, limit = 100 } = {}) => {
  const database = await getDatabase();

  const params = [...UNRESOLVED_STATUSES];
  let where = `status IN (${placeholdersFor(UNRESOLVED_STATUSES)})`;
  const scope = readScope(employeeId, tenantKey, includeUnknownTenant);
  where += scope.sql;
  params.push(...scope.params);
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
  tenantKey = null,
  includeUnknownTenant = false,
  statuses = [
    QUEUE_STATUS.PENDING,
    QUEUE_STATUS.SYNCING,
    QUEUE_STATUS.BLOCKED,
    QUEUE_STATUS.REJECTED,
    QUEUE_STATUS.RESOLVED,
    QUEUE_STATUS.SYNCED,
    QUEUE_STATUS.NEEDS_REVIEW,
    QUEUE_STATUS.CANCELLED,
  ],
  limit = 200,
} = {}) => {
  const database = await getDatabase();

  const params = [...statuses];
  let where = `status IN (${placeholdersFor(statuses)})`;
  const scope = readScope(employeeId, tenantKey, includeUnknownTenant);
  where += scope.sql;
  params.push(...scope.params);
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
 * The row the drain will take next, without claiming it.
 *
 * Ordered exactly as `claimNextPending` orders — oldest punch first — so this is
 * the head of the queue whatever its state, including a row that is not due yet.
 * Read only for the run log: when a queue is not moving, the head row is the
 * whole answer, and until it was logged the only way to get at its `error`,
 * `retryCount` and `nextAttemptAt` was a debugger attached to the employee's
 * phone.
 */
export const peekNextRow = async ({ employeeId = null } = {}) => {
  const database = await getDatabase();

  const statuses = [...AWAITING_SERVER_STATUSES, QUEUE_STATUS.NEEDS_REVIEW];
  const params = [...statuses];
  let where = `status IN (${placeholdersFor(statuses)})`;
  if (employeeId) {
    where += " AND employeeId = ?";
    params.push(employeeId);
  }

  const row = await database.getFirstAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE ${where}
      ORDER BY timestamp ASC, id ASC
      LIMIT 1;`,
    params,
  );

  return hydrate(row);
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

/** Support-only read across all statuses/tenants; no arbitrary row limit. */
export const listDiagnosticRows = async ({ employeeIds, date }) => {
  const database = await getDatabase();
  if (!employeeIds.length) return [];
  const rows = await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE employeeId IN (${placeholdersFor(employeeIds)})
      AND substr(timestamp, 1, 10) = ? ORDER BY timestamp, id;`,
    [...employeeIds, date],
  );
  return rows.map(row => ({ ...hydrate(row), rawPayload: row.payload, rawServerResponse: row.serverResponse }));
};

export const listClaimableIds = async ({ employeeId, tenantKey, now = Date.now() }) => {
  if (!employeeId || !tenantKey) throw new Error("Diagnostic scope missing");
  const database = await getDatabase();
  return (await database.getAllAsync(
    `SELECT candidate.id FROM ${QUEUE_TABLE} AS candidate
      WHERE candidate.employeeId = ? AND candidate.tenantKey = ?
        AND candidate.status = 'pending' AND candidate.nextAttemptAt <= ?
        AND ${CLAIM_DEPENDENCIES_SQL} ORDER BY candidate.timestamp, candidate.id;`,
    [employeeId, tenantKey, now],
  )).map(row => row.id);
};

/** Development diagnostics: due pending rows the claim skips, and what holds each back. */
export const explainUnclaimable = async ({ employeeId, tenantKey, now = Date.now() }) => {
  const claimable = new Set(await listClaimableIds({ employeeId, tenantKey, now }));
  const database = await getDatabase();
  const due = hydrateAll(await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE} WHERE employeeId = ? AND tenantKey = ?
      AND status = 'pending' AND nextAttemptAt <= ? ORDER BY timestamp, id;`,
    [employeeId, tenantKey, now],
  )).filter(row => !claimable.has(row.id));
  return Promise.all(due.map(async row => ({
    id: row.id, action: row.action, timestamp: row.timestamp,
    blockedByOlder: await database.getAllAsync(
      `SELECT older.id, older.action, older.timestamp, older.status, older.failureClass, older.error
         FROM ${QUEUE_TABLE} AS older, ${QUEUE_TABLE} AS candidate
        WHERE candidate.id = ? AND ${OLDER_DEPENDENCY_SQL} ORDER BY older.timestamp, older.id;`,
      [row.id],
    ),
    pairedAttendanceId: row.pairedAttendanceId ?? null,
    sourceParentEventId: row.payload?.sourceParentEventId ?? null,
  })));
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
export const countByStatus = async (employeeId = null, { tenantKey = null, includeUnknownTenant = false } = {}) => {
  const database = await getDatabase();
  const scope = readScope(employeeId, tenantKey, includeUnknownTenant);

  const rows = await database.getAllAsync(
    `SELECT status, COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE 1 = 1${scope.sql} GROUP BY status;`, scope.params,
  );

  const counts = {
    [QUEUE_STATUS.PENDING]: 0,
    [QUEUE_STATUS.SYNCING]: 0,
    [QUEUE_STATUS.SYNCED]: 0,
    [QUEUE_STATUS.BLOCKED]: 0,
    [QUEUE_STATUS.REJECTED]: 0,
    [QUEUE_STATUS.RESOLVED]: 0,
    [QUEUE_STATUS.NEEDS_REVIEW]: 0,
    [QUEUE_STATUS.CANCELLED]: 0,
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
  counts.reviewCount = counts[QUEUE_STATUS.NEEDS_REVIEW];
  counts.cancelledCount = counts[QUEUE_STATUS.CANCELLED];

  counts.unresolvedCount =
    counts.pendingCount +
    counts.syncingCount +
    counts.blockedCount +
    counts.rejectedCount + counts.reviewCount;

  counts.awaitingServerCount =
    counts.pendingCount + counts.syncingCount + counts.blockedCount + counts.reviewCount;

  // Blocked rows split by *why*. Only the undeliverable class is separated out;
  // auth, configuration and unknown all remain things that can still land.
  const blockedRows = await database.getAllAsync(
    `SELECT failureClass, COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE status = ?${scope.sql} GROUP BY failureClass;`,
    [QUEUE_STATUS.BLOCKED, ...scope.params],
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

  // When the oldest punch still in motion was created, or null if there is
  // none. `pendingCount` says how many are waiting; only this says for how
  // long, which is the difference between ordinary queueing and a queue that
  // has stopped moving. The banner needs exactly that distinction: a punch made
  // thirty seconds ago is not news, and six of them from yesterday are.
  //
  // `createdAt`, not `timestamp` — how long the app has been holding the record,
  // not when the employee punched. A backdated geofence replay is not stale.
  const oldest = await database.getFirstAsync(
    `SELECT MIN(createdAt) AS oldest FROM ${QUEUE_TABLE}
      WHERE status IN (?, ?)${scope.sql};`,
    [QUEUE_STATUS.PENDING, QUEUE_STATUS.SYNCING, ...scope.params],
  );

  counts.oldestPendingAt = Number(oldest?.oldest) || null;

  return counts;
};

/**
 * Counts the records a user-initiated recovery may safely act on.
 *
 * NULL provenance is reported separately and never folded into the recoverable
 * total. Those rows predate tenant ownership in the schema; an employee-code
 * match cannot prove which Frappe site created them.
 */
export const countRecoveryByScope = async ({ employeeId, tenantKey }) => {
  if (!employeeId || !tenantKey) {
    throw new Error("Attendance recovery requires employee and tenant scope.");
  }

  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT status, COUNT(*) AS total FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND tenantKey = ?
      GROUP BY status;`,
    [employeeId, tenantKey],
  );

  const byStatus = {
    [QUEUE_STATUS.PENDING]: 0,
    [QUEUE_STATUS.SYNCING]: 0,
    [QUEUE_STATUS.BLOCKED]: 0,
    [QUEUE_STATUS.REJECTED]: 0,
    [QUEUE_STATUS.NEEDS_REVIEW]: 0,
  };
  (rows ?? []).forEach(({ status, total }) => {
    if (status in byStatus) byStatus[status] = Number(total) || 0;
  });

  const [unknown, otherTenant, review] = await Promise.all([
    database.getFirstAsync(
      `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
        WHERE employeeId = ? AND tenantKey IS NULL;`,
      [employeeId],
    ),
    database.getFirstAsync(
      `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
        WHERE employeeId = ? AND tenantKey IS NOT NULL AND tenantKey <> ?;`,
      [employeeId, tenantKey],
    ),
    database.getFirstAsync(
      `SELECT COUNT(*) AS total FROM ${QUEUE_TABLE}
        WHERE employeeId = ? AND tenantKey = ?
          AND status NOT IN ('pending', 'syncing', 'blocked', 'rejected')
          AND NOT (status = 'cancelled' AND IFNULL(verificationIssue, '') = 'known-not-inserted')
          AND (verificationIssue IS NOT NULL OR (verifiedAt IS NULL
            AND (status <> 'synced' OR acceptanceConfirmed = 0)));`,
      [employeeId, tenantKey],
    ),
  ]);

  return {
    pendingCount: byStatus[QUEUE_STATUS.PENDING],
    syncingCount: byStatus[QUEUE_STATUS.SYNCING],
    blockedCount: byStatus[QUEUE_STATUS.BLOCKED],
    rejectedCount: byStatus[QUEUE_STATUS.REJECTED],
    recoverableCount:
      byStatus[QUEUE_STATUS.PENDING] + byStatus[QUEUE_STATUS.BLOCKED],
    unknownTenantCount: Number(unknown?.total) || 0,
    otherTenantCount: Number(otherTenant?.total) || 0,
    reviewCount: Number(review?.total) || 0,
  };
};

/** Every retained status. A zero pending count must not hide historical evidence. */
export const listRecoveryRows = async ({ employeeId, tenantKey }) => {
  if (!employeeId || !tenantKey) throw new Error("Attendance recovery scope missing");
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT * FROM ${QUEUE_TABLE}
      WHERE employeeId = ? AND (tenantKey = ? OR tenantKey IS NULL)
      ORDER BY timestamp ASC, id ASC;`,
    [employeeId, tenantKey],
  );
  return hydrateAll(rows);
};

/**
 * Whether a drain has anything to do at `now`, including due blocked rows.
 *
 * `employeeId` scopes it to match `claimNextPending`: a drain scoped to one
 * employee would otherwise decide it had work to do on the strength of somebody
 * else's row and then claim nothing.
 */
export const hasWorkDue = async (
  now = Date.now(),
  { employeeId = null, tenantKey = null } = {},
) => {
  const database = await getDatabase();

  const params = [QUEUE_STATUS.PENDING, QUEUE_STATUS.BLOCKED, now];
  let where = "status IN (?, ?) AND nextAttemptAt <= ?";
  if (employeeId) {
    where += " AND employeeId = ?";
    params.push(employeeId);
  }
  if (tenantKey) {
    where += " AND tenantKey = ?";
    params.push(tenantKey);
  }

  const row = await database.getFirstAsync(
    `SELECT 1 AS due FROM ${QUEUE_TABLE} WHERE ${where} LIMIT 1;`,
    params,
  );
  return !!row;
};

/**
 * Scheduling only: final refusals and manual review alone must not keep a worker alive.
 * Neither does `endpoint-missing` — only a deployment fixes it, so it would retry
 * forever. The row is kept and still attempted by every pass that does run, and
 * it does not hold newer rows back (OLDER_DEPENDENCY_SQL), so they still count.
 */
export const hasBackgroundSyncWork = async ({ tenantKey, employeeId }) => {
  if (!tenantKey || !employeeId) return false;
  const database = await getDatabase();
  return !!await database.getFirstAsync(
    `SELECT 1 AS pending FROM ${QUEUE_TABLE} AS candidate WHERE tenantKey = ? AND employeeId = ?
      AND (((status IN ('pending', 'syncing')
          OR (status = 'blocked' AND IFNULL(failureClass, '') <> 'endpoint-missing')) AND ${CLAIM_DEPENDENCIES_SQL}) OR
        (status = 'needs_review' AND failureClass = 'verification-required'
          AND (verificationIssue IS NULL OR verificationIssue = ''
            OR verificationIssue IN (${placeholdersFor(REVIEW_RECHECK_ISSUES)})))) LIMIT 1;`,
    [tenantKey, employeeId, ...REVIEW_RECHECK_ISSUES],
  );
};

export default {
  BLOCKED_DELAYS_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  blockedDelayFor,
  claimNextPending,
  countByStatus,
  countOutstandingByScope,
  countUnconfirmedAttendanceDependencies,
  countUnconfirmedNativePunches,
  countRecoveryByScope,
  listRecoveryRows,
  enqueue,
  beginDirectAttendanceReceipt,
  settleDirectAttendanceNoInsert,
  findById,
  findBySourceEventId,
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
  markNeedsReview,
  recordServerVerification,
  pairWithOpenCheckin,
  peekNextRow,
  purgeSynced,
  releaseStuckSyncing,
  releaseClaim,
  renewAttendanceClaim,
  beginAttendanceUpload,
  listUncertainUploadClaims,
  retryDelayFor,
  wakeBlocked,
  wakePending,
};
