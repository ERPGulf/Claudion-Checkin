import { AUTO_EVENT_TABLE, getDatabase } from "./AttendanceDatabase";
import { normalizeAttendanceTenantKey } from "./attendanceQueueProvenance";

export const AUTO_EVENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  HANDLED: "handled",
  NEEDS_REVIEW: "needs_review",
};

const STATUSES = new Set(Object.values(AUTO_EVENT_STATUS));
const EVENT_FIELDS = [
  "eventId", "sequence", "identifier", "nativeIdentifier", "transition",
  "timestamp", "tenantKey", "employeeId", "registrationId", "geotagging",
  "latitude", "longitude", "radius", "requestedRadius", "captureIssue",
  "initialPresence", "registrationStartedAt",
];

const nonblank = (value) => typeof value === "string" && !!value.trim();
const positiveTime = (value) => Number.isFinite(value) && value > 0;
const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const hydrate = (row) => row ? {
  ...row,
  event: parseJson(row.event),
  outcome: parseJson(row.outcome),
} : null;

/** Preserve structural native data only; never persist arbitrary bridge fields. */
const sanitizeEvent = (event) => Object.fromEntries(EVENT_FIELDS
  .filter((key) => event?.[key] !== undefined)
  .map((key) => [key, event[key]]));

export const findEvent = async (eventId) => {
  const database = await getDatabase();
  return hydrate(await database.getFirstAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE} WHERE eventId = ?;`, [eventId],
  ));
};

/**
 * Native acknowledges only after this insert commits. A repeat never replaces
 * an earlier event or resets its outcome. Legacy single-slot events have no
 * proven owner: retain a deterministic receipt for review, never attribute it.
 */
export const ingestNativeEvent = async (input, { now = Date.now() } = {}) => {
  const event = sanitizeEvent(input);
  const hasEventId = nonblank(event.eventId);
  const eventId = hasEventId ? event.eventId
    : `legacy:${String(event.identifier ?? "")}:${String(event.transition ?? "")}:${String(event.timestamp ?? "")}`;
  const tenantKey = normalizeAttendanceTenantKey(event.tenantKey);
  const employeeId = nonblank(event.employeeId) ? event.employeeId : null;
  const occurredAt = positiveTime(event.timestamp) ? event.timestamp : null;
  const sequence = Number.isSafeInteger(event.sequence) && event.sequence >= 0
    ? event.sequence : null;
  let reason = null;
  if (!hasEventId) reason = "legacy-event-identity";
  else if (event.captureIssue) reason = "native-capture-issue";
  else if (!tenantKey || !employeeId || !nonblank(event.registrationId)) reason = "native-provenance-missing";
  else if (!["ENTER", "EXIT"].includes(event.transition) || !occurredAt || !nonblank(event.identifier)) reason = "invalid-native-event";
  const status = reason ? AUTO_EVENT_STATUS.NEEDS_REVIEW : AUTO_EVENT_STATUS.PENDING;

  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO ${AUTO_EVENT_TABLE}
      (eventId, tenantKey, employeeId, identifier, transition, occurredAt,
       sequence, receivedAt, status, reason, event, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(eventId) DO NOTHING;`,
    [eventId, tenantKey, employeeId, event.identifier ?? null, event.transition ?? null,
      occurredAt, sequence, now, status, reason, JSON.stringify(event), now],
  );
  return findEvent(eventId);
};

