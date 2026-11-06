/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main", getPendingEvents: jest.fn(), acknowledgeEvent: jest.fn(),
  getLocationAccessState: jest.fn(),
}));
jest.mock("../services/api/attendance.service", () => ({
  autoCheckInOut: jest.fn(), getAttendanceStatus: jest.fn(), resolveServerTimestampAt: jest.fn(),
}));
jest.mock("../services/offline/NetworkListener", () => ({ fetchShouldAttemptRequest: jest.fn(), isOnline: jest.fn(() => true) }));
jest.mock("../services/offline/InstanceAvailabilityService", () => ({
  checkInstanceAvailability: jest.fn(), invalidateInstanceAvailability: jest.fn(),
}));
jest.mock("../services/offline/offlineAttendanceGate", () => ({ evaluateOfflineAttendance: jest.fn() }));
jest.mock("../services/offline/AttendanceVerification", () => ({
  ...jest.requireActual("../services/offline/AttendanceVerification"), verifyQueuedAttendance: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient from "../services/api/apiClient";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import * as Native from "../modules/expo-auto-attendance";
import * as Events from "../services/offline/AutoAttendanceEventRepository";
import { drainAutoAttendanceEvents, ingestPendingNativeEvents, verifyAutoAttendanceEvent } from "../services/offline/AutoAttendanceEventProcessor";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { resetDatabaseHandle, getDatabase } from "../services/offline/AttendanceDatabase";
import { enqueue, listAll } from "../services/offline/AttendanceQueueRepository";
import { autoCheckInOut, getAttendanceStatus, resolveServerTimestampAt } from "../services/api/attendance.service";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { checkInstanceAvailability } from "../services/offline/InstanceAvailabilityService";
import { evaluateOfflineAttendance } from "../services/offline/offlineAttendanceGate";
import { verifyQueuedAttendance } from "../services/offline/AttendanceVerification";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { applySessionOwner, performSessionTransition, readSession, reconcileSessionFromServer, SESSION_ORIGIN } from "../utils/attendanceSessionState";
import { rememberServerOffset } from "../utils/serverClock";
import { createRegistrationId } from "../utils/autoAttendanceRegistration";
import { store } from "../redux/Store";
import { settingsReceived, settingsInvalidated } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-001";
const started = Date.now() - 3600000;
let scope;
let journal;
let config;
const wallClock = at => new Date(at).toISOString().slice(0, 19).replace("T", " ");
const event = (eventId, sequence, transition = "ENTER", overrides = {}) => {
  const snapshot = { tenantKey: TEST_TENANT, employeeId, latitude: 25.28, longitude: 51.52, radius: 100, geotagging: 2 };
  const result = { ...snapshot, eventId, sequence, transition, identifier: "office-main", nativeIdentifier: "physical-1",
    registrationGeneration: "registration-1",
    registrationId: createRegistrationId(snapshot), timestamp: started + sequence * 1000, ...overrides };
  result.registrationId = overrides.registrationId ?? createRegistrationId(result);
  return result;
};
const drain = () => drainAutoAttendanceEvents({ scope });
const receiveMode = async mode => receiveEmployeeAutoAttendancePolicy({ geotagging: mode },
  beginEmployeeAutoAttendancePolicyReception(scope));

beforeEach(async () => {
  store.dispatch(settingsInvalidated());
  receiveAutomaticAvailability(true);
  __resetAll(); resetDatabaseHandle(); resetOfflineCapability();
  await AsyncStorage.clear();
  await loginQueueEmployee(employeeId);
  scope = await captureAttendanceQueueScope(employeeId);
  await applySessionOwner(employeeId, { tenantKey: TEST_TENANT });
  config = { employeeId, tenantKey: TEST_TENANT, employeeDocname: "HR-EMP-001", locations: [], rules: { geotagging: 2 } };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  journal = [];
  jest.clearAllMocks();
  Native.getPendingEvents.mockImplementation(() => [...journal]);
  Native.getLocationAccessState.mockReturnValue({ state: "confirmed_available", registrationGeneration: "registration-1" });
  Native.acknowledgeEvent.mockImplementation(id => { journal = journal.filter(item => item.eventId !== id); return true; });
  fetchShouldAttemptRequest.mockResolvedValue(true);
  checkInstanceAvailability.mockImplementation(async () => await fetchShouldAttemptRequest()
    ? { status: "available", serverTime: wallClock(Date.now()), observedAt: Date.now() }
    : { status: "device_offline" });
  resolveServerTimestampAt.mockImplementation(async at => wallClock(at));
  autoCheckInOut.mockResolvedValue({ allowed: true, name: "SERVER-1" });
  getAttendanceStatus.mockResolvedValue({ custom_in: 0 });
  evaluateOfflineAttendance.mockResolvedValue({ allowed: true, coords: null, location: null, config });
  verifyQueuedAttendance.mockResolvedValue({ verified: false, reason: "no-exact-match-in-visible-history" });
  await receiveMode(2);
});

// The tenant's automatic-attendance switch, `attendance_action.geo_tagging`.
const receiveAutomaticAvailability = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeId),
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: value } }),
}));

it.each(["ENTER", "EXIT"])("retains a background %s receipt without a new punch under tenant geo_tagging false / employee mode 2", async transition => {
  receiveAutomaticAvailability(false);
  const source = event(`tenant-geo-${transition}`, 1, transition);
  journal = [source];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "pending", reason: "capability-disabled" });
});

