// src/services/offline/AttendanceQueueService.js
import { formatOfflineTimestamp } from "../../utils/serverClock";
import { DEVICE_ID } from "./AttendanceApi";
import {
  ATTENDANCE_TYPE,
  QUEUE_ACTION,
  QUEUE_STATUS,
  clearAttendanceQueue,
  logTypeToAction,
} from "./AttendanceDatabase";
import {
  countByStatus,
  enqueue,
  listForHistory,
  listUnresolved,
  markResolved,
  pairWithOpenCheckin,
} from "./AttendanceQueueRepository";
import {
  clearAttendanceConfig,
  readAttendanceConfig,
} from "./attendanceConfigCache";
import { classifyAttendanceError, FAILURE_KIND } from "./attendanceErrors";
import { fetchIsOnline, isOnline } from "./NetworkListener";
import { evaluateOfflineAttendance } from "./offlineAttendanceGate";
import {
  clearOfflineCapability,
  isOfflineSyncUnsupported,
} from "./offlineCapability";

/**
 * The write side of the offline queue, and the single seam every attendance
 * entry point goes through.
 *
 * `submitAttendance` is shaped to be dropped straight into
 * `performSessionTransition({ execute })`. It returns the same
 * `{ allowed, message, name, location }` contract `userCheckIn` and
 * `autoCheckInOut` already return, so the session state machine, its
 * serialisation lock and its duplicate-move rules are untouched — a queued
 * check-in opens a real session, and a geofence EXIT still closes it.
 *
 * That is also what satisfies "manual and auto share one queue with no
 * duplicated code": the two differ only in which function they hand to `online`
 * and which `attendanceType` they tag the row with. Everything after that point
 * is this module.
 *
 * The decision it makes:
 *
 *   online?  ──yes──> run the real API ──ok──────────> done, nothing queued
 *      │                    │
 *      │                    └─ failed ─┬─ transport/5xx ──> queue it
 *      │                               └─ policy/validation > surface the error
 *      no
 *      │
 *      └──> offline gate ─┬─ refused ──> surface the error
 *                         └─ accepted ─> queue it
 */

const LOG_PREFIX = "[AttendanceQueueService]";

/**
 * Shown when the server has no offline attendance endpoint.
 *
 * Names the constraint without blaming the employee or asking them to fix
 * something they cannot. It is deliberately different from NO_CONFIG_MESSAGE:
 * that one is "this device hasn't downloaded the rules yet" and resolves by
 * going online once; this one resolves only when an administrator deploys
 * something.
 */
export const OFFLINE_UNSUPPORTED_MESSAGE =
  "Offline attendance isn't enabled on your organization's server yet. Please check in while you have a connection.";

/** Change notifications for the UI. */
const changeListeners = new Set();

export const addQueueChangeListener = (listener) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

export const notifyQueueChanged = () => {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.log(`${LOG_PREFIX} Change listener failed:`, error?.message);
    }
  });
};

/**
 * Whether a failure reaching THIS path should become a queued row.
 *
 * Note the asymmetry with the sync service, which is deliberate. Once a row
 * exists, an unrecognised error must never discard it, so the sync service
 * blocks anything it cannot identify. Here no row exists yet, and the question
 * is the opposite one: is it safe to tell the employee "saved" and walk away?
 *
 * So this queues only failures the *server* answered — a transport failure, or a
 * 4xx/5xx we could not interpret. A failure with no HTTP status is our own code
 * failing (a denied location permission, a bug building the payload), and
 * swallowing that into a queue would tell the employee their attendance was
 * recorded when nothing has been recorded anywhere.
 */
export const shouldQueueFailure = (failure) => {
  if (!failure?.error) {
    // No error object: the failure came from a code path that made a judgement
    // rather than from a request. Out of radius, no cached configuration.
    return false;
  }

  const { kind, status } = classifyAttendanceError(failure.error);

  if (kind === FAILURE_KIND.PENDING) return true;
  if (kind === FAILURE_KIND.BLOCKED) return !!status;

  return false;
};

/**
 * Puts one punch in the queue.
 *
 * @returns {Promise<{allowed: boolean, queued: boolean, message: string,
 *                    row?: object, alreadyQueued?: boolean}>}
 */
