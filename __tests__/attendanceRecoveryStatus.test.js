import {
  blockedByEarlierAttendance, canVerifyRecoveryRow, describeAutomaticRecoveryEvent, describeRecoveryRow,
} from "../utils/attendanceRecovery";

const row = (changes = {}) => ({ id: 1, employeeId: "TEST-EMPLOYEE", tenantKey: "https://example.test:8443",
  status: "pending", timestamp: "2026-10-27 09:59:46", retryCount: 0, ...changes });

it("distinguishes safely saved work from unavailable-server and uncertain-upload evidence", () => {
  expect(describeRecoveryRow(row()).label).toBe("Saved on device");
  expect(describeRecoveryRow(row(), { deviceOnline: false }).label).toBe("Saved offline");
  for (const error of ["instance_unreachable", "server_unavailable"]) {
    expect(describeRecoveryRow(row({ error })).label).toBe("Server unavailable");
  }
  expect(describeRecoveryRow(row({ uploadAttemptAt: 1000, error: "instance_unreachable" }))).toMatchObject({
    label: "Checking server outcome", explanation: expect.stringContaining("will not be resent automatically"),
  });
  expect(describeRecoveryRow(row({ status: "syncing" })).label).toBe("Syncing");
  expect(describeRecoveryRow(row({ status: "synced", acceptanceConfirmed: 1 })).label).toBe("Synced");
  expect(describeRecoveryRow(row({ status: "synced", acceptanceConfirmed: 0 })).label).toBe("Needs review");
});

it("does not call an unsupported health endpoint an offline device", () => {
  expect(describeRecoveryRow(row({ status: "blocked", failureClass: "configuration", error: "endpoint_unsupported" }))).toMatchObject({
    label: "Server compatibility needs attention", explanation: expect.stringContaining("check compatibility"),
  });
});

it("retains a known-refused legacy dispatch receipt without promising upload or verification", () => {
  const receipt = row({ status: "cancelled", failureClass: "auth", verificationIssue: "known-not-inserted" });
  expect(describeRecoveryRow(receipt)).toMatchObject({ label: "Not submitted", explanation: expect.stringContaining("will not be resent automatically") });
  expect(canVerifyRecoveryRow(receipt)).toBe(false);
  expect(blockedByEarlierAttendance(row({ id: 2 }), [receipt])).toBe(false);
  const historical = row({ status: "cancelled" });
  expect(describeRecoveryRow(historical).label).toBe("Needs review");
  expect(canVerifyRecoveryRow(historical)).toBe(true);
});

it("shows the incident-shaped later pending ENTER held behind a review EXIT without promising automatic send", () => {
  const earlier = row({ action: "checkout", status: "needs_review" });
  const later = row({ id: 2, action: "checkin", timestamp: "2026-10-27 10:05:21" });
  expect(describeRecoveryRow(later, { rows: [earlier, later] })).toMatchObject({
    label: "Blocked by earlier attendance", explanation: expect.stringContaining("previous attendance record needs attention"),
  });
});

it("uses native insertion precedence after a clock correction and keeps historical precedence", () => {
  const native = row({ id: 2, sourceEventId: "native-2" });
  const earlierNative = row({ id: 1, sourceEventId: "native-1", timestamp: "2026-10-27 12:00:00", status: "needs_review" });
  expect(blockedByEarlierAttendance(native, [earlierNative])).toBe(true);
  const historical = row({ id: 3, timestamp: "2026-10-27 13:00:00", status: "needs_review" });
  expect(blockedByEarlierAttendance(native, [historical])).toBe(true);
  expect(blockedByEarlierAttendance(row({ id: 4 }), [earlierNative])).toBe(false);
});

it("does not infer blockers from another tenant, another employee, rejected work or ordinary FIFO waiting", () => {
  const candidate = row({ id: 2 });
  for (const changes of [
    { tenantKey: "https://another.example.test" }, { employeeId: "SOMEONE-ELSE" },
    { status: "rejected" }, { status: "resolved" }, { status: "synced", acceptanceConfirmed: 1 },
    { status: "pending" }, { status: "blocked", failureClass: "endpoint-missing" },
  ]) expect(blockedByEarlierAttendance(candidate, [row({ status: "needs_review", ...changes })])).toBe(false);
  expect(blockedByEarlierAttendance(candidate, [row({ status: "needs_review", tenantKey: null })])).toBe(true);
});

it("keeps automatic receipt review and verification separate from safely pending transitions", () => {
  const event = { eventId: "native-1", tenantKey: "https://example.test", employeeId: "TEST-EMPLOYEE", sequence: 1, receivedAt: 1000 };
  expect(describeAutomaticRecoveryEvent({ ...event, status: "pending" }).label).toBe("Saved transition");
  expect(describeAutomaticRecoveryEvent({ ...event, status: "pending" }, { deviceOnline: false }).label).toBe("Saved offline");
  expect(describeAutomaticRecoveryEvent({ ...event, status: "processing", onlineAttemptAt: 1000 })).toMatchObject({
    label: "Checking server outcome", explanation: expect.stringContaining("will not be resent automatically"),
  });
  const earlier = { ...event, status: "needs_review", onlineAttemptAt: 1000 };
  expect(describeAutomaticRecoveryEvent(earlier).label).toBe("Needs review");
  expect(describeAutomaticRecoveryEvent({ ...event, eventId: "native-2", sequence: 2, status: "pending" }, { events: [earlier] }).label)
    .toBe("Blocked by earlier attendance");
  expect(describeAutomaticRecoveryEvent({ ...event, status: "pending", reason: "instance-endpoint-unsupported" }).label)
    .toBe("Server compatibility needs attention");
});