it("rechecks tenant geo_tagging false received during a pending event server-clock request", async () => {
  resolveServerTimestampAt.mockImplementationOnce(async at => {
    receiveAutomaticAvailability(false);
    return wallClock(at);
  });
  journal = [event("tenant-geo-clock", 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent("tenant-geo-clock"))
    .toMatchObject({ status: "pending", reason: "capability-disabled", onlineAttemptAt: null });
});

it("does not adopt another tenant's geo authorization for an event pending during tenant switching", async () => {
  const nextTenant = "https://next-synthetic.example.test";
  resolveServerTimestampAt.mockImplementationOnce(async at => {
    receiveAutomaticAvailability(false);
    await loginQueueEmployee(employeeId, nextTenant);
    store.dispatch(settingsReceived({ scope: buildSettingsScope(nextTenant, employeeId),
      settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true } }) }));
    const nextScope = await captureAttendanceQueueScope(employeeId);
    await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(nextScope));
    return wallClock(at);
  });
  journal = [event("tenant-geo-switch", 1)];
  await expect(drain()).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent("tenant-geo-switch"))
    .toMatchObject({ tenantKey: TEST_TENANT, onlineAttemptAt: null });
});

it("recovers an accepted source event after tenant geo is disabled", async () => {
  const source = event("accepted-before-tenant-geo", 1);
  await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin",
    timestamp: wallClock(source.timestamp), sourceEventId: source.eventId });
  receiveAutomaticAvailability(false);
  journal = [source];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toHaveLength(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "handled" });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: source.eventId });
});

it("retains native receipts without creating punches when automatic attendance is disabled", async () => {
  receiveAutomaticAvailability(false);
  journal = [event("disabled", 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent("disabled")).toMatchObject({ status: "pending", reason: "capability-disabled" });
  receiveAutomaticAvailability(true);
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it("rechecks a received automatic denial during timestamp resolution", async () => {
  resolveServerTimestampAt.mockImplementation(async at => {
    receiveAutomaticAvailability(false);
    return wallClock(at);
  });
  journal = [event("revoked-during-action", 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect((await Events.findEvent("revoked-during-action")).status).toBe("pending");
});

it.each([0, 1])("retains new native attendance when employee mode is %s, then accepts a legitimate re-enable", async mode => {
  await receiveMode(mode);
  journal = [event(`employee-mode-${mode}`, 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent(`employee-mode-${mode}`))
    .toMatchObject({ status: "pending", reason: "employee-policy-disabled" });
  await receiveMode(2);
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it.each([0, 1])("rechecks employee mode %s received during pending server-clock work", async mode => {
  resolveServerTimestampAt.mockImplementation(async at => {
    await receiveMode(mode);
    return wallClock(at);
  });
  journal = [event(`employee-clock-${mode}`, 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent(`employee-clock-${mode}`))
    .toMatchObject({ status: "pending", reason: "employee-policy-disabled", onlineAttemptAt: null });
});

it("does not let an older cached mode 0 override a newly received employee mode 2", async () => {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, rules: { geotagging: 0 } }));
  await receiveMode(2);
  journal = [event("new-employee-response", 1)];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it("recovers an already accepted source queue row after employee mode is revoked", async () => {
  const source = event("accepted-before-revocation", 1);
  await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin",
    timestamp: wallClock(source.timestamp), sourceEventId: source.eventId });
  await receiveMode(0);
  journal = [source];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toHaveLength(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "handled" });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: source.eventId });
});

it("retains a local service denial without requiring evidence for a request never dispatched", async () => {
  const refusal = Object.assign(new Error("Feature disabled"), { code: "FEATURE_DISABLED" });
  autoCheckInOut.mockResolvedValueOnce({ allowed: false, error: refusal });
  journal = [event("refused-before-transport", 1)];
  await drain();
  expect(await Events.findEvent("refused-before-transport"))
    .toMatchObject({ status: "pending", onlineAttemptAt: null, reason: "capability-disabled" });
  expect(await listAll()).toEqual([]);
  await drain();
  expect((await Events.findEvent("refused-before-transport")).status).toBe("handled");
});

it("valid ENTER and repeated ENTER create exactly one IN", async () => {
  journal = [event("enter-1", 1), event("enter-2", 2)];
  await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN"]);
  expect((await readSession()).status).toBe("CHECKED_IN");
  expect((await Events.findEvent("enter-2")).status).toBe("handled");
});

it("valid EXIT and repeated EXIT create exactly one OUT with the captured timestamp", async () => {
  journal = [event("enter", 1), event("exit", 2, "EXIT"), event("exit-repeat", 3, "EXIT")];
  await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT"]);
  expect(autoCheckInOut.mock.calls[1][0]).toMatchObject({ occurredAt: started + 2000, timestamp: wallClock(started + 2000) });
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("retains and queues offline ENTER/EXIT in order without native overwrite", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  journal = [event("enter", 1), event("exit", 2, "EXIT")];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await listAll()).sort((a, b) => a.id - b.id).map(row => [row.action, row.sourceEventId])).toEqual([["checkin", "enter"], ["checkout", "exit"]]);
  expect(journal).toEqual([]);
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("queues both firewall-blocked crossings without online or upload dispatch evidence", async () => {
  checkInstanceAvailability.mockResolvedValue({ status: "instance_unreachable", failureCategory: "timeout" });
  journal = [event("firewall-enter", 1), event("firewall-exit", 2, "EXIT")];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(resolveServerTimestampAt).not.toHaveBeenCalled();
  expect((await listAll()).sort((a, b) => a.id - b.id).map(row => [row.action, row.uploadAttemptAt]))
    .toEqual([["checkin", null], ["checkout", null]]);
  expect(await Events.findEvent("firewall-enter")).toMatchObject({ status: "handled", onlineAttemptAt: null, outcome: { queued: true } });
  expect(await Events.findEvent("firewall-exit")).toMatchObject({ status: "handled", onlineAttemptAt: null, outcome: { queued: true } });
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "AUTO" });
});

it("checks the instance again before dispatch when a prior safe attempt froze the timestamp", async () => {
  const source = event("frozen", 1);
  await Events.ingestNativeEvent(source);
  await Events.updateEvent(source.eventId, { punchTimestamp: wallClock(source.timestamp) });
  checkInstanceAvailability.mockResolvedValue({ status: "instance_unreachable" });
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await listAll())[0]).toMatchObject({ timestamp: wallClock(source.timestamp), uploadAttemptAt: null });
  expect(await Events.findEvent(source.eventId)).toMatchObject({ onlineAttemptAt: null, status: "handled" });
});