/** Includes interrupted processing so restart can reconcile instead of resend. */
export const listPendingEvents = async ({ tenantKey, employeeId }) => {
  if (!tenantKey || !employeeId) return [];
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE}
      WHERE tenantKey = ? AND employeeId = ? AND status IN (?, ?)
      ORDER BY COALESCE(sequence, -1) ASC, receivedAt ASC, eventId ASC;`,
    [tenantKey, employeeId, AUTO_EVENT_STATUS.PENDING, AUTO_EVENT_STATUS.PROCESSING],
  );
  return rows.map(hydrate);
};

/** A dispatched input needs positive evidence before a conflicting manual punch. */
export const listUncertainEvents = async ({ tenantKey, employeeId }) => {
  if (!tenantKey || !employeeId) return [];
  const database = await getDatabase();
  return (await database.getAllAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE} WHERE tenantKey = ? AND employeeId = ?
      AND onlineAttemptAt IS NOT NULL AND status IN (?, ?, ?)
      ORDER BY COALESCE(sequence, -1), receivedAt, eventId;`,
    [tenantKey, employeeId, AUTO_EVENT_STATUS.PENDING, AUTO_EVENT_STATUS.PROCESSING, AUTO_EVENT_STATUS.NEEDS_REVIEW],
  )).map(hydrate);
};

/** A native receipt can be processed by only one claimant in this database. */
export const claimEvent = async (eventId, {
  ownerId = `auto-claim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  now = Date.now(),
  leaseMs = 120000,
  allowReview = false,
} = {}) => {
  if (!nonblank(ownerId) || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Invalid automatic event claim.");
  const database = await getDatabase();
  return hydrate(await database.getFirstAsync(
    `UPDATE ${AUTO_EVENT_TABLE} SET status = ?, updatedAt = ?, claimOwner = ?, claimExpiresAt = ?
      WHERE eventId = ? AND (status = ? OR (status = ? AND COALESCE(claimExpiresAt, 0) <= ?)
        OR (? = 1 AND status = ? AND onlineAttemptAt IS NOT NULL))
      RETURNING *;`,
    [AUTO_EVENT_STATUS.PROCESSING, now, ownerId, now + leaseMs, eventId,
      AUTO_EVENT_STATUS.PENDING, AUTO_EVENT_STATUS.PROCESSING, now, allowReview ? 1 : 0, AUTO_EVENT_STATUS.NEEDS_REVIEW],
  ));
};

const UPDATE_COLUMNS = [
  "status", "punchTimestamp", "queueRowId", "onlineAttemptAt", "outcome",
  "reason", "sessionAt",
];

export const updateEvent = async (eventId, changes, { now = Date.now() } = {}) => {
  if (changes?.status !== undefined && !STATUSES.has(changes.status)) {
    throw new Error("Invalid automatic attendance event status.");
  }
  const keys = UPDATE_COLUMNS.filter((key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key));
  if (!keys.length) return findEvent(eventId);
  const values = keys.map((key) => key === "outcome" && changes[key] != null
    ? JSON.stringify(changes[key]) : changes[key]);
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE ${AUTO_EVENT_TABLE} SET ${keys.map((key) => `${key} = ?`).join(", ")}, updatedAt = ?
      WHERE eventId = ?;`,
    [...values, now, eventId],
  );
  return findEvent(eventId);
};

/**
 * Renew a live claim and write its outcome in one statement. An expired/lost
 * owner cannot record a dispatch or overwrite the succeeding processor's work.
 */
