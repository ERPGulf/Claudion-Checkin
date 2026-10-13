/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true),
  isOnline: jest.fn(() => true),
}));
jest.mock("../services/offline/offlineAttendanceGate", () => ({
  evaluateOfflineAttendance: jest.fn(),
}));
jest.mock("../services/offline/AttendanceApi", () => ({
  DEVICE_ID: "MobileAPP",
  PUSH_RESULT: { INSERTED: "inserted", DUPLICATE: "duplicate", BLOCKED: "blocked", REJECTED: "rejected" },
  pushCheckin: jest.fn(),
}));
jest.mock("../services/offline/attendancePhotoUpload", () => ({ uploadQueuedPhoto: jest.fn() }));
jest.mock("../services/offline/AttendanceVerification", () => ({ verifyQueuedAttendance: jest.fn() }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QUEUE_STATUS, resetDatabaseHandle,
} from "../services/offline/AttendanceDatabase";
import {
  claimNextPending, countOutstandingByScope, enqueue, findBySourceEventId, listAll, markSynced,
} from "../services/offline/AttendanceQueueRepository";
import { getDatabase } from "../services/offline/AttendanceDatabase";
import { submitAutoAttendance, submitManualAttendance } from "../services/offline/AttendanceQueueService";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { evaluateOfflineAttendance } from "../services/offline/offlineAttendanceGate";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { resetOfflineCapability, setOfflineQueueingAllowed } from "../services/offline/offlineCapability";
import { resetSyncService, syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { pushCheckin } from "../services/offline/AttendanceApi";
import { verifyQueuedAttendance } from "../services/offline/AttendanceVerification";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { performSessionTransition, readSession, SESSION_ORIGIN } from "../utils/attendanceSessionState";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-001";
const timestamp = "2026-10-12 09:00:00";
const acceptedGate = {
  allowed: true,
  location: null,
  coords: null,
  config: { employeeId, tenantKey: TEST_TENANT, employeeDocname: "HR-EMP-001" },
};
let sourceScope;
const submit = (options = {}) => submitAutoAttendance({
  type: "IN", employeeCode: employeeId, sourceScope, sourceEventId: "enter-1",
  timestamp, occurredAt: 1791800000000, strictOrdering: true, skipPosition: true,
  online: jest.fn(async () => ({ allowed: true, name: "ONLINE-1" })),
  ...options,
});

beforeEach(async () => {
  __resetAll();
  resetDatabaseHandle();
  resetSyncService();
  await AsyncStorage.clear();
  await loginQueueEmployee(employeeId);
  sourceScope = await captureAttendanceQueueScope(employeeId);
  jest.clearAllMocks();
  resetOfflineCapability();
  fetchShouldAttemptRequest.mockResolvedValue(true);
  evaluateOfflineAttendance.mockResolvedValue(acceptedGate);
  pushCheckin.mockImplementation(async row => ({ result: "inserted", serverCheckinId: `SERVER-${row.id}`, response: {} }));
});

it("queues EXIT behind a pending ENTER even when online, with original frozen timestamps and pairing", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  const first = await submit();
  fetchShouldAttemptRequest.mockResolvedValue(true);
  const online = jest.fn(async () => ({ allowed: true, name: "OUT-DIRECT" }));
  const second = await submit({ type: "OUT", sourceEventId: "exit-1", timestamp: "2026-10-12 18:00:00", online });
  expect(online).not.toHaveBeenCalled();
  expect(second).toMatchObject({ allowed: true, queued: true });
  const rows = (await listAll()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  expect(rows.map(row => [row.action, row.timestamp, row.sourceEventId])).toEqual([
    ["checkin", timestamp, "enter-1"], ["checkout", "2026-10-12 18:00:00", "exit-1"],
  ]);
  expect(rows[0].pairedAttendanceId).toBe(second.row.id);
  expect(rows[1].pairedAttendanceId).toBe(first.row.id);
});

it("does not overtake older work when strict queue admission is disabled", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await submit();
  fetchShouldAttemptRequest.mockResolvedValue(true);
  setOfflineQueueingAllowed(false);
  const online = jest.fn();
  const result = await submit({ type: "OUT", sourceEventId: "exit-1", timestamp: "2026-10-12 18:00:00", online });
  expect(result).toMatchObject({ allowed: false, reason: "admin-disabled" });
  expect(online).not.toHaveBeenCalled();
  expect(await listAll()).toHaveLength(1);
});

it("does not let a same-code row in another known tenant divert a valid online punch", async () => {
  await enqueue({ employeeId, tenantKey: "https://other.example.com", attendanceType: "auto", action: "checkin", timestamp });
  const online = jest.fn(async () => ({ allowed: true, name: "MINE" }));
  expect(await countOutstandingByScope(sourceScope)).toBe(0);
  expect(await submit({ online })).toMatchObject({ allowed: true, name: "MINE" });
  expect(online).toHaveBeenCalledTimes(1);
});

it("retains unknown old provenance as an ordering blocker without uploading or attributing it", async () => {
  await enqueue({ employeeId, tenantKey: null, attendanceType: "auto", action: "checkin", timestamp });
  const online = jest.fn();
  const result = await submit({ type: "OUT", sourceEventId: "exit-1", timestamp: "2026-10-12 18:00:00", online });
  expect(result.queued).toBe(true);
  expect(online).not.toHaveBeenCalled();
  const summary = await syncPendingAttendance({ employeeId });
  expect(summary.synced).toBe(0);
  expect(pushCheckin).not.toHaveBeenCalled();
  expect((await listAll()).find(row => row.sourceEventId == null).tenantKey).toBeNull();
});

it("recovers an existing source event before GPS, cache admission or an online attempt after restart", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  const first = await submit();
  resetDatabaseHandle();
  evaluateOfflineAttendance.mockRejectedValue(new Error("Must not read GPS/cache twice"));
  const online = jest.fn();
  const replay = await submit({ timestamp: "2026-10-12 11:00:00", online });
  expect(replay).toMatchObject({ allowed: true, queued: true, alreadyQueued: true, row: { id: first.row.id, timestamp } });
  expect(evaluateOfflineAttendance).toHaveBeenCalledTimes(1);
  expect(online).not.toHaveBeenCalled();
  expect(await listAll()).toHaveLength(1);
  expect((await findBySourceEventId({ sourceEventId: "enter-1", ...sourceScope })).id).toBe(first.row.id);
});