it("retains an explicit authentication refusal without an attendance dispatch marker", async () => {
  checkInstanceAvailability.mockResolvedValue({ status: "authentication_required", httpStatus: 403 });
  journal = [event("auth-required", 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent("auth-required")).toMatchObject({ status: "pending",
    reason: "instance-authentication-required", onlineAttemptAt: null });
});

it("does not dispatch or enqueue into a new account when ownership changes during the health read", async () => {
  checkInstanceAvailability.mockImplementationOnce(async () => {
    await loginQueueEmployee("EMP-OTHER");
    return { status: "available", serverTime: wallClock(Date.now()), observedAt: Date.now() };
  });
  journal = [event("health-scope-change", 1)];
  await expect(drain()).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(await Events.findEvent("health-scope-change")).toMatchObject({ tenantKey: TEST_TENANT,
    employeeId, status: "processing", onlineAttemptAt: null });
});

it("online OUT remains behind an earlier queued IN when the app reopens", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  journal = [event("enter", 1)]; await drain();
  resetDatabaseHandle();
  fetchShouldAttemptRequest.mockResolvedValue(true);
  journal = [event("exit", 2, "EXIT")]; await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await listAll()).sort((a, b) => a.id - b.id).map(row => row.action)).toEqual(["checkin", "checkout"]);
});

it("online ENTER then offline EXIT: the check-out is kept locally and delivered exactly once", async () => {
  journal = [event("enter", 1)]; await drain();
  expect(await Events.findEvent("enter")).toMatchObject({ status: "handled" });
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN"]);

  fetchShouldAttemptRequest.mockResolvedValue(false);
  journal = [event("exit", 2, "EXIT")]; await drain();
  expect(journal).toEqual([]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "AUTO" });
  const [queued] = await listAll();
  expect(queued).toMatchObject({ action: "checkout", sourceEventId: "exit", status: "pending" });
  // Saved at the crossing (device clock, local wall time), not at upload.
  expect(new Date(queued.timestamp.replace(" ", "T")).getTime()).toBe(Math.floor((started + 2000) / 1000) * 1000);

  fetchShouldAttemptRequest.mockResolvedValue(true);
  resetSyncService();
  const http = new MockAdapter(apiClient);
  http.onPost(/add_offline_employee_checkins/).reply(200, { message: { inserted: ["SERVER-OUT"], failed: [] } });
  try {
    await syncPendingAttendance({ employeeId, wakeAllPending: true });
    await syncPendingAttendance({ employeeId, wakeAllPending: true });
    expect(http.history.post).toHaveLength(1);
    expect((await listAll())[0]).toMatchObject({ status: "synced", serverCheckinId: "SERVER-OUT", acceptanceConfirmed: 1 });
    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  } finally {
    http.restore(); resetSyncService();
  }
});

it("does not submit an orphan OUT after the queued IN was rejected", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  journal = [event("enter", 1)]; await drain();
  const parent = (await listAll())[0];
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: "enter" });
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET status = ? WHERE id = ?;", ["rejected", parent.id]);
  resetDatabaseHandle();
  fetchShouldAttemptRequest.mockResolvedValue(true);
  journal = [event("exit", 2, "EXIT")]; await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.findEvent("exit")).toMatchObject({ status: "needs_review", reason: "source-parent-needs-review" });
  expect((await readSession()).status).toBe("CHECKED_IN");
  expect(await listAll()).toHaveLength(1);
});

it("manual check-in followed by auto EXIT closes the shared manual session", async () => {
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.MANUAL, at: started,
    execute: async () => ({ allowed: true }) });
  journal = [event("exit", 1, "EXIT")]; await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["OUT"]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", origin: "MANUAL", closedBy: "AUTO" });
});

it("auto check-in followed by manual checkout makes subsequent EXIT a no-op", async () => {
  journal = [event("enter", 1)]; await drain();
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: started + 1500,
    execute: async () => ({ allowed: true }) });
  journal = [event("exit", 2, "EXIT")]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it("processes rapid boundary transitions once in native sequence", async () => {
  journal = [event("third", 3), event("first", 1), event("second", 2, "EXIT"), event("fourth", 4, "EXIT")];
  await Promise.all([drain(), drain(), drain()]);
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT", "IN", "OUT"]);
});

it("does not acknowledge native events when durable SQLite insertion fails", async () => {
  journal = [event("enter", 1)];
  const db = await getDatabase();
  const write = jest.spyOn(db, "runAsync").mockRejectedValueOnce(new Error("Disk full"));
  await expect(ingestPendingNativeEvents()).rejects.toThrow("Disk full");
  expect(Native.acknowledgeEvent).not.toHaveBeenCalled();
  expect(journal).toHaveLength(1);
  write.mockRestore();
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it("survives interruption after SQLite insert but before the native acknowledgment", async () => {
  const source = event("crash-after-insert", 1);
  journal = [source];
  const db = await getDatabase();
  const read = jest.spyOn(db, "getFirstAsync").mockRejectedValueOnce(new Error("Interrupted after committed insert"));
  await expect(ingestPendingNativeEvents()).rejects.toThrow("Interrupted after committed insert");
  expect(Native.acknowledgeEvent).not.toHaveBeenCalled();
  expect(journal).toEqual([source]);
  read.mockRestore();
  resetDatabaseHandle();

  const preserved = await Events.findEvent(source.eventId);
  expect(preserved).toMatchObject({ status: "pending", event: source });
  await drain();
  await drain();
  expect(journal).toEqual([]);
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "handled", event: source });
});

