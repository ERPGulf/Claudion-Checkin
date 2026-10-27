import { AppState } from "react-native";
import * as Native from "../../modules/expo-auto-attendance";
import * as Events from "./AutoAttendanceEventRepository";
import { findBySourceEventId } from "./AttendanceQueueRepository";
import { submitAutoAttendance, notifyQueueChanged } from "./AttendanceQueueService";
import { canonicalAttendanceTime, verifyQueuedAttendance } from "./AttendanceVerification";
import { assertAttendanceQueueScope } from "./attendanceQueueProvenance";
import { captureAttendanceQueueScope } from "./attendanceQueueProvenance";
import { readAttendanceConfig } from "./attendanceConfigCache";
import { fetchShouldAttemptRequest, isOnline } from "./NetworkListener";
import { autoCheckInOut, getAttendanceStatus, resolveServerTimestampAt } from "../api/attendance.service";
import { formatOfflineTimestamp, normalizeAttendanceStatusClock } from "../../utils/serverClock";
import { normalizeCustomIn, toTimestampMs } from "../../utils/attendanceSession";
import { validOffice, nativeRadiusMatchesRequested } from "../../utils/autoAttendanceRegistration";
import { resolveLocationCoordinates } from "../../utils/attendanceLocations";
import { assertCapability, assertCapabilityCurrent } from "../capabilityPolicy";
import { assertEmployeeAutoAttendancePolicy } from "../employeeAutoAttendancePolicy";
import { ATTENDANCE_FEATURES } from "../../utils/featureSettings";
import {
  applySessionOwner, clearUnverifiedSessionOwner, performSessionTransition,
  readUnverifiedSessionOwner, reconcileSessionFromServer, SESSION_ORIGIN, TRANSITION_RESULT,
} from "../../utils/attendanceSessionState";

const { PENDING, PROCESSING, HANDLED, NEEDS_REVIEW } = Events.AUTO_EVENT_STATUS;
let processor = Promise.resolve();
const claimOwner = `auto-attendance:${Date.now()}:${Math.random()}`;

const automaticCapabilityRefusal = async (scope) => {
  try {
    await assertCapability(ATTENDANCE_FEATURES.AUTO_ATTENDANCE,
      { baseUrl: scope.tenantKey, employeeCode: scope.employeeId, generation: scope.generation });
    await assertEmployeeAutoAttendancePolicy(scope);
    assertCapabilityCurrent(ATTENDANCE_FEATURES.AUTO_ATTENDANCE, scope);
    return null;
  } catch (error) {
    const employeeRefusal = error?.code?.startsWith("EMPLOYEE_AUTO_ATTENDANCE");
    if (error?.code !== "FEATURE_DISABLED" && !employeeRefusal) throw error;
    return { allowed: false, reason: employeeRefusal ? "employee-policy-disabled" : "capability-disabled",
      message: error.message, error };
  }
};

/** Review checks only positive history evidence; it never resends an uncertain POST. */
export const verifyAutoAttendanceEvent = async ({ eventId, employeeId }) => {
  const scope = await captureAttendanceQueueScope(employeeId);
  const row = await Events.findEvent(eventId);
  if (row?.status !== NEEDS_REVIEW || !row.onlineAttemptAt ||
    row.tenantKey !== scope.tenantKey || row.employeeId !== scope.employeeId) return { verified: false };
  const config = await readAttendanceConfig();
  if (config?.tenantKey !== scope.tenantKey || config?.employeeId !== scope.employeeId) return { verified: false };
  const result = await verifyQueuedAttendance({ tenantKey: row.tenantKey, employeeId: row.employeeId,
    employeeDocname: config.employeeDocname, timestamp: row.punchTimestamp,
    action: row.transition === "ENTER" ? "checkin" : "checkout" }, { syncScope: scope });
  await assertAttendanceQueueScope(scope);
  if (result.verified) {
    await Events.updateEvent(eventId, { status: PENDING, reason: "server-record-verified" });
    notifyQueueChanged();
  }
  return result;
};

const updateOwned = async (eventId, changes = {}) => {
  const row = await Events.updateClaimedEvent(eventId, claimOwner, changes);
  if (!row) {
    const error = new Error("Automatic attendance event claim changed.");
    error.code = "AUTO_ATTENDANCE_CLAIM_CHANGED";
    throw error;
  }
  return row;
};

