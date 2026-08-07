// src/services/offline/AttendanceQueueService.js
import { formatOfflineTimestamp } from "../../utils/serverClock";
import { DEVICE_ID } from "./AttendanceApi";
import {
  ATTENDANCE_TYPE,
  QUEUE_STATUS,
  clearAttendanceQueue,
  logTypeToAction,
} from "./AttendanceDatabase";
import {
  countByStatus,
  enqueue,
  listForHistory,
  retryFailed,
} from "./AttendanceQueueRepository";
import {
  clearAttendanceConfig,
  readAttendanceConfig,
} from "./attendanceConfigCache";
import { classifyAttendanceError, FAILURE_KIND } from "./attendanceErrors";
import { fetchIsOnline, isOnline } from "./NetworkListener";
import { evaluateOfflineAttendance } from "./offlineAttendanceGate";

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
 * Whether a failed online attempt should become a queued row.
 *
 * `userCheckIn` and `autoCheckInOut` flatten every failure into
 * `{ allowed: false, message }`, which makes "you are 300m away" and "the
 * request timed out" indistinguishable — so they now also carry the original
 * `error`, and this reads it. Without it the queue would either swallow real
 * policy refusals (the employee thinks they checked in and did not) or fail to
 * queue genuine outages (the punch is lost).
 */
export const shouldQueueFailure = (failure) => {
  if (!failure) return false;
  if (failure.error) {
    return classifyAttendanceError(failure.error).kind === FAILURE_KIND.RETRYABLE;
  }

  // No error object attached: the failure came from a code path that decided
  // something itself rather than from a request. Not a network problem.
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
      over_time: 0,
      // Photo-mode tenants only. The upload needs a docname the server has not
      // issued yet, so the URI is carried here and the sync service attaches it
      // after the row lands. Never sent to the bulk endpoint.
      photoUri: photoUri ?? undefined,
    },
  });

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
 * @returns {Promise<object>} the `performSessionTransition` execute contract
 */
export const submitAttendance = async ({
  type,
  employeeCode,
  attendanceType = ATTENDANCE_TYPE.MANUAL,
  online,
  occurredAt = null,
  photoUri = null,
}) => {
  if (type !== "IN" && type !== "OUT") {
    throw new Error(`submitAttendance: invalid type ${type}`);
  }

  // Asked fresh rather than read from the cached state: a stale "offline" would
  // queue a punch that could have gone straight through, and the round-trip is
  // cheap next to the request it is deciding about.
  const connected = await fetchIsOnline();

  if (connected && typeof online === "function") {
    try {
      const result = await online();

      if (result?.allowed) return result;

      if (!shouldQueueFailure(result)) {
        // A real refusal — out of radius, missing configuration, a rejected
        // payload. Surfacing it is the correct behaviour, online or not.
        return result;
      }

      console.log(
        `${LOG_PREFIX} Online attempt failed transiently, queueing:`,
        result?.message,
      );
    } catch (error) {
      const { kind, message } = classifyAttendanceError(error);

      if (kind !== FAILURE_KIND.RETRYABLE) {
        return { allowed: false, message, error, location: null };
      }

      console.log(`${LOG_PREFIX} Online attempt threw, queueing:`, message);
    }
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
    return {
      allowed: false,
      message: gate.message,
      reason: gate.reason,
      location: null,
    };
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
}) =>
  submitAttendance({
    type,
    employeeCode,
    attendanceType: ATTENDANCE_TYPE.AUTO,
    online,
    occurredAt,
  });

// ----------------------
// READ HELPERS FOR THE UI
// ----------------------

export const getQueueCounts = (employeeId = null) => countByStatus(employeeId);

/** Rows the server has not accepted yet. The queue's own view of itself. */
export const getUnsyncedRows = (employeeId = null) =>
  listForHistory({ employeeId });

/**
 * Rows for the history timeline — the unsynced ones plus the recently synced.
 *
 * The synced ones are included to cover the seconds between a row uploading and
 * the history query refetching, during which the punch exists in neither place
 * and would otherwise blink out of the list. `mergeQueuedRecords` drops each one
 * the moment the server's own copy arrives.
 */
export const getHistoryRows = (employeeId = null) =>
  listForHistory({
    employeeId,
    statuses: [
      QUEUE_STATUS.PENDING,
      QUEUE_STATUS.SYNCING,
      QUEUE_STATUS.FAILED,
      QUEUE_STATUS.SYNCED,
    ],
  });

/** Requeues failed rows. Backs the manual retry affordance. */
export const retryFailedRows = async (id = null) => {
  const changed = await retryFailed({ id });
  if (changed) notifyQueueChanged();
  return changed;
};

/**
 * Logout teardown: drops the queue and the cached rules.
 *
 * Both have to go. A queued punch belongs to the employee who made it and would
 * otherwise sync under whoever logs in next — attendance filed against the wrong
 * person, from a device that looks like it is working correctly. The cached
 * configuration is the previous employee's reporting locations and policy flags,
 * which would silently govern the next one's offline check-ins.
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
    clearAttendanceQueue(),
    clearAttendanceConfig(),
  ]);

  results
    .filter((result) => result.status === "rejected")
    .forEach((result) =>
      console.log(`${LOG_PREFIX} Teardown step failed:`, result.reason?.message),
    );

  notifyQueueChanged();
};

export default {
  QUEUE_STATUS,
  addQueueChangeListener,
  clearOfflineAttendance,
  getHistoryRows,
  getQueueCounts,
  getUnsyncedRows,
  isOnline,
  notifyQueueChanged,
  retryFailedRows,
  shouldQueueFailure,
  submitAttendance,
  submitAutoAttendance,
  submitManualAttendance,
};