it("survives interruption after native acknowledgment with only SQLite holding the receipt", async () => {
  const source = event("crash-after-ack", 1);
  journal = [source];
  Native.acknowledgeEvent.mockImplementationOnce(id => {
    journal = journal.filter(item => item.eventId !== id);
    throw new Error("Interrupted after durable native acknowledgment");
  });
  await ingestPendingNativeEvents();
  expect(journal).toEqual([]);
  expect(autoCheckInOut).not.toHaveBeenCalled();
  resetDatabaseHandle();

  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "pending", event: source });
  await drain();
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "handled", event: source });
});

it("concurrent native ingress cannot admit multiple receipts or reset a settled outcome", async () => {
  const source = event("concurrent-ingress", 1);
  journal = [source];
  await Promise.all([ingestPendingNativeEvents(), ingestPendingNativeEvents(), ingestPendingNativeEvents()]);
  const db = await getDatabase();
  expect(await db.getAllAsync("SELECT eventId FROM auto_attendance_events WHERE eventId = ?;", [source.eventId]))
    .toEqual([{ eventId: source.eventId }]);
  await drain();
  const settled = await Events.findEvent(source.eventId);
  journal = [source];
  await Promise.all([ingestPendingNativeEvents(), ingestPendingNativeEvents()]);
  expect(await Events.findEvent(source.eventId)).toEqual(settled);
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it("native ack failure and repeated delivery cannot reset an earlier outcome", async () => {
  Native.acknowledgeEvent.mockReturnValue(false);
  journal = [event("enter", 1)];
  await drain(); await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect((await Events.findEvent("enter")).status).toBe("handled");
});

it("a throwing native ack retains native evidence and still processes the committed receipt", async () => {
  Native.acknowledgeEvent.mockImplementation(() => { throw new Error("Native disk error"); });
  journal = [event("enter", 1)]; await drain(); await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(journal).toHaveLength(1);
});

it("same-second distinct IN events need review rather than duplicate server attendance", async () => {
  const base = Math.floor(started / 1000) * 1000;
  journal = [event("in-1", 1, "ENTER", { timestamp: base + 100 }),
    event("out-1", 2, "EXIT", { timestamp: base + 200 }),
    event("in-2", 3, "ENTER", { timestamp: base + 300 }),
    event("out-2", 4, "EXIT", { timestamp: base + 400 })];
  await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT"]);
  expect(await Events.findEvent("in-2")).toMatchObject({ status: "needs_review", reason: "source-event-collision" });
  expect((await Events.findEvent("out-2")).status).toBe("pending");
});

it("tenant switching never processes another tenant's captured event", async () => {
  journal = [event("foreign", 1, "ENTER", { tenantKey: "https://other.example.com" }), event("mine", 2)];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect((await Events.findEvent("foreign")).status).toBe("pending");
});

it("logout during HTTP submission cannot commit into the next account session", async () => {
  autoCheckInOut.mockImplementation(async () => { await loginQueueEmployee("EMP-OTHER"); return { allowed: true, name: "OLD-SERVER" }; });
  journal = [event("enter", 1)];
  await expect(drain()).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect(await Events.findEvent("enter")).toMatchObject({ status: "processing", onlineAttemptAt: expect.any(Number) });
});

it("warnings-only native events never create attendance", async () => {
  journal = [event("warning", 1, "ENTER", { geotagging: 1 })]; await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.findEvent("warning")).toMatchObject({ status: "handled", reason: "warnings-only" });
});

it("unknown legacy ownership is retained for review without a punch", async () => {
  journal = [{ identifier: "office-main", transition: "ENTER", timestamp: started }]; await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.countReviewEvents(scope)).toBe(1);
});

it("an interrupted POST requires positive server evidence before session recovery", async () => {
  await Events.ingestNativeEvent(event("enter", 1));
  await Events.claimEvent("enter", { ownerId: "crashed", now: Date.now() - 200000 });
  await Events.updateEvent("enter", { onlineAttemptAt: started, punchTimestamp: wallClock(started + 1000) });
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "EXISTING-SERVER" } });
  resetDatabaseHandle(); await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await readSession()).status).toBe("CHECKED_IN");
  expect((await Events.findEvent("enter")).outcome.serverConfirmed).toBe(true);
});

it("reconciles an uncertain dispatched event after tenant and employee revocation without sending another punch", async () => {
  const receipt = event("dispatched-before-revocation", 1);
  await Events.ingestNativeEvent(receipt);
  await Events.claimEvent(receipt.eventId, { ownerId: "crashed-background-worker", now: Date.now() - 200000 });
  await Events.updateEvent(receipt.eventId, { onlineAttemptAt: started, punchTimestamp: wallClock(receipt.timestamp) });
  receiveAutomaticAvailability(false);
  await receiveMode(0);
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "SYNTHETIC-EXISTING-SERVER" } });
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(1);
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.findEvent(receipt.eventId)).toMatchObject({ status: "handled", outcome: { serverConfirmed: true } });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", startedAt: receipt.timestamp });
});

