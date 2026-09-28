import apiClient from "../api/apiClient";
import { findById, recordServerVerification, recordVerificationIssue } from "./AttendanceQueueRepository";
import { notifyQueueChanged } from "./AttendanceQueueService";
import { assertAttendanceQueueScope, captureAttendanceQueueScope } from "./attendanceQueueProvenance";

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

/** Positive evidence only. No result from this API can authorize a resend. */
export const verifyQueuedAttendance = async (row, { syncScope, maxPages = 25 } = {}) => {
  if (!row?.tenantKey || !canonicalAttendanceTime(row.timestamp) || !["checkin", "checkout"].includes(row.action)) {
    return { verified: false, reason: "original-data-needs-review" };
  }
  syncScope = syncScope ?? await captureAttendanceQueueScope(row.employeeId);
  if (syncScope.tenantKey !== row.tenantKey || syncScope.employeeId !== row.employeeId) {
    return { verified: false, reason: "company-needs-review" };
  }
  const pageSize = 20;
  for (let page = 0; page < Math.min(Math.max(maxPages, 1), 25); page += 1) {
    const current = await assertAttendanceQueueScope(syncScope);
    let data;
    try {
      ({ data } = await apiClient.get(`${current.tenantKey}/api/method/${ATTENDANCE_HISTORY_METHOD}`, {
        params: { employee_id: row.employeeId, limit_start: page * pageSize, limit_page_length: pageSize },
        headers: { Authorization: `Bearer ${current.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
        attendanceSyncScope: syncScope,
        timeout: 10000,
      }));
    } catch {
      await assertAttendanceQueueScope(syncScope);
      return { verified: false, reason: "server-unavailable" };
    }
    await assertAttendanceQueueScope(syncScope);
    if (!Array.isArray(data?.message) || data.exc || data.exception || data.error) {
      return { verified: false, reason: "unrecognized-server-response" };
    }
    const matches = data.message.filter(record => equivalentServerPunch(row, record));
    if (matches.length > 1) return { verified: false, reason: "multiple-server-records" };
    if (matches.length === 1) {
      const { name, employee, time, log_type } = matches[0];
      return { verified: true, evidence: {
        method: ATTENDANCE_HISTORY_METHOD, tenantKey: row.tenantKey,
        name, employee, time, log_type,
      } };
    }
    if (data.message.length < pageSize) break;
  }
  return { verified: false, reason: "no-exact-match-in-visible-history" };
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
    notifyQueueChanged();
    return result;
  }
  const changed = await recordServerVerification({ row, evidence: result.evidence });
  if (!changed) return { verified: false, reason: "record-changed" };
  notifyQueueChanged();
  return result;
};
