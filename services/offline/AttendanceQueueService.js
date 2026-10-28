// src/services/offline/AttendanceQueueService.js
import { formatOfflineTimestamp } from "../../utils/serverClock";
import { DEVICE_ID } from "./AttendanceApi";
import {
  ATTENDANCE_TYPE,
  FAILURE_CLASS,
  QUEUE_ACTION,
  QUEUE_STATUS,
  clearAttendanceQueue,
  logTypeToAction,
} from "./AttendanceDatabase";
import {
  countByStatus,
  countOutstandingByScope,
  countUnconfirmedNativePunches,
  countUnconfirmedAttendanceDependencies,
  beginDirectAttendanceReceipt,
  enqueue,
  findBySourceEventId,
  listForHistory,
  listUnresolved,
  markResolved,
  pairWithOpenCheckin,
  markSynced,
  markNeedsReview,
  renewAttendanceClaim,
  settleDirectAttendanceNoInsert,
  QUEUE_CLAIM_CHANGED,
} from "./AttendanceQueueRepository";
import { resolveServerTimestampAt } from "../api/attendance.service";
import {
  clearAttendanceConfig,
  readAttendanceConfig,
} from "./attendanceConfigCache";
import { classifyAttendanceError, FAILURE_KIND } from "./attendanceErrors";
import { fetchShouldAttemptRequest, isOnline } from "./NetworkListener";
import { checkInstanceAvailability, invalidateInstanceAvailability } from "./InstanceAvailabilityService";
import { logAttendanceDiagnostic } from "./attendanceDiagnostics";
import { evaluateOfflineAttendance } from "./offlineAttendanceGate";
import {
  clearOfflineCapability,
  isOfflineQueueingDisallowed,
  isOfflineSyncUnsupported,
} from "./offlineCapability";
import { assertAttendanceQueueScope, captureAttendanceQueueScope } from "./attendanceQueueProvenance";
import { listUncertainEvents } from "./AutoAttendanceEventRepository";
import { assertCapability, assertCapabilityCurrent } from "../capabilityPolicy";
import { assertEmployeeAutoAttendancePolicy, assertEmployeeAutoAttendancePolicyCurrent } from "../employeeAutoAttendancePolicy";
import { ATTENDANCE_FEATURES } from "../../utils/featureSettings";

const assertAutomaticCapabilityCurrent = (sourceScope, { queueing = false } = {}) => {
  assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, sourceScope);
  if (queueing) assertCapabilityCurrent(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE, sourceScope);
  return assertEmployeeAutoAttendancePolicyCurrent(sourceScope);
};

const checkAutomaticCapability = async (employeeCode, sourceScope, { queueing = false } = {}) => {
  const context = sourceScope?.tenantKey
    ? { baseUrl: sourceScope.tenantKey, employeeCode, generation: sourceScope.generation } : undefined;
  try {
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, context);
    if (queueing) await assertCapability(ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE, context);
    await assertEmployeeAutoAttendancePolicy(sourceScope);
    assertAutomaticCapabilityCurrent(sourceScope, { queueing });
    // Kept for callers of the pre-existing mirror API. The scoped capability
    // assertion above is authoritative even before the bootstrap effect runs.
    if (queueing && isOfflineQueueingDisallowed()) {
      return { allowed: false, reason: "admin-disabled", message: OFFLINE_DISABLED_MESSAGE, location: null };
    }
    return null;
  } catch (error) {
    return { allowed: false, reason: error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE")
      ? "employee-policy-disabled" : ["CAPABILITY_SCOPE_CHANGED", "ATTENDANCE_SYNC_SCOPE_CHANGED"].includes(error?.code)
      ? "scope-changed" : queueing ? "admin-disabled" : "capability-disabled",
      message: queueing ? OFFLINE_DISABLED_MESSAGE : error.message, error, location: null };
  }
};

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
 * **Only the geofence path queues.** The queue exists for a crossing the OS
 * hands to a killed app: it cannot be retried and nobody is watching when it
 * happens. A tapped punch is the opposite situation — a person is looking at the
 * screen and can be told it failed. So a manual punch gets one attempt at the
 * real API and whatever it says stands: nothing is written locally, nothing goes
 * pending, and an employee is never told their day is recorded on the strength
 * of a row only this device can see. That is what the app did before the queue
 * existed, and it is what `submitOnlineOnly` restores.
 *
 * The decision it makes:
 *
 *   manual? ──yes──> run the real API; its answer stands, ok or not
 *      │
 *      no
 *      │
 *      └─> instance available? ──yes──> persist dispatch, run the real API
 *             │                    │
 *             │                    ├─ confirmed ──> settle receipt
 *             │                    ├─ uncertain ──> retain for GET-only verification
 *             │                    └─ proven no-insert ──> queue only with offline admission
 *             no
 *             │
 *             └──> offline gate ─┬─ refused ──> surface the error
 *                                └─ accepted ─> queue it
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