it("uncertain interrupted IN is not resent and prevents its OUT from overtaking", async () => {
  await Events.ingestNativeEvent(event("enter", 1));
  await Events.claimEvent("enter", { ownerId: "crashed", now: Date.now() - 200000 });
  await Events.updateEvent("enter", { onlineAttemptAt: started, punchTimestamp: wallClock(started + 1000) });
  journal = [event("exit", 2, "EXIT")]; await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.findEvent("enter")).status).toBe("needs_review");
  expect((await Events.findEvent("exit")).status).toBe("pending");
});

it("does not steal another runtime's live claim before its POST evidence exists", async () => {
  await Events.ingestNativeEvent(event("enter", 1));
  await Events.claimEvent("enter", { ownerId: "other-runtime" });
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.findEvent("enter")).claimOwner).toBe("other-runtime");
});

it("expired claim without a POST can safely resume once after restart", async () => {
  await Events.ingestNativeEvent(event("enter", 1));
  await Events.claimEvent("enter", { ownerId: "crashed", now: Date.now() - 200000 });
  resetDatabaseHandle(); await drain(); await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
});

it.each([false, true])("reconciles a dispatched receipt after clock correction/reopen without another POST (verified %s)", async verified => {
  const source = event("rewound-dispatch", 1);
  const wrongNow = Date.now() + 6 * 60 * 60 * 1000;
  await Events.ingestNativeEvent(source);
  await Events.claimEvent(source.eventId, { ownerId: "before-clock-correction", now: wrongNow });
  await Events.updateClaimedEvent(source.eventId, "before-clock-correction", {
    onlineAttemptAt: wrongNow + 1, punchTimestamp: wallClock(source.timestamp),
  }, { now: wrongNow + 1 });
  verifyQueuedAttendance.mockResolvedValue(verified
    ? { verified: true, evidence: { name: "SYNTHETIC-PREVIOUSLY-ACCEPTED" } }
    : { verified: false, reason: "no-exact-match-in-visible-history" });
  resetDatabaseHandle();

  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({
    status: verified ? "handled" : "needs_review", onlineAttemptAt: wrongNow + 1,
    punchTimestamp: wallClock(source.timestamp), event: source,
  });
  expect((await readSession()).status).toBe(verified ? "CHECKED_IN" : "CHECKED_OUT");
});

it("resumes a never-dispatched receipt after clock correction/reopen at most once", async () => {
  const source = event("rewound-before-dispatch", 1);
  await Events.ingestNativeEvent(source);
  await Events.claimEvent(source.eventId, { ownerId: "before-clock-correction", now: Date.now() + 21600000 });
  resetDatabaseHandle();
  await Promise.all([drain(), drain(), drain()]);
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(await Events.findEvent(source.eventId)).toMatchObject({ status: "handled", event: source });
});

it("a rejected source queue row is never treated as an accepted IN", async () => {
  await Events.ingestNativeEvent(event("enter", 1));
  const { row } = await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin",
    sourceEventId: "enter", timestamp: wallClock(started + 1000) });
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET status = ? WHERE id = ?;", ["rejected", row.id]);
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect((await Events.findEvent("enter")).reason).toBe("source-event-needs-review");
});

it("review verification needs positive history evidence and never sends attendance", async () => {
  await Events.ingestNativeEvent(event("uncertain", 1));
  await Events.updateEvent("uncertain", { status: "needs_review", onlineAttemptAt: started,
    punchTimestamp: wallClock(started + 1000) });
  expect((await verifyAutoAttendanceEvent({ eventId: "uncertain", employeeId })).verified).toBe(false);
  expect((await Events.findEvent("uncertain")).status).toBe("needs_review");
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "SERVER-FOUND" } });
  expect((await verifyAutoAttendanceEvent({ eventId: "uncertain", employeeId })).verified).toBe(true);
  expect((await Events.findEvent("uncertain")).status).toBe("pending");
  expect(autoCheckInOut).not.toHaveBeenCalled();
});

it("automatically rechecks review receipts with bounded history reads and never resends their POST", async () => {
  await Events.ingestNativeEvent(event("review-retry", 1));
  await Events.updateEvent("review-retry", { status: "needs_review", onlineAttemptAt: started,
    punchTimestamp: wallClock(started + 1000), reason: "server-unavailable" }, { now: Date.now() - 61000 });
  verifyQueuedAttendance.mockResolvedValue({ verified: false, reason: "server-unavailable" });
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(1);
  expect(await Events.findEvent("review-retry")).toMatchObject({ status: "needs_review", onlineAttemptAt: started,
    outcome: { lastVerifiedAt: expect.any(Number) } });
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(1);
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now + 61000);
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "REVIEW-FOUND" } });
  try {
    await drain();
    expect(verifyQueuedAttendance).toHaveBeenCalledTimes(2);
    expect(await Events.findEvent("review-retry")).toMatchObject({ status: "handled", onlineAttemptAt: started,
      outcome: { serverConfirmed: true } });
    expect(await readSession()).toMatchObject({ status: "CHECKED_IN" });
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(await listAll()).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});

it("does not strand review verification behind a check time left in the future by a clock correction", async () => {
  await Events.ingestNativeEvent(event("review-clock", 1));
  await Events.updateEvent("review-clock", { status: "needs_review", onlineAttemptAt: started,
    punchTimestamp: wallClock(started + 1000), reason: "server-unavailable" }, { now: Date.now() + 600000 });
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "FOUND-AFTER-CLOCK-CHANGE" } });
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(1);
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.findEvent("review-clock")).toMatchObject({ status: "handled", outcome: { serverConfirmed: true } });
});

