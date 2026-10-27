/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main", getPendingEvents: jest.fn(), acknowledgeEvent: jest.fn(),
}));
jest.mock("../services/api/attendance.service", () => ({
  autoCheckInOut: jest.fn(), getAttendanceStatus: jest.fn(), resolveServerTimestampAt: jest.fn(),
}));
jest.mock("../services/offline/NetworkListener", () => ({ fetchShouldAttemptRequest: jest.fn(), isOnline: jest.fn(() => true) }));
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
import { evaluateOfflineAttendance } from "../services/offline/offlineAttendanceGate";
import { verifyQueuedAttendance } from "../services/offline/AttendanceVerification";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { applySessionOwner, performSessionTransition, readSession, SESSION_ORIGIN } from "../utils/attendanceSessionState";
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
  Native.acknowledgeEvent.mockImplementation(id => { journal = journal.filter(item => item.eventId !== id); return true; });
  fetchShouldAttemptRequest.mockResolvedValue(true);
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