/** Native remains authoritative until SQLite commits; an ack failure is replay-safe. */
export const ingestPendingNativeEvents = async () => {
  if (typeof Native.getPendingEvents !== "function") return 0;
  const pending = Native.getPendingEvents();
  if (!Array.isArray(pending)) return 0;
  for (const event of pending) {
    await Events.ingestNativeEvent(event);
    if (event.eventId) {
      try {
        Native.acknowledgeEvent(event.eventId);
      } catch (error) {
        // SQLite owns a committed copy; leave native's copy for idempotent replay.
        console.log("[AutoAttendance] Native acknowledgement retained", { code: error?.code });
      }
    }
  }
  if (pending.length) notifyQueueChanged();
  return pending.length;
};

const validateEvent = (event, scope) => {
  if (event?.tenantKey !== scope.tenantKey || event?.employeeId !== scope.employeeId) return "native-provenance-mismatch";
  if (event.captureIssue || event.identifier !== Native.OFFICE_GEOFENCE_IDENTIFIER ||
    !["ENTER", "EXIT"].includes(event.transition) || !validOffice(event) ||
    !Number.isFinite(event.timestamp) || event.timestamp <= 0 ||
    event.timestamp > Date.now() + 60000 || typeof event.registrationId !== "string" || !event.registrationId) return "invalid-native-event";
  if ((event.initialPresence !== undefined && typeof event.initialPresence !== "boolean") ||
    (event.initialPresence === true && (!Number.isFinite(event.registrationStartedAt) ||
      event.registrationStartedAt <= 0 || event.registrationStartedAt > event.timestamp))) return "invalid-native-event";
  try {
    const [tenant, employee, identifier, latitude, longitude, requestedRadius, policy] = JSON.parse(event.registrationId);
    if (tenant !== scope.tenantKey || employee !== scope.employeeId || identifier !== event.identifier ||
      latitude !== event.latitude || longitude !== event.longitude || policy !== Number(event.geotagging) ||
      !nativeRadiusMatchesRequested(event, requestedRadius)) return "native-configuration-mismatch";
  } catch {
    return "native-configuration-mismatch";
  }
  return null;
};

const restoreVerifiedOwner = async (scope) => {
  const evidence = await readUnverifiedSessionOwner();
  if (!evidence) return true;
  if (evidence.unreadable) return false;
  if (evidence.intendedOwner?.tenantKey !== scope.tenantKey ||
    evidence.intendedOwner?.employeeId !== scope.employeeId) return true;
  const fetchedAt = Date.now();
  const status = await normalizeAttendanceStatusClock(await getAttendanceStatus({ syncScope: scope }), scope);
  await assertAttendanceQueueScope(scope);
  if (status?.unavailable) return false;
  const active = normalizeCustomIn(status?.custom_in) === 1;
  const start = toTimestampMs(status?.checkin_time);
  if (active && !start) return false;
  const restored = await reconcileSessionFromServer({ activeStartedAt: active ? start : null, fetchedAt,
    assertCurrent: () => assertAttendanceQueueScope(scope) });
  if (active ? restored.status !== "CHECKED_IN" || restored.startedAt !== start : restored.status !== "CHECKED_OUT") return false;
  await assertAttendanceQueueScope(scope);
  await clearUnverifiedSessionOwner();
  return true;
};

const saveOutcome = async (row, result) => {
  const queueRowId = result.response?.queueRowId ?? result.response?.row?.id ?? null;
  await updateOwned(row.eventId, {
    status: HANDLED, reason: result.reason ?? null,
    sessionAt: result.session?.startedAt ?? result.session?.endedAt ?? null,
    queueRowId,
    outcome: { status: result.status, queued: result.queued, serverConfirmed: result.serverConfirmed,
      name: result.response?.name ?? null },
  });
  // Development only: one line per processed crossing, for device testing.
  if (__DEV__) {
    console.log("[AutoAttendance] Event processed", {
      eventId: row.eventId, transition: row.transition, geofence: row.event?.identifier,
      detectedAt: new Date(row.occurredAt).toISOString(), receivedAt: new Date(row.receivedAt).toISOString(),
      appState: AppState.currentState, transport: isOnline?.() ?? null, status: result.status ?? null,
      reason: result.reason ?? null, queued: !!result.queued, serverConfirmed: !!result.serverConfirmed,
      queueRowId, serverRecord: result.response?.name ?? null, session: result.session?.status ?? null,
    });
  }
  notifyQueueChanged();
};