it("bounds a review pass to five receipts and keeps later receipts for another pass", async () => {
  for (let sequence = 1; sequence <= 6; sequence += 1) {
    const source = event(`review-batch-${sequence}`, sequence);
    await Events.ingestNativeEvent(source);
    await Events.updateEvent(source.eventId, { status: "needs_review", onlineAttemptAt: started,
      punchTimestamp: wallClock(source.timestamp), reason: "no-exact-match-in-visible-history" }, { now: Date.now() - 61000 });
  }
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(5);
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.listReviewEvents(scope))).toHaveLength(6);
  await drain();
  expect(verifyQueuedAttendance).toHaveBeenCalledTimes(6);
});

it("invalid registration fingerprints are retained for review without attendance", async () => {
  journal = [event("bad-config", 1, "ENTER", { registrationId: "unknown-registration" })];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.findEvent("bad-config")).reason).toBe("native-configuration-mismatch");
});

it.each([
  ["string initial marker", { initialPresence: "true" }],
  ["numeric initial marker", { initialPresence: 1 }],
  ["null initial marker", { initialPresence: null }],
  ["missing registration start", { initialPresence: true }],
  ["string registration start", { initialPresence: true, registrationStartedAt: String(started) }],
  ["zero registration start", { initialPresence: true, registrationStartedAt: 0 }],
  ["negative registration start", { initialPresence: true, registrationStartedAt: -1 }],
  ["nonfinite registration start", { initialPresence: true, registrationStartedAt: Infinity }],
  ["registration after observation", { initialPresence: true, registrationStartedAt: started + 1001 }],
])("retains malformed %s for review and permits the next genuine ENTER", async (_description, metadata) => {
  journal = [event("malformed-initial", 1, "ENTER", metadata), event("genuine-enter", 2)];
  await drain();
  expect(await Events.findEvent("malformed-initial")).toMatchObject({
    status: "needs_review", reason: "invalid-native-event",
  });
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(autoCheckInOut.mock.calls[0][0]).toMatchObject({ type: "IN", occurredAt: started + 2000 });
  expect((await Events.findEvent("genuine-enter")).status).toBe("handled");
  expect(journal).toEqual([]);
});

it.each([
  ["initial observation", { initialPresence: true, registrationStartedAt: started + 1000 }],
  ["explicit genuine marker", { initialPresence: false }],
  ["older receipt without metadata", {}],
])("accepts valid %s without changing attendance contracts", async (_description, metadata) => {
  journal = [event("valid-enter", 1, "ENTER", metadata)];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect((await Events.findEvent("valid-enter")).status).toBe("handled");
  expect((await readSession()).status).toBe("CHECKED_IN");
});

it("late initial ENTER cannot reopen manual checkout and a subsequent genuine ENTER remains eligible", async () => {
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.MANUAL, at: started,
    execute: async () => ({ allowed: true }) });
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, at: started + 1000,
    execute: async () => ({ allowed: true }) });
  journal = [event("late-initial", 2, "ENTER", { initialPresence: true, registrationStartedAt: started - 1000 })];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect(await Events.findEvent("late-initial")).toMatchObject({ status: "handled",
    reason: "initial-presence-after-manual-checkout", outcome: { status: "skipped" } });
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "MANUAL", endedAt: started + 1000 });
  journal = [event("next-genuine-enter", 3)];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(autoCheckInOut.mock.calls[0][0]).toMatchObject({ type: "IN", occurredAt: started + 3000 });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", origin: "AUTO", sourceEventId: "next-genuine-enter" });
  expect(await listAll()).toEqual([]);
});

it("a callback from a removed office after configuration refresh cannot create attendance", async () => {
  config.lastUpdated = started;
  config.locations = [{ latitude: 26, longitude: 52, reporting_radius: 100 }];
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  journal = [event("removed-office", 1)];
  await drain();
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.findEvent("removed-office")).reason).toBe("stale-native-configuration");
});

it("a rejected stale registration receipt cannot suppress the next valid office ENTER", async () => {
  config.lastUpdated = started;
  config.locations = [{ latitude: 26, longitude: 52, reporting_radius: 100 }];
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  journal = [event("old-office", 1), event("new-office", 2, "ENTER", { latitude: 26, longitude: 52 })];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(autoCheckInOut.mock.calls[0][0].office.latitude).toBe(26);
  expect((await Events.findEvent("old-office")).status).toBe("needs_review");
  expect((await Events.findEvent("new-office")).status).toBe("handled");
});

const accessLoss = (overrides = {}) => event("access-loss", 2, null, {
  kind: "LOCATION_ACCESS_LOST", reason: "services-disabled", ...overrides,
});
const accessRecovery = (overrides = {}) => event("access-recovery", 3, null, {
  kind: "LOCATION_ACCESS_RECOVERED", lossEventId: "access-loss", presence: "inside",
  fixRequestedAt: started + 2500,
  position: { latitude: 25.28, longitude: 51.52, horizontalAccuracy: 10, timestamp: started + 3000 },
  ...overrides,
});

it.each(["services-disabled", "foreground-permission-lost", "background-permission-lost", "precise-permission-lost"])(
  "confirmed OS %s closes exactly one AUTO session at the first observed time", async reason => {
    journal = [event("enter", 1)]; await drain();
    const loss = accessLoss({ reason });
    journal = [loss];
    await Promise.all([drain(), drain()]);
    journal = [loss]; await drain();
    expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT"]);
    expect(autoCheckInOut.mock.calls[1][0]).toMatchObject({ occurredAt: loss.timestamp, timestamp: wallClock(loss.timestamp) });
    expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", origin: "AUTO", closedByEventId: loss.eventId,
      registrationGeneration: "registration-1", endedAt: loss.timestamp });
    expect(await Events.findEvent(loss.eventId)).toMatchObject({ status: "handled", outcome: { cutoffAccepted: true,
      targetSession: { sourceEventId: "enter", registrationGeneration: "registration-1" } } });
  },
);

