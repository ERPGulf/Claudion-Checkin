import apiClient from "../api/apiClient";
import { findById, recordServerVerification, recordVerificationIssue } from "./AttendanceQueueRepository";
import { notifyQueueChanged } from "./AttendanceQueueService";
import { assertAttendanceQueueScope, captureAttendanceQueueScope } from "./attendanceQueueProvenance";
import { describeHttpFailure, logAttendanceDiagnostic } from "./attendanceDiagnostics";

const LOG_PREFIX = "[AttendanceVerification]";

export const ATTENDANCE_HISTORY_METHOD = "employee_app.attendance_api.get_attendance_details";

// Compare server wall-clock digits, never the handset timezone. Nonzero
// fractional seconds remain significant; offsets/unknown formats need review.
export const canonicalAttendanceTime = (value) => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 ||
    date.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return null;
  const precision = fraction.replace(/0+$/, "");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${precision ? `.${precision}` : ""}`;
};

export const equivalentServerPunch = (row, record) => {
  const time = canonicalAttendanceTime(row?.timestamp);
  const type = row?.action === "checkin" ? "IN" : row?.action === "checkout" ? "OUT" : null;
  const employee = record?.employee;
  return !!time && !!type && typeof record?.name === "string" && !!record.name.trim() &&
    typeof employee === "string" && employee === (row.employeeDocname || row.employeeId) &&
    canonicalAttendanceTime(record.time) === time && record.log_type === type;
};

/** Bounded diagnostics describe matching without logging employee history. */
const summarizeMatches = (row, records) => {
  const expectedTime = canonicalAttendanceTime(row?.timestamp);
  const expectedType = row?.action === "checkin" ? "IN" : row?.action === "checkout" ? "OUT" : null;
  const summary = { exact: 0, missingName: 0, differentEmployee: 0, differentTime: 0, differentAction: 0 };
  records.forEach(record => {
    if (!(typeof record?.name === "string" && record.name.trim())) summary.missingName += 1;
    if (record?.employee !== (row?.employeeDocname || row?.employeeId)) summary.differentEmployee += 1;
    if (canonicalAttendanceTime(record?.time) !== expectedTime) summary.differentTime += 1;
    if (record?.log_type !== expectedType) summary.differentAction += 1;
    if (equivalentServerPunch(row, record)) summary.exact += 1;
  });
  return summary;
};

const verificationResult = (row, result) => {
  logAttendanceDiagnostic(LOG_PREFIX, `#${row?.id} result: ${result.verified ? "VERIFIED" : result.reason}`, result);
  return result;
};