const runTransition = (row, scope, execute) => performSessionTransition({
  type: row.transition === "ENTER" ? "IN" : "OUT", origin: SESSION_ORIGIN.AUTO,
  at: row.occurredAt, rejectStale: true, strictRead: true,
  sourceEventId: row.eventId, withSessionContext: true,
  assertCurrent: async () => {
    await assertAttendanceQueueScope(scope);
    await updateOwned(row.eventId);
  }, execute,
});

const processRow = async (input, scope, config) => {
  let row = await Events.claimEvent(input.eventId, { ownerId: claimOwner });
  if (!row) return { stop: true };
  const invalid = validateEvent(row.event, scope);
  if (invalid) {
    await updateOwned(row.eventId, { status: NEEDS_REVIEW, reason: invalid });
    notifyQueueChanged();
    return {};
  }
  const requestedRadius = JSON.parse(row.event.registrationId)[5];
  const matchesCurrentOffice = config.locations.some(location => {
    const coordinates = resolveLocationCoordinates(location);
    const radius = Number(location.reporting_radius) > 0 ? Number(location.reporting_radius) : 100;
    return coordinates?.latitude === row.event.latitude && coordinates?.longitude === row.event.longitude && radius === requestedRadius;
  });
  if (Number.isFinite(config.lastUpdated) && row.occurredAt >= config.lastUpdated && !matchesCurrentOffice) {
    await updateOwned(row.eventId, { status: NEEDS_REVIEW, reason: "stale-native-configuration" });
    notifyQueueChanged();
    return {};
  }
  // Warnings-only callbacks remain receipts but never become attendance punches.
  if (Number(row.event.geotagging) === 1) {
    await updateOwned(row.eventId, { status: HANDLED, reason: "warnings-only" });
    return {};
  }
  if (Number(row.event.geotagging) !== 2) {
    await updateOwned(row.eventId, { status: PENDING, reason: "policy-not-all-actions" });
    return { stop: true };
  }
  const existing = await findBySourceEventId({ sourceEventId: row.eventId, tenantKey: scope.tenantKey, employeeId: scope.employeeId });
  await assertAttendanceQueueScope(scope);
  if (existing) {
    const queued = ["pending", "syncing", "blocked"].includes(existing.status);
    const confirmed = existing.status === "synced" && existing.acceptanceConfirmed;
    if (!queued && !confirmed) {
      await updateOwned(row.eventId, { status: NEEDS_REVIEW, reason: "source-event-needs-review", queueRowId: existing.id });
      notifyQueueChanged();
      return { stop: true };
    }
    const result = await runTransition(row, scope, async () => ({ allowed: true, queued, queueRowId: existing.id }));
    await saveOutcome(row, result);
    return { result };
  }
  if (row.onlineAttemptAt) {
    const verification = await verifyQueuedAttendance({ tenantKey: row.tenantKey, employeeId: row.employeeId,
      employeeDocname: config.employeeDocname, timestamp: row.punchTimestamp,
      action: row.transition === "ENTER" ? "checkin" : "checkout" }, { syncScope: scope });
    await assertAttendanceQueueScope(scope);
    if (!verification.verified) {
      await updateOwned(row.eventId, { status: verification.reason === "server-unavailable" ? PROCESSING : NEEDS_REVIEW,
        reason: verification.reason });
      notifyQueueChanged();
      return { stop: true };
    }
    const result = await runTransition(row, scope, async () => ({ allowed: true, name: verification.evidence.name }));
    await saveOutcome(row, result);
    return { result };
  }
  // Existing queue rows and verified earlier dispatches remain recoverable
  // after policy revocation. A fresh action below must use the current mode.
  const refusal = await automaticCapabilityRefusal(scope);
  if (refusal) {
    await updateOwned(row.eventId, { status: PENDING, reason: refusal.reason });
    return { stop: true };
  }
  const type = row.transition === "ENTER" ? "IN" : "OUT";
  const result = await runTransition(row, scope, async (session) => {
    const refusal = await automaticCapabilityRefusal(scope);
    if (refusal) return refusal;
    if (type === "IN" && row.event.initialPresence === true && session.closedBy === SESSION_ORIGIN.MANUAL &&
      Number.isFinite(row.event.registrationStartedAt) && Number.isFinite(session.endedAt) &&
      session.endedAt >= row.event.registrationStartedAt) {
      return { allowed: false, reason: "initial-presence-after-manual-checkout" };
    }
    let forceQueue = false;
    let sourceParentEventId = null;
    if (type === "OUT" && session.sourceEventId) {
      const parent = await findBySourceEventId({ sourceEventId: session.sourceEventId,
        tenantKey: scope.tenantKey, employeeId: scope.employeeId });
      await assertAttendanceQueueScope(scope);
      if (parent && !(parent.status === "synced" && parent.acceptanceConfirmed)) {
        if (!["pending", "syncing", "blocked"].includes(parent.status)) {
          return { allowed: false, reason: "source-parent-needs-review" };
        }
        forceQueue = true;
        sourceParentEventId = session.sourceEventId;
      }
    }
    let timestamp = row.punchTimestamp;
    if (!timestamp) {
      if (await fetchShouldAttemptRequest()) {
        try {
          timestamp = await resolveServerTimestampAt(row.occurredAt, Date.now(), { syncScope: scope });
        } catch {
          await assertAttendanceQueueScope(scope);
          forceQueue = true;
        }
      } else forceQueue = true;
      if (!canonicalAttendanceTime(timestamp)) {
        timestamp = await formatOfflineTimestamp(row.occurredAt, { tenantKey: scope.tenantKey });
        forceQueue = true;
      }
      row = await updateOwned(row.eventId, { punchTimestamp: timestamp });
    }
    await assertAttendanceQueueScope(scope);
    if (await Events.findPunchTimestampCollision(row, timestamp)) {
      return { allowed: false, reason: "source-event-collision" };
    }
    const currentRefusal = await automaticCapabilityRefusal(scope);
    if (currentRefusal) return currentRefusal;
    return submitAutoAttendance({ type, employeeCode: scope.employeeId, occurredAt: row.occurredAt,
      sourceScope: scope, sourceEventId: row.eventId, timestamp, forceQueue, strictOrdering: true, skipPosition: true,
      sourceParentEventId,
      onKnownNoInsert: async ({ httpStatus, failureClass }) => {
        row = await updateOwned(row.eventId, { onlineAttemptAt: null,
          outcome: { requestOutcome: "not-inserted", attemptedAt: row.onlineAttemptAt, httpStatus, failureClass } });
      },
      online: async () => {
        await assertAttendanceQueueScope(scope);
        const refusal = await automaticCapabilityRefusal(scope);
        if (refusal) return refusal;
        row = await updateOwned(row.eventId, { onlineAttemptAt: Date.now() });
        await assertAttendanceQueueScope(scope);
        const currentRefusal = await automaticCapabilityRefusal(scope);
        if (currentRefusal) {
          row = await updateOwned(row.eventId, { onlineAttemptAt: null });
          return currentRefusal;
        }
        const reportingLocation = config.locations.find(location => {
          const coordinates = resolveLocationCoordinates(location);
          return coordinates?.latitude === row.event.latitude && coordinates?.longitude === row.event.longitude;
        });
        return autoCheckInOut({ employeeCode: scope.employeeId, type,
          office: { ...row.event, locationName: reportingLocation?.location || "Automatic (geofence)" },
          occurredAt: row.occurredAt, timestamp, syncScope: scope });
      },
    });
  });
  if (result.status !== TRANSITION_RESULT.FAILED) {
    await saveOutcome(row, result);
    return { result };
  }
  // If a POST may have reached the server, the durable attempt must be verified.
  if (result.response?.reason === "initial-presence-after-manual-checkout") {
    await updateOwned(row.eventId, { status: HANDLED, reason: result.response.reason,
      outcome: { status: TRANSITION_RESULT.SKIPPED, queued: false, serverConfirmed: false } });
    notifyQueueChanged();
    return { result };
  }
  const review = ["source-event-collision", "source-event-needs-review", "source-parent-needs-review"].includes(result.response?.reason);
  await updateOwned(row.eventId, { status: review ? NEEDS_REVIEW : row.onlineAttemptAt ? PROCESSING : PENDING,
    reason: result.response?.reason ?? "attendance-not-accepted" });
  notifyQueueChanged();
  return { result, stop: true };
};

