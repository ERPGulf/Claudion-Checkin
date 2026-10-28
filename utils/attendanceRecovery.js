const INSTANCE_STATES = new Set([
  "device_offline", "instance_unreachable", "server_unavailable", "authentication_required",
  "endpoint_unsupported", "configuration_error",
]);

const instanceState = (row) => INSTANCE_STATES.has(row.instanceStatus) ? row.instanceStatus
  : INSTANCE_STATES.has(row.error) ? row.error : null;

const requiresAttentionBeforeDelivery = (row) => row.status === "needs_review" ||
  (row.status === "synced" && !row.acceptanceConfirmed) ||
  (row.status === "pending" && !!row.uploadAttemptAt) ||
  (row.status === "blocked" && row.failureClass !== "endpoint-missing") ||
  (!row.tenantKey && ["pending", "syncing"].includes(row.status));

/** Match the queue's precedence tiers; clock order alone cannot order native inputs. */
export const blockedByEarlierAttendance = (row, rows = []) => ["pending", "blocked"].includes(row.status) &&
  rows.some(earlier => {
    if (earlier.id === row.id || earlier.employeeId !== row.employeeId ||
      (earlier.tenantKey && earlier.tenantKey !== row.tenantKey) || !requiresAttentionBeforeDelivery(earlier)) return false;
    if (!earlier.tenantKey && row.tenantKey) return true;
    if (row.sourceEventId) return !earlier.sourceEventId || earlier.id < row.id;
    if (earlier.sourceEventId) return false;
    return earlier.timestamp < row.timestamp || (earlier.timestamp === row.timestamp && earlier.id < row.id);
  });

/** Presentation only. Raw server diagnostics never become employee-facing copy. */
export const describeRecoveryRow = (row, { rows = [], deviceOnline = true } = {}) => {
  if (!row.tenantKey) return {
    category: "attention", label: "Cannot verify company", tone: "warning",
    explanation: "The original company and server outcome could not be verified. This attendance remains on this device and will not be resent automatically. Contact your administrator.",
  };
  if (row.status === "cancelled" && row.verificationIssue === "known-not-inserted") return {
    category: "attention", label: "Not submitted", tone: "warning",
    explanation: "This automatic attendance request was refused before insertion. Its receipt is retained and will not be resent automatically. Check your attendance with your administrator if needed.",
  };
  if (row.verificationIssue) return {
    category: "attention", label: "Needs review", tone: "warning",
    explanation: "The last server check could not verify an exact attendance log. This does not prove it is missing. Nothing was resent; ask your administrator to investigate.",
  };
  if (row.verifiedAt) return {
    category: "success", label: "Verified on server", tone: "success",
    explanation: "An attendance log with this worker, time and punch type was found on the server.",
    photoNote: row.payload?.photoUri ? "Photo recovery has not been verified." : null,
  };
  if (row.status === "needs_review" ||
    !["pending", "syncing", "blocked", "rejected", "resolved", "synced"].includes(row.status) ||
    (row.status === "synced" && !row.acceptanceConfirmed)) return {
    category: "attention", label: "Needs review", tone: "warning",
    explanation: row.duplicate
      ? "The server reported a duplicate, but the matching attendance has not been verified. Check the server record before recovery."
      : "This saved record has no verified server outcome. Check the server record or ask your administrator to investigate. It will not be resent automatically.",
  };
  if (row.status === "synced") return {
    category: "success", label: row.duplicate ? "Already recorded" : "Synced", tone: "success",
    explanation: row.photoStatus === "not-uploaded"
      ? "Attendance synced, but the photo could not be uploaded."
      : row.duplicate ? "This attendance was already recorded on the server."
        : "Synced successfully.",
    photoNote: row.payload?.photoUri && !row.photoStatus
      ? "Attendance is recorded. Photo recovery could not be confirmed." : null,
  };
  if (row.status === "rejected" || row.status === "resolved") return {
    category: "attention", label: row.status === "resolved" ? "Correction submitted" : "Needs attention", tone: "warning",
    explanation: row.status === "resolved" ? "A correction request was submitted. Its approval and the server attendance still need to be checked. This punch will not be retried."
      : row.failureClass === "dependent"
        ? "The paired attendance was rejected, so this record was held back. Both records remain saved for administrator review."
        : "The server rejected this attendance. It remains on this device and may require administrator attention.",
  };
  if (row.status === "syncing") return {
    category: "syncing", label: "Syncing", tone: "info",
    explanation: "Syncing attendance records… This attendance remains saved on this device until its outcome is confirmed.",
  };
  if (blockedByEarlierAttendance(row, rows)) return {
    category: "waiting", label: "Blocked by earlier attendance", tone: "warning",
    explanation: "A previous attendance record needs attention before newer records can sync. This record remains saved on this device.",
  };
  if (row.uploadAttemptAt) return {
    category: "waiting", label: "Checking server outcome", tone: "warning",
    explanation: "An earlier upload may have reached the server. Only server verification is retried; this attendance will not be resent automatically.",
  };
  const availability = instanceState(row);
  if (row.status === "pending" && (!deviceOnline || availability === "device_offline")) return {
    category: "waiting", label: "Saved offline", tone: "info",
    explanation: "Attendance saved on this device. Synchronization can resume when your connection and company server are available.",
  };
  if (row.status === "pending" && ["instance_unreachable", "server_unavailable"].includes(availability)) return {
    category: "waiting", label: "Server unavailable", tone: "info",
    explanation: "Unable to connect to your company's server. Your attendance is saved and will be retried when synchronization runs.",
  };
  const explanations = {
    auth: "Sign in again if needed, then retry. This attendance is still saved on this device.",
    "endpoint-missing": "Your administrator may need to enable attendance synchronization. This attendance is still saved on this device.",
    configuration: "The server could not accept this attendance yet. This attendance is still saved on this device.",
  };
  if (availability === "endpoint_unsupported") return {
    category: "waiting", label: "Server compatibility needs attention", tone: "warning",
    explanation: "Your company's server did not support the availability check. This attendance remains saved; ask your administrator to check compatibility.",
  };
  return {
    category: "waiting", label: row.status === "pending" && !row.retryCount ? "Saved on device" : "Waiting to retry", tone: "info",
    explanation: row.outcome === "scope-changed"
      ? "Sync stopped because your account/session changed. Your attendance is still saved on this device."
      : explanations[row.failureClass] || (row.retryCount > 0
        ? "Could not reach the server. This attendance is still saved on this device."
        : "This attendance is still saved on this device and is waiting to be sent."),
  };
};