it("refuses a distinct event colliding with the retained timestamp/action constraint", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await submit();
  const collision = await submit({ sourceEventId: "different-enter" });
  expect(collision).toMatchObject({ allowed: false, reason: "source-event-collision" });
  expect(await listAll()).toHaveLength(1);
  expect((await listAll())[0].sourceEventId).toBe("enter-1");
});

it("never accepts a native queue punch under another employee's cached policy", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  evaluateOfflineAttendance.mockResolvedValue({ ...acceptedGate, config: { ...acceptedGate.config, employeeId: "EMP-OTHER" } });
  expect(await submit()).toMatchObject({ allowed: false, reason: "config-scope-mismatch" });
  expect(await listAll()).toEqual([]);
});

it("does not write a NULL tenant after logout invalidates native processing", async () => {
  await loginQueueEmployee(employeeId);
  fetchShouldAttemptRequest.mockResolvedValue(false);
  expect(await submit()).toMatchObject({ allowed: false, reason: "scope-changed" });
  expect(await listAll()).toEqual([]);
});

it("does not confuse unverified historical synced rows with proof of source acceptance", async () => {
  const { row } = await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin", timestamp, sourceEventId: "enter-1" });
  await markSynced({ id: row.id, serverCheckinId: "OLD-UNPROVEN" });
  expect(await submit()).toMatchObject({ allowed: false, reason: "source-event-needs-review" });
});

it("restores confirmed source acceptance instead of sending it again", async () => {
  const { row } = await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin", timestamp, sourceEventId: "enter-1" });
  await markSynced({ id: row.id, serverCheckinId: "CONFIRMED", acceptanceConfirmed: true });
  const online = jest.fn();
  expect(await submit({ online })).toMatchObject({ allowed: true, queued: false, name: "CONFIRMED" });
  expect(online).not.toHaveBeenCalled();
});

it("synchronizes one IN then one OUT on reconnect, without concurrent duplicate uploads", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: 1791800000000, execute: () => submit() });
  await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.AUTO, at: 1791832400000,
    execute: () => submit({ type: "OUT", sourceEventId: "exit-1", timestamp: "2026-10-12 18:00:00" }) });
  expect((await readSession()).status).toBe("CHECKED_OUT");
  fetchShouldAttemptRequest.mockResolvedValue(true);
  await Promise.all([syncPendingAttendance({ employeeId }), syncPendingAttendance({ employeeId })]);
  expect(pushCheckin.mock.calls.map(([row]) => row.action)).toEqual(["checkin", "checkout"]);
  expect((await listAll()).every(row => row.status === QUEUE_STATUS.SYNCED && row.acceptanceConfirmed === 1)).toBe(true);
});