/** Runs outside the session lock; never dispatches new attendance or steals a live claim. */
export const reconcileUncertainAutoAttendance = ({ scope }) => {
  const task = processor.then(async () => {
    await ingestPendingNativeEvents();
    await assertAttendanceQueueScope(scope);
    if (!await restoreVerifiedOwner(scope)) return { ready: false, reason: "session-owner-unverified" };
    const inputs = await Events.listUncertainEvents(scope);
    if (!inputs.length) return { ready: true };
    const config = await readAttendanceConfig();
    if (config?.tenantKey !== scope.tenantKey || config?.employeeId !== scope.employeeId) {
      return { ready: false, reason: "configuration-unavailable" };
    }
    for (const input of inputs) {
      if (validateEvent(input.event, scope)) return { ready: false, reason: "original-data-needs-review" };
      const row = input.status === PROCESSING && input.claimOwner === claimOwner && input.claimExpiresAt > Date.now()
        ? await updateOwned(input.eventId)
        : await Events.claimEvent(input.eventId, { ownerId: claimOwner, allowReview: true });
      if (!row) return { ready: false, reason: "automatic-request-in-progress" };
      const existing = await findBySourceEventId({ sourceEventId: row.eventId, tenantKey: scope.tenantKey, employeeId: scope.employeeId });
      await assertAttendanceQueueScope(scope);
      if (existing && !(existing.status === "synced" && existing.acceptanceConfirmed)) {
        await updateOwned(row.eventId, { status: NEEDS_REVIEW, reason: "source-event-needs-review", queueRowId: existing.id });
        notifyQueueChanged();
        return { ready: false, reason: "automatic-attendance-unconfirmed" };
      }
      const verification = existing ? { verified: true, evidence: { name: existing.serverCheckinId } }
        : await verifyQueuedAttendance({ tenantKey: row.tenantKey, employeeId: row.employeeId,
          employeeDocname: config.employeeDocname, timestamp: row.punchTimestamp,
          action: row.transition === "ENTER" ? "checkin" : "checkout" }, { syncScope: scope });
      await assertAttendanceQueueScope(scope);
      if (!verification.verified) {
        await updateOwned(row.eventId, { status: NEEDS_REVIEW, reason: verification.reason });
        notifyQueueChanged();
        return { ready: false, reason: verification.reason };
      }
      const result = await runTransition(row, scope, async () => ({ allowed: true, name: verification.evidence.name }));
      await saveOutcome(row, result);
    }
    return { ready: true };
  });
  processor = task.catch(() => {});
  return task;
};