export const canVerifyRecoveryRow = (row) => !!row.tenantKey &&
  !["pending", "syncing", "blocked"].includes(row.status) &&
  !(row.status === "cancelled" && row.verificationIssue === "known-not-inserted");

const NONBLOCKING_REVIEW_REASONS = new Set([
  "native-capture-issue", "native-provenance-missing", "legacy-event-identity",
  "invalid-native-event", "native-configuration-mismatch", "native-provenance-mismatch", "stale-native-configuration",
]);

export const describeAutomaticRecoveryEvent = (event, { events = [], deviceOnline = true } = {}) => {
  if (event.status === "needs_review") return {
    label: "Needs review",
    explanation: event.onlineAttemptAt
      ? "This attendance upload could not be confirmed. Server verification or administrator assistance may be required. It will not be resent automatically."
      : "This saved transition needs administrator review. It has not been confirmed as attendance and will not be resent automatically.",
  };
  const held = events.some(earlier => earlier.eventId !== event.eventId && earlier.tenantKey === event.tenantKey &&
    earlier.employeeId === event.employeeId && earlier.status === "needs_review" &&
    !NONBLOCKING_REVIEW_REASONS.has(earlier.reason) &&
    ((earlier.sequence ?? -1) < (event.sequence ?? -1) ||
      ((earlier.sequence ?? -1) === (event.sequence ?? -1) && (earlier.receivedAt < event.receivedAt ||
        (earlier.receivedAt === event.receivedAt && earlier.eventId < event.eventId)))));
  if (held) return {
    label: "Blocked by earlier attendance",
    explanation: "A previous attendance record needs attention before this transition can be processed. Its original data remains saved.",
  };
  if (event.onlineAttemptAt) return {
    label: "Checking server outcome",
    explanation: "A server request may have completed. Only server verification is retried; this transition will not be resent automatically.",
  };
  if (event.reason === "instance-authentication-required") return {
    label: "Waiting for sign-in",
    explanation: "Sign in again if needed. This transition remains saved and has not been confirmed as attendance.",
  };
  if (["instance-configuration-error", "instance-endpoint-unsupported"].includes(event.reason)) return {
    label: "Server compatibility needs attention",
    explanation: "Your company's server could not complete the availability check. This transition remains saved; ask your administrator to check compatibility.",
  };
  return {
    label: deviceOnline ? "Saved transition" : "Saved offline",
    explanation: "This transition has not been accepted as attendance. Its original data remains saved for later processing when the required connection and settings are available.",
  };
};

export const summarizeRecoveryRows = (rows, context = {}) => {
  const counts = { success: 0, waiting: 0, attention: 0, syncing: 0 };
  rows.forEach(row => { counts[describeRecoveryRow(row, { ...context, rows }).category] += 1; });
  return `${counts.success} synced · ${counts.waiting} waiting · ${counts.attention} needs attention${counts.syncing ? ` · ${counts.syncing} syncing` : ""}`;
};