/**
 * Shown when the administrator has switched offline attendance off.
 *
 * Distinct from the two above again: the server can do it and the device has the
 * rules, but the tenant has chosen not to. Refusing is the whole point of the
 * switch — the alternative, which is what this used to do, was to accept the
 * punch into a queue that the same switch had stopped anything from draining.
 */
export const OFFLINE_DISABLED_MESSAGE =
  "Offline attendance is switched off for your organization. Please check in while you have a connection.";

/**
 * Shown when a manual punch could not reach the server.
 *
 * Manual attendance has no offline path, so there is nothing saved and nothing
 * pending — and the message has to say exactly that. "Network Error" leaves the
 * employee guessing whether it landed; the one thing they need to know is that
 * it did not, and that trying again on a connection is the whole remedy.
 */
export const MANUAL_OFFLINE_MESSAGE =
  "No connection — your attendance was not marked. Please try again once you're online.";

/**
 * How the sync manager gets told "a punch just went into the queue".
 *
 * A callback rather than a direct call, because importing `BackgroundSyncManager`
 * from here would close an import cycle (it imports `AttendanceSyncService`,
 * which imports this module for `notifyQueueChanged`). Same shape as
 * `addQueueChangeListener` above, and a no-op when nothing is registered — so a
 * punch queued before the manager starts, or by a test, still behaves.
 *
 * `notifyQueueChanged` cannot serve this purpose: it fires for every queue
 * mutation *including the drain's own*, so draining on it would re-enter the
 * drain after every successful run.
 *
 * Why it is needed at all: until now nothing scheduled a drain when a punch was
 * queued. The row waited for the next launch, foreground or five-minute tick —
 * and the reconnect trigger, which exists precisely for this, cannot help when
 * the punch was queued because the *server* was unreachable rather than the
 * transport, since no connectivity edge ever occurs.
 */
let queueDrainHandler = null;

export const registerQueueDrainHandler = (handler) => {
  queueDrainHandler = typeof handler === "function" ? handler : null;

  return () => {
    if (queueDrainHandler === handler) queueDrainHandler = null;
  };
};