/** Positive evidence only. No result from this API can authorize a resend. */
export const verifyQueuedAttendance = async (row, { syncScope, maxPages = 25 } = {}) => {
  logAttendanceDiagnostic(LOG_PREFIX, `#${row?.id} start`, {
    method: "GET", endpoint: `${row?.tenantKey}/api/method/${ATTENDANCE_HISTORY_METHOD}`, queueRowId: row?.id,
    expected: { employee: row?.employeeDocname || row?.employeeId, rawTimestamp: row?.timestamp,
      canonicalTime: canonicalAttendanceTime(row?.timestamp), log_type: row?.action === "checkin" ? "IN" : row?.action === "checkout" ? "OUT" : null },
    timezone: "None applied: both sides are server wall-clock strings compared digit for digit; nonzero fractional seconds stay significant.",
    criteria: "Exactly one record with a non-empty name AND employee === expected employee AND canonical time === expected AND log_type === expected.",
  });
  if (!row?.tenantKey || !canonicalAttendanceTime(row.timestamp) || !["checkin", "checkout"].includes(row.action)) {
    return verificationResult(row, { verified: false, reason: "original-data-needs-review" });
  }
  syncScope = syncScope ?? await captureAttendanceQueueScope(row.employeeId);
  if (syncScope.tenantKey !== row.tenantKey || syncScope.employeeId !== row.employeeId) {
    return verificationResult(row, { verified: false, reason: "company-needs-review" });
  }
  const pageSize = 20;
  for (let page = 0; page < Math.min(Math.max(maxPages, 1), 25); page += 1) {
    const current = await assertAttendanceQueueScope(syncScope);
    const params = { employee_id: row.employeeId, limit_start: page * pageSize, limit_page_length: pageSize };
    const startedAt = Date.now();
    let data;
    try {
      const response = await apiClient.get(`${current.tenantKey}/api/method/${ATTENDANCE_HISTORY_METHOD}`, {
        params,
        headers: { Authorization: `Bearer ${current.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
        attendanceSyncScope: syncScope,
        // Essential outbox verification is distinct from opening history UI.
        // Positive server evidence prevents duplicate attendance resubmission.
        attendanceStatusRead: true,
        timeout: 10000,
      });
      data = response.data;
      logAttendanceDiagnostic(LOG_PREFIX, `#${row.id} page ${page} HTTP ${response.status}`, {
        page, durationMs: Date.now() - startedAt,
        recordCount: Array.isArray(data?.message) ? data.message.length : null,
        matches: Array.isArray(data?.message) ? summarizeMatches(row, data.message) : null,
        hasException: !!(data?.exc || data?.exception || data?.error),
      });
    } catch (error) {
      logAttendanceDiagnostic(LOG_PREFIX, `#${row.id} page ${page} failed`, {
        params, durationMs: Date.now() - startedAt, ...describeHttpFailure(error),
      });
      await assertAttendanceQueueScope(syncScope);
      return verificationResult(row, { verified: false, reason: "server-unavailable" });
    }
    await assertAttendanceQueueScope(syncScope);
    if (!Array.isArray(data?.message) || data.exc || data.exception || data.error) {
      return verificationResult(row, { verified: false, reason: "unrecognized-server-response" });
    }
    const matches = data.message.filter(record => equivalentServerPunch(row, record));
    if (matches.length > 1) return verificationResult(row, { verified: false, reason: "multiple-server-records" });
    if (matches.length === 1) {
      const { name, employee, time, log_type } = matches[0];
      return verificationResult(row, { verified: true, evidence: {
        method: ATTENDANCE_HISTORY_METHOD, tenantKey: row.tenantKey,
        name, employee, time, log_type,
      } });
    }
    if (data.message.length < pageSize) break;
  }
  return verificationResult(row, { verified: false, reason: "no-exact-match-in-visible-history" });
};

/** User-selected reconciliation never POSTs or requeues a historical record. */
export const reconcileAttendanceRow = async ({ id, employeeId }) => {
  const scope = await captureAttendanceQueueScope(employeeId);
  const row = await findById(id);
  await assertAttendanceQueueScope(scope);
  if (!row || row.employeeId !== scope.employeeId || row.tenantKey !== scope.tenantKey ||
    ["pending", "syncing", "blocked"].includes(row.status)) {
    return { verified: false, reason: "record-not-eligible" };
  }
  const result = await verifyQueuedAttendance(row, { syncScope: scope });
  await assertAttendanceQueueScope(scope);
  if (!result.verified) {
    await recordVerificationIssue({ row, reason: result.reason });
    logAttendanceDiagnostic("[AttendanceQueue]", `#${row.id} ${row.status} → ${row.status} (Check server record)`, {
      reason: `Not verified (${result.reason}); verificationIssue recorded. This check never re-sends the punch.`,
      attemptCount: row.attemptCount, lastError: row.error,
    });
    notifyQueueChanged();
    return result;
  }
  const changed = await recordServerVerification({ row, evidence: result.evidence });
  logAttendanceDiagnostic("[AttendanceQueue]", `#${row.id} ${row.status} → ${changed ? "synced" : row.status} (Check server record)`, {
    reason: changed ? `Verified as ${result.evidence.name}` : "Verified, but the row changed meanwhile; nothing written.",
  });
  if (!changed) return { verified: false, reason: "record-changed" };
  notifyQueueChanged();
  return result;
};