const queueAttendance = async ({
  employeeCode,
  type,
  attendanceType,
  occurredAt = null,
  photoUri = null,
  gate,
}) => {
  const config = gate?.config ?? (await readAttendanceConfig());
  const timestamp = await formatOfflineTimestamp(occurredAt ?? Date.now());

  const { row, inserted } = await enqueue({
    employeeId: employeeCode,
    employeeDocname: config?.employeeDocname ?? null,
    attendanceType,
    action: logTypeToAction(type),
    timestamp,
    latitude: gate?.coords?.latitude ?? null,
    longitude: gate?.coords?.longitude ?? null,
    accuracy: gate?.coords?.accuracy ?? null,
    address: gate?.location?.locationName ?? null,
    deviceId: DEVICE_ID,
    payload: {
      location: gate?.location?.locationName,
      distance: gate?.location?.distance,
      radius: gate?.location?.radius,
      // Vestigial. The endpoint still accepts the field, but nothing on either
      // side computes or consumes it and the app has no overtime concept, so it
      // is always 0. Kept rather than dropped because removing a key the bulk
      // insert expects could reject the whole call — and that rejection is
      // indistinguishable from a real validation failure. Do not wire this up
      // without a server-side change that says what is supposed to set it.
      over_time: 0,
      // Photo-mode tenants only. The upload needs a docname the server has not
      // issued yet, so the URI is carried here and the sync service attaches it
      // after the row lands. Never sent to the bulk endpoint.
      photoUri: photoUri ?? undefined,
    },
  });

  // Link a check-out to the check-in it closes, so a rejection can invalidate
  // the whole attendance session rather than leaving the server holding an OUT
  // with no matching IN.
  //
  // Derived from the queue, NOT from the session state machine: this runs inside
  // `performSessionTransition`'s `execute()`, which holds the session lock for
  // its whole duration, and `readSession()` takes that same lock — reading it
  // here would deadlock. The queue already knows enough.
  if (inserted && row && logTypeToAction(type) === QUEUE_ACTION.CHECKOUT) {
    try {
      const checkin = await pairWithOpenCheckin({
        checkoutId: row.id,
        employeeId: employeeCode,
        timestamp,
      });
      if (checkin) {
        console.log(
          `${LOG_PREFIX} Paired check-out #${row.id} with check-in #${checkin.id}`,
        );
      }
    } catch (error) {
      // An unpaired check-out is degraded, not broken — it simply cannot
      // cascade. Never fail a punch over it.
      console.log(`${LOG_PREFIX} Pairing failed:`, error?.message);
    }
  }

  console.log(
    `${LOG_PREFIX} ${inserted ? "Queued" : "Already queued"} ${type}`,
    { employeeCode, timestamp, attendanceType, id: row?.id },
  );

  notifyQueueChanged();

  return {
    allowed: true,
    queued: true,
    alreadyQueued: !inserted,
    row,
    name: null,
    location: gate?.location ?? null,
    message:
      type === "IN"
        ? "Checked in offline — this will sync when you're back online."
        : "Checked out offline — this will sync when you're back online.",
  };
};

/**
 * Runs one attendance action, online if possible and queued if not.
 *
 * @param {object} options
 * @param {"IN"|"OUT"} options.type
 * @param {string} options.employeeCode
 * @param {"manual"|"auto"} [options.attendanceType]
 * @param {() => Promise<object>} options.online the existing API call
 *        (`userCheckIn` / `autoCheckInOut`), used unchanged when there is a
 *        connection
 * @param {number|null} [options.occurredAt] device epoch ms the punch actually
 *        happened, for a replayed geofence crossing
 * @param {boolean} [options.forceQueue] skip the online attempt and queue the
 *        punch even though there is a connection. **Ordering, not connectivity.**
 *        Set when an older punch for this employee has not reached the server
 *        yet: sending this one directly would overtake it, and the server would
 *        see a check-in before the check-out that precedes it. Queueing puts it
 *        behind that punch in the employee's FIFO instead. See
 *        `claimNextPending` for the ordering guarantee this relies on.
 * @returns {Promise<object>} the `performSessionTransition` execute contract
 */