/** One ordered ingress processor; SQLite claims additionally protect receipt ownership. */
export const drainAutoAttendanceEvents = ({ scope, onTransition } = {}) => {
  const task = processor.then(async () => {
    await ingestPendingNativeEvents();
    if (!scope) return { processed: 0 };
    await assertAttendanceQueueScope(scope);
    await applySessionOwner(scope.employeeId, { tenantKey: scope.tenantKey,
      assertCurrent: () => assertAttendanceQueueScope(scope) });
    if (!await restoreVerifiedOwner(scope)) return { processed: 0, reason: "session-owner-unverified" };
    const config = await readAttendanceConfig();
    if (config?.tenantKey !== scope.tenantKey || config?.employeeId !== scope.employeeId) return { processed: 0, reason: "configuration-unavailable" };
    let processed = 0;
    for (const row of await Events.listPendingEvents(scope)) {
      await assertAttendanceQueueScope(scope);
      if (await Events.hasEarlierUnresolvedEvent(row)) break;
      const { result, stop } = await processRow(row, scope, config);
      await assertAttendanceQueueScope(scope);
      if (result && onTransition) await onTransition(result, row.event);
      if (stop) break;
      processed += 1;
    }
    return { processed };
  });
  processor = task.catch(() => {});
  return task;
};