it.each(["weak-gps", "inaccurate-coordinates", "indoor-signal-loss", "location-timeout", "battery-saver", "network-disconnected", "GEOFENCE_NOT_AVAILABLE"])(
  "%s cannot masquerade as an OS access revocation or close an indoor AUTO session", async reason => {
    journal = [event("enter", 1)]; await drain();
    const before = await readSession();
    journal = [accessLoss({ reason })]; await drain();
    expect(await readSession()).toEqual(before);
    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
    expect(await listAll()).toEqual([]);
    expect(await Events.findEvent("access-loss")).toMatchObject({ status: "needs_review", reason: "invalid-native-event" });
  },
);

it.each(["MANUAL", "UNKNOWN"])("access loss preserves an existing %s session and cannot authorize recovery IN", async origin => {
  await performSessionTransition({ type: "IN", origin, at: started, execute: async () => ({ allowed: true }) });
  journal = [accessLoss(), accessRecovery()]; await drain();
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", origin, startedAt: started });
  expect(autoCheckInOut).not.toHaveBeenCalled();
  expect((await Events.findEvent("access-loss")).outcome?.cutoffAccepted).not.toBe(true);
});

it("unproven legacy AUTO registration cannot authorize an access cutoff", async () => {
  await performSessionTransition({ type: "IN", origin: "AUTO", sourceEventId: "legacy-enter", at: started,
    execute: async () => ({ allowed: true }) });
  journal = [accessLoss(), accessRecovery()]; await drain();
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: "legacy-enter" });
  expect(autoCheckInOut).not.toHaveBeenCalled();
});

it("restoration inside starts one new session only after the matched cutoff and ignores replay", async () => {
  journal = [event("enter", 1), accessLoss(), accessRecovery()];
  await drain(); resetDatabaseHandle();
  journal = [accessLoss(), accessRecovery()];
  await Promise.all([drain(), drain()]);
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT", "IN"]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: "access-recovery",
    registrationGeneration: "registration-1", startedAt: started + 3000 });
});

it.each([
  ["different generation", { registrationGeneration: "registration-other" }],
  ["different loss", { lossEventId: "missing-loss" }],
  ["another employee", { employeeId: "EMP-OTHER" }],
  ["another tenant", { tenantKey: "https://other.example.test" }],
  ["pre-loss request", { fixRequestedAt: started + 1000 }],
  ["cached fix", { fixRequestedAt: started + 3001 }],
  ["imprecise fix", { position: { latitude: 25.28, longitude: 51.52, horizontalAccuracy: 1000, timestamp: started + 3000 } }],
  ["malformed accuracy", { position: { latitude: 25.28, longitude: 51.52, horizontalAccuracy: -1, timestamp: started + 3000 } }],
])("%s recovery cannot reopen the cut-off session", async (_name, overrides) => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  journal = [accessRecovery(overrides)]; await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT"]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedByEventId: "access-loss" });
});

it("same office fingerprint under a replacement registration cannot authorize stale recovery", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  Native.getLocationAccessState.mockReturnValue({ state: "confirmed_available", registrationGeneration: "replacement" });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await Events.findEvent("access-recovery")).toMatchObject({ status: "handled", reason: "access-recovery-registration-changed" });
});

it("a registration replacement during recovery timestamp work prevents submission", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  resolveServerTimestampAt.mockImplementationOnce(async at => {
    Native.getLocationAccessState.mockReturnValue({ state: "confirmed_available", registrationGeneration: "replacement" });
    return wallClock(at);
  });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT" });
});

it("manual activity between cutoff and recovery permanently refuses the recovery check-in", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  await performSessionTransition({ type: "IN", origin: "MANUAL", at: started + 2100, execute: async () => ({ allowed: true }) });
  await performSessionTransition({ type: "OUT", origin: "MANUAL", at: started + 2200, execute: async () => ({ allowed: true }) });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "MANUAL", endedAt: started + 2200 });
});

it("outside recovery adds no punch", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  journal = [accessRecovery({ presence: "outside",
    position: { latitude: 26, longitude: 52, horizontalAccuracy: 10, timestamp: started + 3000 } })];
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await Events.findEvent("access-recovery")).toMatchObject({ status: "handled", reason: "access-recovery-outside" });
});

it("a genuine ENTER after outside recovery starts exactly one fresh AUTO session across replay", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  const outside = accessRecovery({ presence: "outside",
    position: { latitude: 26, longitude: 52, horizontalAccuracy: 10, timestamp: started + 3000 } });
  // A repair callback captured during the episode remains evidence forever.
  const repair = event("repair-enter", 4, "ENTER", { lossEventId: "access-loss" });
  journal = [outside, repair]; await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT"]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedByEventId: "access-loss" });

  // A subsequent genuine crossing has no recovery barrier and may open a new
  // session even though no additional EXIT was captured after outside proof.
  resetDatabaseHandle();
  const crossing = event("genuine-return-enter", 5);
  journal = [outside, repair, crossing]; await drain();
  resetDatabaseHandle();
  journal = [accessLoss(), outside, repair, crossing];
  await Promise.all([drain(), drain()]);

  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT", "IN"]);
  expect(autoCheckInOut.mock.calls[2][0]).toMatchObject({ occurredAt: crossing.timestamp,
    timestamp: wallClock(crossing.timestamp) });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", origin: "AUTO",
    sourceEventId: crossing.eventId, registrationGeneration: "registration-1", startedAt: crossing.timestamp });
  expect(await Events.findEvent(repair.eventId)).toMatchObject({ status: "handled", reason: "access-recovery-enter-evidence" });
  expect(await listAll()).toEqual([]);
});