export const requestQueueDrain = (context) => {
  if (!queueDrainHandler) return;

  try {
    queueDrainHandler(context);
  } catch (error) {
    // A punch is already safely in the queue by this point. Failing to ask for
    // a drain must never turn that into a failed punch.
    console.log(`${LOG_PREFIX} Drain request failed:`, error?.message);
  }
};

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
  sourceScope,
  sourceEventId = null,
  sourceParentEventId = null,
  timestamp: suppliedTimestamp = null,
  strictOrdering = false,
}) => {
  const config = gate?.config ?? (await readAttendanceConfig());
  const timestamp = suppliedTimestamp ?? await formatOfflineTimestamp(occurredAt ?? Date.now(),
    sourceScope?.tenantKey ? { tenantKey: sourceScope.tenantKey } : {});
  let tenantKey = null;
  try {
    await assertAttendanceQueueScope(sourceScope);
    if (sourceScope.employeeId === employeeCode) tenantKey = sourceScope.tenantKey;
  } catch (error) {
    if (strictOrdering) {
      return { allowed: false, reason: "scope-changed", error, location: null };
    }
    // Preserve the event, but do not stamp a new account's backend onto it.
  }
  if (strictOrdering && (!tenantKey || config?.tenantKey !== tenantKey || config?.employeeId !== employeeCode)) {
    return { allowed: false, reason: "config-scope-mismatch", message: "Attendance rules must be refreshed for this account.", location: null };
  }

  // GPS, timestamp resolution and provenance checks can all await. A newly
  // received denial must govern the insert, not merely the original attempt.
  const capabilityRefusal = await checkAutomaticCapability(employeeCode, sourceScope, { queueing: true });
  if (capabilityRefusal) return capabilityRefusal;
  try {
    assertAutomaticCapabilityCurrent(sourceScope, { queueing: true });
  } catch (error) {
    return { allowed: false, reason: error?.code === "FEATURE_DISABLED" ? "admin-disabled" :
      error?.code === "CAPABILITY_SCOPE_CHANGED" ? "scope-changed" : "employee-policy-disabled",
    message: error.message, error, location: null };
  }

  let acceptance;
  try {
    acceptance = await enqueue({
      employeeId: employeeCode,
      // Old caches have no tenant provenance either. Their docname cannot be
      // carried onto an attributable row for a different company's employee.
      employeeDocname: !tenantKey || (config?.tenantKey === tenantKey && config?.employeeId === employeeCode)
        ? config?.employeeDocname ?? null : null,
      tenantKey,
      sourceEventId,
      attendanceType,
      assertCurrent: () => assertAutomaticCapabilityCurrent(sourceScope, { queueing: true }),
      action: logTypeToAction(type),
      timestamp,
      latitude: gate?.coords?.latitude ?? null,
      longitude: gate?.coords?.longitude ?? null,
      accuracy: gate?.coords?.accuracy ?? null,
      address: gate?.location?.locationName ?? null,
      deviceId: DEVICE_ID,
      payload: {
        ...(sourceParentEventId ? { sourceParentEventId } : {}),
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
  } catch (error) {
    if (!error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE") &&
      !["FEATURE_DISABLED", "CAPABILITY_SCOPE_CHANGED", "ATTENDANCE_SYNC_SCOPE_CHANGED"].includes(error?.code)) throw error;
    return { allowed: false, reason: ["ATTENDANCE_SYNC_SCOPE_CHANGED", "CAPABILITY_SCOPE_CHANGED"].includes(error.code)
      ? "scope-changed" : error.code === "FEATURE_DISABLED" ? "admin-disabled" : "employee-policy-disabled",
    message: error.message, error, location: null };
  }
  const { row, inserted } = acceptance;

  // The older timestamp/action constraint remains intact for server contract
  // compatibility. It cannot prove a different native input was accepted.
  if (strictOrdering && sourceEventId && row?.sourceEventId !== sourceEventId) {
    return { allowed: false, reason: "source-event-collision", row, location: null };
  }

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
        sourceParentEventId,
        checkoutId: row.id,
        employeeId: employeeCode,
        tenantKey,
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

  logAttendanceDiagnostic(
    LOG_PREFIX, `${inserted ? "Queued" : "Already queued"} ${type}`,
    { employeeCode, timestamp, attendanceType, id: row?.id },
  );

  notifyQueueChanged();

  // Ask for a drain. The manager decides when — it holds a short delay so this
  // does not immediately re-attempt a request that just failed and burn a step
  // of the row's retry ladder.
  if (inserted) {
    requestQueueDrain({ employeeId: employeeCode, action: logTypeToAction(type) });
  }

  return {
    allowed: true,
    queued: true,
    alreadyQueued: !inserted,
    row,
    sourceEventId,
    name: null,
    location: gate?.location ?? null,
    message:
      type === "IN"
        ? "Checked in offline — saved on this device. Check Attendance recovery for synchronization status."
        : "Checked out offline — saved on this device. Check Attendance recovery for synchronization status.",
  };
};

/**
 * Turns a manual failure's raw message into one that says what happened to the
 * punch.
 *
 * Transport failures only. A refusal the app or the server made deliberately —
 * out of radius, no cached rules, a rejected payload — already carries a message
 * that explains itself, and overwriting it would hide the real reason the
 * employee could not check in.
 */
const describeManualFailure = (failure) => {
  const { kind } = classifyAttendanceError(failure?.error);
  if (kind !== FAILURE_KIND.PENDING) return failure;

  return { ...failure, offline: true, message: MANUAL_OFFLINE_MESSAGE };
};

/**
 * A manual punch: one attempt at the real API, and its answer stands.
 *
 * Deliberately the behaviour the app had before the queue existed. Nothing is
 * written locally, so there is no row to go `pending`, no "Pending sync" chip on
 * a punch nobody can account for later, and no drain filing a tap against a
 * session that closed hours ago. A manual punch either reaches the server or it
 * did not happen, and the employee is told which.
 *
 * The call is made unconditionally rather than behind a connectivity check.
 * There is nothing to fall back to here, so a wrong "we are offline" would
 * refuse a punch on a working connection and buy nothing — the same trap
 * `fetchShouldAttemptRequest` exists to keep the queueing path out of.
 */
const submitOnlineOnly = async ({ type, employeeCode, online, sourceScope }) => {
  if (typeof online !== "function") {
    throw new Error("submitAttendance: manual attendance requires `online`");
  }

  try {
    // Manual punches remain online-only and cannot overtake retained native or
    // historical work. Unknown tenant ownership is not assigned to this scope.
    const scope = sourceScope ?? await captureAttendanceQueueScope(employeeCode).catch(() => null);
    if (scope && (await countUnconfirmedNativePunches(scope) > 0 ||
      await countUnconfirmedAttendanceDependencies(scope) > 0 || (await listUncertainEvents(scope)).length > 0)) {
      await assertAttendanceQueueScope(scope);
      requestQueueDrain({ employeeId: employeeCode, reason: "manual-ordering" });
      return { allowed: false, reason: "automatic-attendance-unconfirmed", location: null,
        message: "Earlier saved attendance needs server confirmation. Synchronize or verify the saved record before this action." };
    }
    if (scope) await assertAttendanceQueueScope(scope);
    const result = await online();
    if (scope) await assertAttendanceQueueScope(scope);

    if (result?.allowed) {
      // A punch just landed, so the server is up and this token works — the
      // moment anything the geofence queued is most likely to succeed. Same
      // reasoning as the queueing path's own `online-punch` kick.
      requestQueueDrain({ employeeId: employeeCode, reason: "online-punch" });
      return result;
    }

    console.log(`${LOG_PREFIX} Manual ${type} not marked:`, result?.message);

    return describeManualFailure(
      result ?? {
        allowed: false,
        message: "Attendance was not marked. Please try again.",
        location: null,
      },
    );
  } catch (error) {
    const { message } = classifyAttendanceError(error);
    console.log(`${LOG_PREFIX} Manual ${type} threw, not marked:`, message);

    return describeManualFailure({
      allowed: false,
      message,
      error,
      location: null,
    });
  }
};

/**
 * Runs one attendance action: online only when it is manual, online-or-queued
 * when it comes from the geofence.
 *
 * @param {object} options
 * @param {"IN"|"OUT"} options.type
 * @param {string} options.employeeCode
 * @param {"manual"|"auto"} [options.attendanceType] `manual` skips the queue
 *        entirely — see `submitOnlineOnly`. It is also the default, so a caller
 *        that forgets to say gets the path that cannot write a row it did not
 *        ask for; only the geofence opts in to queueing.
 * @param {() => Promise<object>} options.online the existing API call
 *        (`userCheckIn` / `autoCheckInOut`), used unchanged when there is a
 *        connection
 * @param {number|null} [options.occurredAt] device epoch ms the punch actually
 *        happened, for a replayed geofence crossing. Automatic punches only
 * @param {string|null} [options.photoUri] carried on a queued row so the sync
 *        service can attach the picture once the server names the document.
 *        Nothing sets this any more — the photo flow is a manual screen, and a
 *        manual punch is never queued — but the sync side still honours it for
 *        rows queued before that changed
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
  sourceScope = undefined,
  sourceEventId = null,
  sourceParentEventId = null,
  timestamp = null,
  strictOrdering = false,
  skipPosition = false,
  onKnownNoInsert,
}) => {
  if (type !== "IN" && type !== "OUT") {
    throw new Error(`submitAttendance: invalid type ${type}`);
  }

  // Manual attendance never reaches the queue, and this is the one place that
  // guarantees it. Keyed on `attendanceType` rather than left to
  // `submitManualAttendance`, so no caller can queue a tapped punch by reaching
  // past the binding. `occurredAt`, `photoUri` and `forceQueue` are all queue
  // concepts and are ignored here — the camera uploads its photo against the
  // docname the server issues, as it did before the queue existed.
  if (attendanceType === ATTENDANCE_TYPE.MANUAL) {
    return submitOnlineOnly({ type, employeeCode, online, sourceScope });
  }

  // Capture before network/gate awaits. Historical native replays must bring
  // their originating scope; the current account cannot prove past ownership.
  if (sourceScope === undefined) {
    sourceScope = occurredAt == null
      ? await captureAttendanceQueueScope(employeeCode).catch(() => null)
      : null;
  }

  if (strictOrdering) {
    try {
      await assertAttendanceQueueScope(sourceScope);
      if (sourceScope.employeeId !== employeeCode) throw new Error("Attendance employee scope changed.");
    } catch (error) {
      return { allowed: false, reason: "scope-changed", error, location: null };
    }
  }

  if (sourceEventId && sourceScope?.tenantKey) {
    const existing = await findBySourceEventId({
      sourceEventId, tenantKey: sourceScope.tenantKey, employeeId: employeeCode,
    });
    await assertAttendanceQueueScope(sourceScope);
    if (existing) {
      if (existing.payload?.directOnline && existing.uploadAttemptAt &&
        !(existing.status === QUEUE_STATUS.SYNCED && existing.acceptanceConfirmed)) {
        return { allowed: false, queued: false, reason: "online-outcome-unconfirmed", row: existing, sourceEventId, location: null,
          message: "Automatic attendance is retained for server verification before retry." };
      }
      if ([QUEUE_STATUS.PENDING, QUEUE_STATUS.SYNCING, QUEUE_STATUS.BLOCKED].includes(existing.status)) {
        return { allowed: true, queued: true, alreadyQueued: true, row: existing, sourceEventId, name: null, location: null };
      }
      if (existing.status === QUEUE_STATUS.SYNCED && existing.acceptanceConfirmed) {
        return { allowed: true, queued: false, alreadyQueued: true, row: existing, sourceEventId, name: existing.serverCheckinId, location: null };
      }
      if (existing.status === QUEUE_STATUS.CANCELLED && existing.verificationIssue === "known-not-inserted") {
        return { allowed: false, queued: false, reason: "attendance-not-submitted", row: existing, sourceEventId, location: null,
          message: "This automatic attendance attempt was not submitted." };
      }
      return { allowed: false, reason: "source-event-needs-review", row: existing, sourceEventId, location: null };
    }
  }

  // Accepted source rows above are recovery evidence, rather than a request to
  // authorize another punch. Every new automatic action needs current policy.
  const capabilityRefusal = await checkAutomaticCapability(employeeCode, sourceScope);
  if (capabilityRefusal) return capabilityRefusal;

  // Enforce both IN and OUT order at the submission seam, so an online EXIT
  // cannot bypass an earlier queued ENTER. Unknown legacy rows remain blockers.
  let orderingRequiresQueue = false;
  if (sourceScope?.tenantKey && await countOutstandingByScope(sourceScope) > 0) {
    forceQueue = true;
    orderingRequiresQueue = true;
  }

  // "Is there a transport?", NOT "does NetInfo think the internet is reachable?".
  //
  // This decides whether the ordinary check-in API
  // (`add_log_based_on_employee_field`, unchanged, the same call the app has
  // always made) is even attempted. It used to ask reachability, which on
  // Android is the OS captive-portal probe — and on a network that fails that
  // probe while working perfectly, the real API was never called at all. The
  // employee was told "checked in offline" on a working connection, and the
  // client saw a pending record on a phone that was plainly online.
  //
  // No transport skips the health request. A connected device also checks the
  // selected instance before recording dispatch intent; a failed health GET may
  // safely queue, while an uncertain attendance POST must only be verified.
  //
  // The cost is that a genuinely dead-but-connected network — real captive
  // portal wifi — now waits out the request instead of queueing immediately.
  // That is the right way round: a punch that reaches the server is worth a
  // wait, and a punch queued on a good connection is exactly the failure being
  // reported. Asked fresh rather than read from the cached state, since a stale
  // answer would decide this on seconds-old information.
  const connected = await fetchShouldAttemptRequest();
  const canGoOnline = connected && typeof online === "function";
  let instanceUnavailable = null;
  let serverClock = null;
  let directReceipt = null;
  let knownDirectRefusal = null;
  let preparedOnlineTimestamp = timestamp;

  const preflightOnline = async () => {
    const availability = await checkInstanceAvailability({ syncScope: sourceScope });
    if (sourceScope) await assertAttendanceQueueScope(sourceScope);
    if (availability.status === "available") {
      serverClock = { serverTime: availability.serverTime, observedAt: availability.observedAt };
      return null;
    }
    instanceUnavailable = availability;
    if (["device_offline", "instance_unreachable", "server_unavailable"].includes(availability.status)) {
      return { done: false };
    }
    return { done: true, result: { allowed: false, queued: false, availability,
      reason: ["stale_result", "cancelled"].includes(availability.status) ? "scope-changed" : `instance-${availability.status.replace(/_/g, "-")}`,
      message: availability.status === "authentication_required" ? "Your organization requires authentication before automatic attendance can continue."
        : availability.status === "endpoint_unsupported" ? "Your organization's server does not support the attendance connection check."
        : "Your organization's server connection could not be verified.", location: null } };
  };

  const retainUncertainOnlineAttempt = async (failure) => {
    if (!strictOrdering) return null;
    const { kind, failureClass, status } = classifyAttendanceError(failure?.error);
    const knownRefusal = kind === FAILURE_KIND.BLOCKED && status >= 400 && status < 500 &&
      [FAILURE_CLASS.AUTH, FAILURE_CLASS.CONFIGURATION, FAILURE_CLASS.ENDPOINT_MISSING].includes(failureClass);
    if (knownRefusal) {
      if (typeof onKnownNoInsert === "function") await onKnownNoInsert({ httpStatus: status, failureClass });
      return null;
    }
    // The native receipt already records the dispatch. A queue row with no
    // dispatch evidence would let its first offline upload resend that request.
    return { ...failure, allowed: false, queued: false, reason: "online-outcome-unconfirmed",
      message: "Automatic attendance is retained for server verification before retry." };
  };

  const settleKnownDirectRefusal = async ({ queueForDelivery = false } = {}) => {
    if (!directReceipt || !knownDirectRefusal) return null;
    const row = await settleDirectAttendanceNoInsert({ id: directReceipt.id, claimOwner: directReceipt.claimOwner,
      queueForDelivery, ...knownDirectRefusal,
      ...(queueForDelivery ? { assertCurrent: () => assertAutomaticCapabilityCurrent(sourceScope, { queueing: true }) } : {}) });
    notifyQueueChanged();
    return row;
  };

  const retainLegacyDirectFailure = async (failure, { beforeDispatch = false } = {}) => {
    if (!directReceipt) return null;
    if (!beforeDispatch) invalidateInstanceAvailability();
    const classified = classifyAttendanceError(failure?.error);
    const localRefusal = failure?.error?.code === "FEATURE_DISABLED" ||
      failure?.error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE");
    const knownRefusal = classified.kind === FAILURE_KIND.BLOCKED && classified.status >= 400 && classified.status < 500 &&
      [FAILURE_CLASS.AUTH, FAILURE_CLASS.CONFIGURATION, FAILURE_CLASS.ENDPOINT_MISSING].includes(classified.failureClass);
    if (beforeDispatch || localRefusal || knownRefusal || classified.kind === FAILURE_KIND.REJECTED) {
      knownDirectRefusal = { failureClass: classified.failureClass ?? FAILURE_CLASS.CONFIGURATION,
        error: failure?.message ?? classified.message, serverResponse: failure?.error?.response?.data ?? null };
      if (knownRefusal && !beforeDispatch && !localRefusal) return { done: false };
      await settleKnownDirectRefusal();
      return { done: true, result: { ...failure, allowed: false, queued: false } };
    }
    await markNeedsReview({ id: directReceipt.id, claimOwner: directReceipt.claimOwner,
      error: failure?.message || "The automatic attendance request was dispatched without a confirmed outcome.",
      serverResponse: failure?.error?.response?.data ?? null });
    notifyQueueChanged();
    requestQueueDrain({ employeeId: employeeCode, reason: "online-outcome-unconfirmed" });
    return { done: true, result: { ...failure, allowed: false, queued: false, queueRowId: directReceipt.id,
      reason: "online-outcome-unconfirmed", message: "Automatic attendance is retained for server verification before retry." } };
  };

  /**
   * One online attempt.
   *
   * `{ done: true }` returns the confirmed, refused or uncertain result.
   * `{ done: false }` requires offline admission for work known to be unsent.
   */
  const attemptOnline = async () => {
    let heartbeat = null;
    let invoked = false;
    const localCapabilityRefusal = async (failure) => {
      const employeeRefusal = failure?.error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE");
      if (failure?.error?.code !== "FEATURE_DISABLED" && !employeeRefusal) return null;
      // The service/request guard refused before transport. Do not leave a
      // dispatch-intent marker that would demand impossible server evidence.
      if (strictOrdering && typeof onKnownNoInsert === "function") {
        await onKnownNoInsert({ httpStatus: null, failureClass: FAILURE_CLASS.CONFIGURATION });
      }
      return { ...failure, allowed: false, reason: employeeRefusal ? "employee-policy-disabled" : "capability-disabled" };
    };
    try {
      if (strictOrdering) await assertAttendanceQueueScope(sourceScope);
      const refusal = await checkAutomaticCapability(employeeCode, sourceScope);
      if (refusal) return { done: true, result: refusal };
      assertAutomaticCapabilityCurrent(sourceScope);
      const preflight = await preflightOnline();
      if (preflight) return preflight;
      assertAutomaticCapabilityCurrent(sourceScope);
      if (!strictOrdering) {
        await assertAttendanceQueueScope(sourceScope);
        preparedOnlineTimestamp = timestamp ?? await resolveServerTimestampAt(occurredAt ?? Date.now(), Date.now(), {
          syncScope: sourceScope, serverClock,
        });
        const config = await readAttendanceConfig();
        await assertAttendanceQueueScope(sourceScope);
        assertAutomaticCapabilityCurrent(sourceScope);
        const directOwner = `direct:${Date.now()}:${Math.random()}`;
        const acceptance = await beginDirectAttendanceReceipt({ employeeId: employeeCode, tenantKey: sourceScope.tenantKey,
          employeeDocname: config?.tenantKey === sourceScope.tenantKey && config?.employeeId === employeeCode
            ? config.employeeDocname ?? null : null,
          action: logTypeToAction(type), timestamp: preparedOnlineTimestamp, deviceId: DEVICE_ID,
          payload: { over_time: 0, directOnline: true },
          sourceEventId,
          ownerId: directOwner,
          assertCurrent: () => assertAutomaticCapabilityCurrent(sourceScope) });
        if (!acceptance.inserted && acceptance.reason === "earlier-attendance-unconfirmed") {
          orderingRequiresQueue = true;
          forceQueue = true;
          return { done: false };
        }
        if (!acceptance.inserted) return { done: true, result: { allowed: false, queued: false,
          reason: acceptance.reason ?? "earlier-attendance-unconfirmed", location: null,
          message: "Earlier saved attendance needs server confirmation before this action." } };
        directReceipt = { ...acceptance.row, claimOwner: directOwner };
        heartbeat = setInterval(() => {
          renewAttendanceClaim({ id: directReceipt.id, claimOwner: directReceipt.claimOwner }).catch(() => {});
        }, 30000);
        directReceipt = await renewAttendanceClaim({ id: directReceipt.id, claimOwner: directOwner });
        await assertAttendanceQueueScope(sourceScope);
        assertAutomaticCapabilityCurrent(sourceScope);
      }
      invoked = true;
      const result = await online({ serverClock, timestamp: preparedOnlineTimestamp });
      if (sourceScope) await assertAttendanceQueueScope(sourceScope);

      if (result?.allowed && (!directReceipt || (typeof result.name === "string" && !!result.name.trim()))) {
        if (directReceipt) {
          await markSynced({ id: directReceipt.id, claimOwner: directReceipt.claimOwner,
            serverCheckinId: result.name, acceptanceConfirmed: true });
          notifyQueueChanged();
        }
        // The strongest possible evidence that the server is up and this token
        // works: a punch just landed on it. Anything already queued should go
        // now rather than waiting for its own backoff to elapse — this is the
        // moment the queue is most likely to succeed and least likely to be
        // guessing about it.
        requestQueueDrain({ employeeId: employeeCode, reason: "online-punch" });
        return { done: true, result };
      }

      const directFailure = await retainLegacyDirectFailure(result ?? { allowed: false, location: null });
      if (directFailure) return directFailure;

      const localRefusal = await localCapabilityRefusal(result);
      if (localRefusal) return { done: true, result: localRefusal };

      if (!shouldQueueFailure(result)) {
        // A real refusal — out of radius, missing configuration, a rejected
        // payload. Surfacing it is the correct behaviour, online or not.
        return { done: true, result };
      }
      invalidateInstanceAvailability();
      const uncertain = await retainUncertainOnlineAttempt(result);
      if (uncertain) return { done: true, result: uncertain };

      console.log(
        `${LOG_PREFIX} Online attempt failed transiently, queueing:`,
        result?.message,
      );
      return { done: false };
    } catch (error) {
      const { message } = classifyAttendanceError(error);
      if (directReceipt && error?.code === QUEUE_CLAIM_CHANGED) {
        return { done: true, result: { allowed: false, queued: false, reason: "attendance-claim-changed", error, location: null,
          message: "This saved attendance request is being handled by another synchronization attempt." } };
      }
      const directFailure = await retainLegacyDirectFailure({ allowed: false, message, error, location: null }, { beforeDispatch: !invoked });
      if (directFailure) return directFailure;
      const localRefusal = await localCapabilityRefusal({ allowed: false, message, error, location: null });
      if (localRefusal) return { done: true, result: localRefusal };

      // Same rule as a returned failure — see shouldQueueFailure.
      if (!shouldQueueFailure({ error })) {
        return { done: true, result: { allowed: false, message, error, location: null } };
      }
      invalidateInstanceAvailability();
      const uncertain = await retainUncertainOnlineAttempt({ error });
      if (uncertain) return { done: true, result: uncertain };

      console.log(`${LOG_PREFIX} Online attempt threw, queueing:`, message);
      return { done: false };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  };

  if (canGoOnline && !forceQueue) {
    const attempt = await attemptOnline();
    if (attempt.done) return attempt.result;
  }

  /**
   * What to do when the queue will not take a punch that `forceQueue` sent here.
   *
   * Older callers can request the queue even after an earlier dependency has
   * settled. If admission refuses, a direct attempt is allowed only when no
   * unresolved ordering dependency or earlier direct dispatch remains. Native
   * journal inputs retain their strict-ordering refusal behavior.
   */
  const refuseOrFallBack = async (refusal) => {
    if (knownDirectRefusal) {
      await settleKnownDirectRefusal();
      return refusal;
    }
    // New native inputs remain durably retained for retry when admission fails.
    // The legacy forceQueue fallback is preserved for older callers/binaries.
    if (strictOrdering || orderingRequiresQueue || !forceQueue || !canGoOnline) return refusal;

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
  // The administrator's switch. Same reasoning as the capability check below,
  // for a different reason: nothing will drain what is queued here, because the
  // switch puts the sync manager in drain-only mode for rows that already exist
  // and stops new ones being justified at all.
  const queueingRefusal = await checkAutomaticCapability(employeeCode, sourceScope, { queueing: true });
  if (queueingRefusal) {
    console.log(`${LOG_PREFIX} Offline ${type} refused: switched off for this tenant`);
    return refuseOrFallBack(queueingRefusal);
  }

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
  let gate;
  try {
    gate = await evaluateOfflineAttendance({
      type,
      enforceRadius: attendanceType !== ATTENDANCE_TYPE.AUTO,
      ...(skipPosition ? { skipPosition: true } : {}),
    });
  } catch (error) {
    if (knownDirectRefusal) await settleKnownDirectRefusal();
    throw error;
  }

  if (!gate.allowed) {
    console.log(`${LOG_PREFIX} Offline ${type} refused:`, gate.reason);
    return refuseOrFallBack({
      allowed: false,
      message: gate.message,
      reason: gate.reason,
      location: null,
    });
  }

  if (knownDirectRefusal) {
    await assertAttendanceQueueScope(sourceScope);
    const refusal = await checkAutomaticCapability(employeeCode, sourceScope, { queueing: true });
    if (refusal) return refuseOrFallBack(refusal);
    if (gate.config?.tenantKey !== sourceScope.tenantKey || gate.config?.employeeId !== employeeCode) {
      return refuseOrFallBack({ allowed: false, reason: "config-scope-mismatch", location: null,
        message: "Attendance rules must be refreshed for this account." });
    }
    let row;
    try {
      row = await settleKnownDirectRefusal({ queueForDelivery: true });
    } catch (error) {
      if (!error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE") &&
        !["FEATURE_DISABLED", "CAPABILITY_SCOPE_CHANGED", "ATTENDANCE_SYNC_SCOPE_CHANGED"].includes(error?.code)) throw error;
      await settleKnownDirectRefusal();
      return { allowed: false, queued: false, reason: error.code === "FEATURE_DISABLED" ? "admin-disabled"
        : error.code.startsWith("EMPLOYEE_AUTO_ATTENDANCE") ? "employee-policy-disabled" : "scope-changed",
      message: "Automatic attendance was not submitted because your attendance policy or account changed.", location: null };
    }
    requestQueueDrain({ employeeId: employeeCode, action: logTypeToAction(type) });
    return { allowed: true, queued: true, row, location: gate.location ?? null,
      message: "Automatic attendance is saved on this device and waiting for server confirmation." };
  }

  return queueAttendance({
    employeeCode,
    type,
    attendanceType,
    occurredAt,
    photoUri,
    gate,
    sourceScope,
    sourceEventId,
    sourceParentEventId,
    timestamp: preparedOnlineTimestamp,
    strictOrdering,
  }).then(result => instanceUnavailable ? { ...result, availability: instanceUnavailable } : result);
};

/**
 * `submitAttendance` pre-bound for the manual screens — check-in, check-out and
 * the photo flow.
 *
 * Online only; see `submitOnlineOnly`. There is no `photoUri` because there is
 * no row to carry one: the camera screen uploads its picture itself, against the
 * docname the server returns.
 */
export const submitManualAttendance = ({ type, employeeCode, online, sourceScope }) =>
  submitAttendance({
    type,
    employeeCode,
    attendanceType: ATTENDANCE_TYPE.MANUAL,
    online,
    sourceScope,
  });

/** `submitAttendance` pre-bound for the geofence path. */
export const submitAutoAttendance = ({
  type,
  employeeCode,
  online,
  occurredAt,
  forceQueue = false,
  sourceScope,
  sourceEventId = null,
  sourceParentEventId = null,
  timestamp = null,
  strictOrdering = false,
  skipPosition = false,
  onKnownNoInsert,
}) =>
  submitAttendance({
    type,
    employeeCode,
    attendanceType: ATTENDANCE_TYPE.AUTO,
    online,
    occurredAt,
    forceQueue,
    sourceScope,
    sourceEventId,
    sourceParentEventId,
    timestamp,
    strictOrdering,
    skipPosition,
    onKnownNoInsert,
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
  registerQueueDrainHandler,
  resolveWithCorrection,
  shouldQueueFailure,
  submitAttendance,
  submitAutoAttendance,
  submitManualAttendance,
};