it("manual checkout cannot overtake a queued automatic IN and remains online-only after it synchronizes", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: 1791800000000, execute: () => submit() });
  fetchShouldAttemptRequest.mockResolvedValue(true);
  const online = jest.fn(async () => ({ allowed: true, name: "MANUAL-OUT" }));
  const execute = () => submitManualAttendance({ type: "OUT", employeeCode: employeeId, online });
  const held = await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, execute });
  expect(held.status).toBe("failed");
  expect(held.response.reason).toBe("automatic-attendance-unconfirmed");
  expect(online).not.toHaveBeenCalled();
  expect((await readSession()).status).toBe("CHECKED_IN");
  await syncPendingAttendance({ employeeId });
  const completed = await performSessionTransition({ type: "OUT", origin: SESSION_ORIGIN.MANUAL, execute });
  expect(completed.status).toBe("completed");
  expect(online).toHaveBeenCalledTimes(1);
  expect(await listAll()).toHaveLength(1);
});

it("holds an unverified duplicate instead of uploading its paired EXIT or resending", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await submit();
  await submit({ type: "OUT", sourceEventId: "exit-1", timestamp: "2026-10-12 18:00:00" });
  fetchShouldAttemptRequest.mockResolvedValue(true);
  pushCheckin.mockResolvedValue({ result: "duplicate", message: "Duplicate timestamp", response: {} });
  verifyQueuedAttendance.mockResolvedValue({ verified: false });
  await syncPendingAttendance({ employeeId });
  await syncPendingAttendance({ employeeId });
  expect(pushCheckin).toHaveBeenCalledTimes(1);
  const rows = (await listAll()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  expect(rows.map(row => row.status)).toEqual(["needs_review", "pending"]);
});

it("keeps manual attendance online-only even if native reliability options are supplied", async () => {
  const online = jest.fn(async () => ({ allowed: true, name: "MANUAL" }));
  expect(await submitManualAttendance({ type: "IN", employeeCode: employeeId, online, strictOrdering: true, forceQueue: true })).toMatchObject({ allowed: true, name: "MANUAL" });
  expect(online).toHaveBeenCalledTimes(1);
  expect(await listAll()).toEqual([]);
});

it("preserves native IN/OUT order when a later server clock correction reverses wall timestamps", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(false);
  const first = await submit();
  const second = await submit({ type: "OUT", sourceEventId: "exit-1", sourceParentEventId: "enter-1",
    timestamp: "2026-10-12 08:59:59" });
  expect(second.row.payload.sourceParentEventId).toBe("enter-1");
  expect((await findBySourceEventId({ sourceEventId: "exit-1", ...sourceScope })).pairedAttendanceId).toBe(first.row.id);
  fetchShouldAttemptRequest.mockResolvedValue(true);
  await syncPendingAttendance({ employeeId });
  expect(pushCheckin.mock.calls.map(([row]) => row.sourceEventId)).toEqual(["enter-1", "exit-1"]);
});

it("retains an OUT after its parent is rejected even if a crash prevented pair links", async () => {
  const first = await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin",
    timestamp, sourceEventId: "enter-1" });
  await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkout",
    timestamp: "2026-10-12 18:00:00", sourceEventId: "exit-1", payload: { sourceParentEventId: "enter-1" } });
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET status = ? WHERE id = ?;", ["rejected", first.row.id]);
  expect(await claimNextPending(Date.now(), sourceScope)).toBeNull();
  await syncPendingAttendance({ employeeId });
  expect(pushCheckin).not.toHaveBeenCalled();
  expect((await listAll()).find(row => row.sourceEventId === "exit-1")).toMatchObject({ status: "pending", pairedAttendanceId: null });
});

it("requires confirmed parent acceptance before an unpaired native OUT can be claimed", async () => {
  const first = await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkin",
    timestamp, sourceEventId: "enter-1" });
  await enqueue({ employeeId, tenantKey: TEST_TENANT, attendanceType: "auto", action: "checkout",
    timestamp: "2026-10-12 18:00:00", sourceEventId: "exit-1", payload: { sourceParentEventId: "enter-1" } });
  await markSynced({ id: first.row.id, serverCheckinId: "UNPROVEN" });
  expect(await claimNextPending(Date.now(), sourceScope)).toBeNull();
  await markSynced({ id: first.row.id, serverCheckinId: "CONFIRMED", acceptanceConfirmed: true });
  expect(await claimNextPending(Date.now(), sourceScope)).toMatchObject({ sourceEventId: "exit-1", status: "syncing" });
});