it("recovery-era initial ENTER never becomes a delayed punch, including after restart", async () => {
  journal = [event("enter", 1), accessLoss(), event("repair-enter", 3, "ENTER", { lossEventId: "access-loss" })];
  await drain(); resetDatabaseHandle();
  journal = [event("repair-enter", 3, "ENTER", { lossEventId: "access-loss" })]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT" });
  expect(await Events.findEvent("repair-enter")).toMatchObject({ status: "handled", reason: "access-recovery-enter-evidence" });
});

it("delayed offline cutoff keeps its original timestamp through restart and upload", async () => {
  journal = [event("enter", 1)]; await drain();
  fetchShouldAttemptRequest.mockResolvedValue(false);
  journal = [accessLoss()]; await drain(); resetDatabaseHandle();
  const [queued] = await listAll();
  expect(queued).toMatchObject({ action: "checkout", sourceEventId: "access-loss", status: "pending" });
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", endedAt: started + 2000 });
  const http = new MockAdapter(apiClient);
  http.onPost(/add_offline_employee_checkins/).reply(200, { message: { inserted: ["DELAYED-OUT"], failed: [] } });
  try {
    fetchShouldAttemptRequest.mockResolvedValue(true); resetSyncService();
    await syncPendingAttendance({ employeeId, wakeAllPending: true });
    await syncPendingAttendance({ employeeId, wakeAllPending: true });
    expect(http.history.post).toHaveLength(1);
    const { logs } = JSON.parse(http.history.post[0].data);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ timestamp: queued.timestamp, log_type: "OUT" });
  } finally { http.restore(); resetSyncService(); }
});

it("an ambiguous access-loss POST is verified after restart without a second OUT", async () => {
  journal = [event("enter", 1)]; await drain();
  autoCheckInOut.mockImplementationOnce(async () => { throw new Error("Connection lost after dispatch"); });
  journal = [accessLoss()]; await drain();
  const database = await getDatabase();
  await database.runAsync("UPDATE auto_attendance_events SET claimExpiresAt = ? WHERE eventId = ?;", [0, "access-loss"]);
  resetDatabaseHandle();
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "PREVIOUS-OUT" } });
  await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedByEventId: "access-loss" });
  expect(await Events.findEvent("access-loss")).toMatchObject({ status: "handled", outcome: { cutoffAccepted: true } });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(3);
});

it("a crash after committing the cutoff but before settlement retains exact session identity", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  const closed = await readSession();
  await Events.updateEvent("access-loss", { status: "pending" });
  resetDatabaseHandle();
  verifyQueuedAttendance.mockResolvedValue({ verified: true, evidence: { name: "RECORDED-OUT" } });
  await drain();
  expect(await readSession()).toEqual(closed);
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await Events.findEvent("access-loss")).toMatchObject({ outcome: { cutoffAccepted: true } });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT", "IN"]);
});

it("unknown access before recovery dispatch waits safely, and a later confirmed read permits one IN", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  Native.getLocationAccessState.mockReturnValue({ state: "unknown", registrationGeneration: "registration-1" });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await Events.findEvent("access-recovery")).toMatchObject({ status: "pending", reason: "access-recovery-access-unverified" });
  Native.getLocationAccessState.mockReturnValue({ state: "confirmed_available", registrationGeneration: "registration-1" });
  await drain(); await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(3);
});

it("a newer confirmed access-loss episode supersedes an unsubmitted recovery", async () => {
  journal = [event("enter", 1), accessLoss()]; await drain();
  Native.getLocationAccessState.mockReturnValue({ state: "confirmed_disabled", registrationGeneration: "registration-1",
    lossEventId: "newer-loss", recoveryPending: true });
  journal = [accessRecovery()]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(2);
  expect(await Events.findEvent("access-recovery")).toMatchObject({ status: "handled", reason: "access-recovery-superseded" });
});

it("recovery persistence retains structural position fields only", async () => {
  const proof = accessRecovery();
  proof.position.unexpected = "not-location-data";
  const stored = await Events.ingestNativeEvent(proof);
  expect(stored.event.position).toEqual({ latitude: 25.28, longitude: 51.52, horizontalAccuracy: 10, timestamp: started + 3000 });
});

it("exact server-second reconciliation preserves the receipt identity needed for cutoff and recovery", async () => {
  const at = Math.floor(started / 1000) * 1000 + 1234;
  await rememberServerOffset(wallClock(Math.floor(at / 1000) * 1000), Math.floor(at / 1000) * 1000, { tenantKey: TEST_TENANT });
  journal = [event("enter", 1, "ENTER", { timestamp: at })]; await drain();
  await reconcileSessionFromServer({ activeStartedAt: Math.floor(at / 1000) * 1000, fetchedAt: Date.now() + 1000 });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", sourceEventId: "enter", startedAt: at,
    registrationGeneration: "registration-1", sourceTimestamp: wallClock(at) });
  journal = [accessLoss(), accessRecovery()]; await drain();
  expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(["IN", "OUT", "IN"]);
});

it("a different server timestamp cannot inherit the previous AUTO receipt generation", async () => {
  journal = [event("enter", 1)]; await drain();
  await reconcileSessionFromServer({ activeStartedAt: started + 15000, fetchedAt: Date.now() + 1000 });
  const reconciled = await readSession();
  expect(reconciled.sourceEventId).toBeUndefined();
  expect(reconciled.registrationGeneration).toBeUndefined();
  expect(reconciled.sourceTimestamp).toBeUndefined();
  journal = [accessLoss({ timestamp: started + 20000 })]; await drain();
  expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", startedAt: started + 15000 });
});
