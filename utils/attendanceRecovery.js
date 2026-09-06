/** Presentation only. Raw server diagnostics never become employee-facing copy. */
export const describeRecoveryRow = (row) => {
  if (!row.tenantKey) return {
    category: "attention", label: "Cannot verify company", tone: "warning",
    explanation: "This attendance could not be safely matched to the current company. It was not uploaded. It remains on this device; contact your administrator.",
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
    category: "attention", label: row.status === "resolved" ? "Correction recorded" : "Needs attention", tone: "warning",
    explanation: row.status === "resolved" ? "An attendance correction has been recorded. This punch will not be retried."
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

export const summarizeRecoveryRows = (rows) => {
  const counts = { success: 0, waiting: 0, attention: 0, syncing: 0 };
  rows.forEach(row => { counts[describeRecoveryRow(row).category] += 1; });
  return `${counts.success} synced · ${counts.waiting} waiting to retry · ${counts.attention} needs attention${counts.syncing ? ` · ${counts.syncing} syncing` : ""}`;
};