export const submitAttendance = async ({
  type,
  employeeCode,
  attendanceType = ATTENDANCE_TYPE.MANUAL,
  online,
  occurredAt = null,
  photoUri = null,
  forceQueue = false,
}) => {
  if (type !== "IN" && type !== "OUT") {
    throw new Error(`submitAttendance: invalid type ${type}`);
  }

  // Asked fresh rather than read from the cached state: a stale "offline" would
  // queue a punch that could have gone straight through, and the round-trip is
  // cheap next to the request it is deciding about.
  const connected = await fetchIsOnline();
  const canGoOnline = connected && typeof online === "function";

  /**
   * One online attempt.
   *
   * `{ done: true }` means the caller should return `result` — the server had an
   * opinion and it stands. `{ done: false }` means the failure was transient and
   * the punch should be queued.
   */
  const attemptOnline = async () => {
    try {
      const result = await online();

      if (result?.allowed) return { done: true, result };

      if (!shouldQueueFailure(result)) {
        // A real refusal — out of radius, missing configuration, a rejected
        // payload. Surfacing it is the correct behaviour, online or not.
        return { done: true, result };
      }

      console.log(
        `${LOG_PREFIX} Online attempt failed transiently, queueing:`,
        result?.message,
      );
      return { done: false };
    } catch (error) {
      const { message } = classifyAttendanceError(error);

      // Same rule as a returned failure — see shouldQueueFailure.
      if (!shouldQueueFailure({ error })) {
        return { done: true, result: { allowed: false, message, error, location: null } };
      }

      console.log(`${LOG_PREFIX} Online attempt threw, queueing:`, message);
      return { done: false };
    }
  };

  if (canGoOnline && !forceQueue) {
    const attempt = await attemptOnline();
    if (attempt.done) return attempt.result;
  }

  /**
   * What to do when the queue will not take a punch that `forceQueue` sent here.
   *
   * `forceQueue` chose the queue for ordering, not because the punch could not
   * be sent — the connection is fine. If the queue then refuses it (no offline
   * endpoint on this server, no cached rules), returning that refusal would
   * throw away a real crossing the OS will not deliver again. Losing attendance
   * is worse than the ordering risk we were avoiding, so fall back to sending
   * it. Ordinary punches are unaffected: they have already had their online
   * attempt by this point.
   */
  const refuseOrFallBack = async (refusal) => {
    if (!forceQueue || !canGoOnline) return refusal;

    console.log(
      `${LOG_PREFIX} Queue refused a forced ${type} (${refusal.reason}); sending it rather than losing it`,
    );
    const attempt = await attemptOnline();
    return attempt.done ? attempt.result : refusal;
  };

  // This server has already told us it has no offline endpoint, so queueing
  // would be a promise the app cannot keep: the punch would sit in a queue that
  // can never drain while the employee walks away believing it was recorded.
  // Refusing is the honest answer, and it is also what the app did before
  // offline attendance existed.
  //
  // Already-queued rows are untouched and still retried — the moment someone
  // deploys the endpoint, one success flips this back and everything drains.
  if (isOfflineSyncUnsupported()) {
    console.log(`${LOG_PREFIX} Offline ${type} refused: server has no offline endpoint`);
    return refuseOrFallBack({
      allowed: false,
      reason: "unsupported",
      message: OFFLINE_UNSUPPORTED_MESSAGE,
      location: null,
    });
  }

  // Queueing from here. The gate still applies: an out-of-radius punch is
  // refused offline exactly as it is online, or aeroplane mode becomes a bypass.
  //
  // The radius test is skipped for the geofence path only, matching what
  // `autoCheckInOut` already does online — the OS transition is the location
  // proof, and an EXIT is outside the radius by definition, so testing it would
  // refuse every automatic check-out. This is not a hole a user can reach: it
  // applies solely to punches originating from a native geofence callback, never
  // to anything a person can tap.
  const gate = await evaluateOfflineAttendance({
    type,
    enforceRadius: attendanceType !== ATTENDANCE_TYPE.AUTO,
  });

  if (!gate.allowed) {
    console.log(`${LOG_PREFIX} Offline ${type} refused:`, gate.reason);
    return refuseOrFallBack({
      allowed: false,
      message: gate.message,
      reason: gate.reason,
      location: null,
    });
  }

  return queueAttendance({
    employeeCode,
    type,
    attendanceType,
    occurredAt,
    photoUri,
    gate,
  });
};

/**
 * `submitAttendance` pre-bound for the manual screens — check-in, check-out and
 * the photo flow.
 */
export const submitManualAttendance = ({
  type,
  employeeCode,
  online,
  photoUri = null,
}) =>
  submitAttendance({
    type,
    employeeCode,
    attendanceType: ATTENDANCE_TYPE.MANUAL,
    online,
    photoUri,
  });

/** `submitAttendance` pre-bound for the geofence path. */
export const submitAutoAttendance = ({
  type,
  employeeCode,
  online,
  occurredAt,
  forceQueue = false,
}) =>
  submitAttendance({
    type,
    employeeCode,
    attendanceType: ATTENDANCE_TYPE.AUTO,
    online,
    occurredAt,
    forceQueue,
  });

// ----------------------
// READ HELPERS FOR THE UI
// ----------------------

export const getQueueCounts = (employeeId = null) => countByStatus(employeeId);

/** Rows the server has not accepted yet. The queue's own view of itself. */
export const getUnsyncedRows = (employeeId = null) =>
  listForHistory({ employeeId });