export const updateClaimedEvent = async (eventId, ownerId, changes = {}, {
  now = Date.now(), leaseMs = 120000,
} = {}) => {
  if (!nonblank(ownerId) || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Invalid automatic event claim.");
  if (changes.status !== undefined && !STATUSES.has(changes.status)) throw new Error("Invalid automatic attendance event status.");
  const keys = UPDATE_COLUMNS.filter((key) => Object.prototype.hasOwnProperty.call(changes, key));
  const values = keys.map((key) => key === "outcome" && changes[key] != null
    ? JSON.stringify(changes[key]) : changes[key]);
  const releases = changes.status !== undefined && changes.status !== AUTO_EVENT_STATUS.PROCESSING;
  const database = await getDatabase();
  return hydrate(await database.getFirstAsync(
    `UPDATE ${AUTO_EVENT_TABLE} SET ${keys.map((key) => `${key} = ?, `).join("")}
      claimOwner = ?, claimExpiresAt = ?, updatedAt = ?
      WHERE eventId = ? AND status = ? AND claimOwner = ? AND claimExpiresAt > ? RETURNING *;`,
    [...values, releases ? null : ownerId, releases ? null : now + leaseMs, now,
      eventId, AUTO_EVENT_STATUS.PROCESSING, ownerId, now],
  ));
};

/** Pending or uncertain older input must not be overtaken by a later punch. */
export const hasEarlierUnresolvedEvent = async (row) => {
  if (!row?.tenantKey || !row?.employeeId) return true;
  const database = await getDatabase();
  const earlier = await database.getFirstAsync(
    `SELECT eventId FROM ${AUTO_EVENT_TABLE}
      WHERE tenantKey = ? AND employeeId = ? AND eventId <> ?
        AND (status IN (?, ?) OR (status = ? AND IFNULL(reason, '') NOT IN (
          'native-capture-issue', 'native-provenance-missing', 'legacy-event-identity',
          'invalid-native-event', 'native-configuration-mismatch',
          'native-provenance-mismatch', 'stale-native-configuration')))
        AND (COALESCE(sequence, -1) < ?
          OR (COALESCE(sequence, -1) = ? AND receivedAt < ?)
          OR (COALESCE(sequence, -1) = ? AND receivedAt = ? AND eventId < ?))
      LIMIT 1;`,
    [row.tenantKey, row.employeeId, row.eventId,
      AUTO_EVENT_STATUS.PENDING, AUTO_EVENT_STATUS.PROCESSING, AUTO_EVENT_STATUS.NEEDS_REVIEW,
      row.sequence ?? -1, row.sequence ?? -1, row.receivedAt,
      row.sequence ?? -1, row.receivedAt, row.eventId],
  );
  return !!earlier;
};

/** Read-only review visibility includes legacy unknown ownership, never claims it. */
export const listReviewEvents = async ({ tenantKey, employeeId } = {}) => {
  const database = await getDatabase();
  const scope = tenantKey && employeeId
    ? " AND ((tenantKey = ? AND employeeId = ?) OR tenantKey IS NULL OR employeeId IS NULL)" : "";
  const rows = await database.getAllAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE} WHERE status = ?${scope}
      ORDER BY receivedAt ASC, eventId ASC;`,
    [AUTO_EVENT_STATUS.NEEDS_REVIEW, ...(scope ? [tenantKey, employeeId] : [])],
  );
  return rows.map(hydrate);
};

export const countReviewEvents = async (scope) => (await listReviewEvents(scope)).length;

/** Bounded history-only retries for attributable receipts with dispatch evidence. */
export const listReviewEventsForVerification = async ({ tenantKey, employeeId }, {
  now = Date.now(), retryAfterMs = 60000, limit = 5,
} = {}) => {
  if (!tenantKey || !employeeId) return [];
  const database = await getDatabase();
  const lastVerifiedSql = "COALESCE(CASE WHEN json_valid(outcome) THEN json_extract(outcome, '$.lastVerifiedAt') END, updatedAt)";
  const rows = await database.getAllAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE} WHERE tenantKey = ? AND employeeId = ?
      AND status = ? AND onlineAttemptAt IS NOT NULL
      AND (${lastVerifiedSql} <= ? OR ${lastVerifiedSql} > ?)
      ORDER BY ${lastVerifiedSql},
        COALESCE(sequence, -1), receivedAt, eventId LIMIT ?;`,
    [tenantKey, employeeId, AUTO_EVENT_STATUS.NEEDS_REVIEW, now - retryAfterMs, now + retryAfterMs, Math.min(Math.max(limit, 1), 5)],
  );
  return rows.map(hydrate);
};

/** Seconds-resolution backend timestamps cannot identify two distinct same-type inputs. */
export const findPunchTimestampCollision = async (row, timestamp) => {
  const database = await getDatabase();
  return hydrate(await database.getFirstAsync(
    `SELECT * FROM ${AUTO_EVENT_TABLE} WHERE tenantKey = ? AND employeeId = ?
      AND eventId <> ? AND transition = ? AND punchTimestamp = ? LIMIT 1;`,
    [row.tenantKey, row.employeeId, row.eventId, row.transition, timestamp],
  ));
};
