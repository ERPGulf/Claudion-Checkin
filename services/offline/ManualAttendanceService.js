import { performSessionTransition, readSession, SESSION_ORIGIN, TRANSITION_RESULT, applySessionOwner } from "../../utils/attendanceSessionState";
import { captureAttendanceQueueScope, assertAttendanceQueueScope, createAttendanceScopeChangedError } from "./attendanceQueueProvenance";
import { submitManualAttendance } from "./AttendanceQueueService";
import { reconcileUncertainAutoAttendance } from "./AutoAttendanceEventProcessor";

export const createManualAttendanceContext = async (employeeCode) => {
  const occurredAt = Date.now();
  const scope = await captureAttendanceQueueScope(employeeCode);
  return { scope, occurredAt };
};

export const assertManualAttendanceCurrent = ({ scope }) => assertAttendanceQueueScope(scope);

/** Shared manual entry; preparation/reconciliation happens before taking the session lock. */
export const performManualAttendanceTransition = async ({ type, employeeCode, online, context }) => {
  const current = context ?? await createManualAttendanceContext(employeeCode);
  await assertManualAttendanceCurrent(current);
  if (current.scope.employeeId !== employeeCode) throw createAttendanceScopeChangedError();
  await applySessionOwner(employeeCode, { tenantKey: current.scope.tenantKey,
    assertCurrent: () => assertManualAttendanceCurrent(current) });
  const recovery = await reconcileUncertainAutoAttendance(current);
  await assertManualAttendanceCurrent(current);
  if (!recovery.ready) {
    const session = await readSession();
    await assertManualAttendanceCurrent(current);
    return { status: TRANSITION_RESULT.FAILED, session, previousSession: session, ...current,
      queued: false, serverConfirmed: false, response: { allowed: false, reason: "automatic-attendance-unconfirmed",
        message: "An earlier automatic attendance request needs server verification. Check the saved record in Attendance recovery before trying again." } };
  }
  const outcome = await performSessionTransition({ type, origin: SESSION_ORIGIN.MANUAL, at: current.occurredAt,
    strictRead: true, assertCurrent: () => assertManualAttendanceCurrent(current),
    execute: () => submitManualAttendance({ type, employeeCode, sourceScope: current.scope, online: () => online(current) }),
  });
  await assertManualAttendanceCurrent(current);
  return { ...outcome, ...current };
};
