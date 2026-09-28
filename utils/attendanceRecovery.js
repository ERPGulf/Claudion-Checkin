/** Presentation only. Raw server diagnostics never become employee-facing copy. */
export const describeRecoveryRow = (row) => {
  if (!row.tenantKey) return {
    category: "attention", label: "Cannot verify company", tone: "warning",
    explanation: "The original company and server outcome could not be verified. This attendance remains on this device and will not be resent automatically. Contact your administrator.",
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
    explanation: "This attendance is saved on this device while synchronization is in progress.",
  };
  const explanations = {
    auth: "Sign in again if needed, then retry. This attendance is still saved on this device.",
    "endpoint-missing": "Your administrator may need to enable attendance synchronization. This attendance is still saved on this device.",
    configuration: "The server could not accept this attendance yet. This attendance is still saved on this device.",
  };
  return {
    category: "waiting", label: "Waiting to retry", tone: "info",
    explanation: row.outcome === "scope-changed"
      ? "Sync stopped because your account/session changed. Your attendance is still saved on this device."
      : explanations[row.failureClass] || (row.retryCount > 0
        ? "Could not reach the server. This attendance is still saved on this device."
        : "This attendance is still saved on this device and is waiting to be sent."),
  };
};

export const canVerifyRecoveryRow = (row) => !!row.tenantKey &&
  !["pending", "syncing", "blocked"].includes(row.status);

export const summarizeRecoveryRows = (rows) => {
  const counts = { success: 0, waiting: 0, attention: 0, syncing: 0 };
  rows.forEach(row => { counts[describeRecoveryRow(row).category] += 1; });
  return `${counts.success} synced · ${counts.waiting} waiting to retry · ${counts.attention} needs attention${counts.syncing ? ` · ${counts.syncing} syncing` : ""}`;
};
