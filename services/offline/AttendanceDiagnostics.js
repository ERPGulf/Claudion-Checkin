import { listClaimableIds, listDiagnosticRows } from "./AttendanceQueueRepository";

const BASELINE_UNRESOLVED = ["pending", "syncing", "blocked", "rejected"];

/**
 * Read-only support seam. Call on an affected device with diagnostic input;
 * never send or log the result automatically. IDs are strings (leading zeros
 * matter), dates are original server wall-clock dates, not handset dates.
 * No match is not proof of deletion. See docs/attendance-sync-forensic-audit.md.
 */
export const inspectAttendanceQueue = async ({ targets, scope, since = null, now = Date.now() }) => {
  if (!Array.isArray(targets) || !scope?.employeeId || !scope?.tenantKey) throw new Error("Diagnostic input and current scope required");
  targets.forEach(target => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target?.date) || !Array.isArray(target.employees) ||
      target.employees.some(id => typeof id !== "string" || !id)) throw new Error("Use YYYY-MM-DD dates and string employee IDs");
  });
  const claimableIds = new Set(await listClaimableIds({ ...scope, now }));
  const matches = [];
  const unmatched = [];
  for (const target of targets) {
    const rows = await listDiagnosticRows({ employeeIds: target.employees, date: target.date });
    target.employees.forEach(employeeId => {
      if (!rows.some(row => row.employeeId === employeeId)) unmatched.push({ employeeId, date: target.date });
    });
    rows.forEach(row => {
      const sameEmployee = row.employeeId === scope.employeeId;
      const knownScope = sameEmployee && row.tenantKey === scope.tenantKey;
      const visibleScope = sameEmployee && (row.tenantKey === scope.tenantKey || row.tenantKey === null);
      matches.push({
        id: row.id, employeeId: row.employeeId, employeeDocname: row.employeeDocname,
        tenantKey: row.tenantKey, timestamp: row.timestamp, action: row.action,
        attendanceType: row.attendanceType, status: row.status, failureClass: row.failureClass,
        retryCount: row.retryCount, attemptCountSinceUpgrade: row.attemptCount,
        blockedSince: row.blockedSince,
        lastAttemptAt: row.lastAttemptAt, lastError: row.error,
        sessionId: row.sessionId, pairedAttendanceId: row.pairedAttendanceId,
        serverCheckinId: row.serverCheckinId, duplicate: row.duplicate,
        duplicateMessage: row.duplicateMessage, createdAt: row.createdAt, updatedAt: row.updatedAt,
        nextAttemptAt: row.nextAttemptAt, acceptanceConfirmed: row.acceptanceConfirmed,
        verifiedAt: row.verifiedAt, verificationEvidence: row.verificationEvidence,
        verificationCheckedAt: row.verificationCheckedAt, verificationIssue: row.verificationIssue,
        includedInBaselinePendingSync: visibleScope && (BASELINE_UNRESOLVED.includes(row.status) ||
          (knownScope && row.status === "synced" && since != null && row.updatedAt >= since)),
        includedInRecovery: visibleScope,
        includedInPendingCount: knownScope && ["pending", "blocked"].includes(row.status),
        drainRetryable: knownScope && ["pending", "blocked"].includes(row.status),
        claimableNow: claimableIds.has(row.id),
        // Preserve originals for an authorized support inspection, not employee UI.
        payload: row.payload, serverResponse: row.serverResponse,
        rawPayload: row.rawPayload, rawServerResponse: row.rawServerResponse,
        latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy,
        address: row.address, deviceId: row.deviceId,
        resolutionDocname: row.resolutionDocname, resolvedAt: row.resolvedAt,
      });
    });
  }
  return { inspectedAt: now, scope: { employeeId: scope.employeeId, tenantKey: scope.tenantKey }, matches, unmatched };
};