/**
 * Rows for the history timeline — every state the list draws a chip for.
 *
 * The status list is the repository's default rather than one spelled out here.
 * It used to be enumerated at this call site, and when `failed` was split into
 * `blocked` / `rejected` / `resolved` this array silently kept naming a status
 * that no longer existed — which would have dropped exactly the records the
 * employee most needs to see out of their own attendance history.
 *
 * Recently-synced rows are included to cover the seconds between a row uploading
 * and the history query refetching, during which the punch exists in neither
 * place and would otherwise blink out. `mergeQueuedRecords` drops each one the
 * moment the server's own copy arrives.
 */
export const getHistoryRows = (employeeId = null) =>
  listForHistory({ employeeId });

/**
 * Rows the employee still needs an outcome on — what the banner counts and the
 * sync sheet lists.
 */
export const getUnresolvedRows = (employeeId = null) =>
  listUnresolved({ employeeId });

/**
 * Marks a rejected record superseded by an attendance correction request.
 *
 * Carries the paired punch with it, so one correction resolves the whole
 * session — which is the counterpart of the cascade that rejected them together.
 * The rows are preserved for audit; they simply stop being unresolved, which is
 * what clears the banner.
 */
export const resolveWithCorrection = async ({ id, resolutionDocname }) => {
  const changed = await markResolved({ id, resolutionDocname });
  if (changed) notifyQueueChanged();
  return changed;
};

/**
 * Logout teardown: drops the cached rules and the capability probe, and
 * **keeps every queued punch**.
 *
 * This function used to clear the queue too, and that was the direct cause of
 * lost attendance in production. The chain: an employee's automatic check-out is
 * queued while they are offline; their token expires before it can drain; the
 * 401 handler calls `expireSession()`, which runs this as its cleanup hook; the
 * queue is deleted; the employee logs back in and the server never learns they
 * left. Their local session then reads CHECKED_OUT for a punch the server has no
 * record of, which is what produced a second automatic check-in on top of a
 * still-open one.
 *
 * The invariant now is that **authentication state and attendance data are
 * independent**. None of these may destroy a punch:
 *
 *   access-token expiry · refresh failure · forced logout · manual logout ·
 *   app restart · network loss · returning to the login screen
 *
 * A queued punch is payroll data the employee has already earned. It leaves the
 * queue in exactly two ways: the server accepts it, or someone explicitly asks
 * for it to be discarded (`purgeAttendanceQueue`).
 *
 * The original concern behind the clear — a punch syncing under whoever logs in
 * next — is real, and is now handled where it belongs: the drain is scoped to
 * the authenticated employee (see `syncPendingAttendance`), so another
 * employee's rows are skipped rather than deleted. Skipping is recoverable when
 * the first employee logs back in; deleting never is.
 *
 * The cached configuration and the capability probe still go. Both are
 * tenant/employee-scoped policy rather than employee data, both are rebuilt from
 * the server on the next login, and a stale copy governing the next employee's
 * offline check-ins is a live hazard with no upside.
 *
 * Never throws: a logout that fails because of local cleanup would strand the
 * user in a session they have asked to leave.
 *
 * Stopping the background triggers is not done here — `OfflineAttendanceBootstrap`
 * already tears them down when `isLoggedIn` flips, and reaching for
 * `BackgroundSyncManager` from this module would close an import cycle.
 */
export const clearOfflineAttendance = async () => {
  const results = await Promise.allSettled([
    clearAttendanceConfig(),
    // The capability is a fact about the server this account was on, and the
    // next login may be a different tenant entirely. Carrying "unsupported"
    // across would silently disable offline attendance on a server that
    // supports it perfectly well.
    clearOfflineCapability(),
  ]);

  results
    .filter((result) => result.status === "rejected")
    .forEach((result) =>
      console.log(`${LOG_PREFIX} Teardown step failed:`, result.reason?.message),
    );

  notifyQueueChanged();
};

/**
 * Discards every queued punch, synced or not.
 *
 * Deliberately separate from `clearOfflineAttendance` and deliberately not
 * wired to any authentication path. This is the explicit, intentional purge —
 * the only way unsynchronised attendance is allowed to leave the device without
 * the server having accepted it. Nothing in the app calls it today; it exists so
 * that a future "reset this device" affordance has one honest place to live
 * rather than reaching for `clearAttendanceQueue` and quietly recreating the
 * data loss this module was fixed to prevent.
 */
export const purgeAttendanceQueue = async () => {
  await clearAttendanceQueue();
  notifyQueueChanged();
};

export default {
  QUEUE_STATUS,
  addQueueChangeListener,
  clearOfflineAttendance,
  getHistoryRows,
  getQueueCounts,
  getUnresolvedRows,
  getUnsyncedRows,
  isOnline,
  notifyQueueChanged,
  purgeAttendanceQueue,
  resolveWithCorrection,
  shouldQueueFailure,
  submitAttendance,
  submitAutoAttendance,
  submitManualAttendance,
};
