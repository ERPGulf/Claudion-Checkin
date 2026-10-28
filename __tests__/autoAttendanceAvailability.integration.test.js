/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  getPendingEvents: jest.fn(() => []), acknowledgeEvent: jest.fn(() => true),
}));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: jest.fn(() => true),
  getNetworkState: jest.fn(() => ({ type: "wifi", isConnected: true, isInternetReachable: true })),
  getNetworkRevision: jest.fn(() => 1),
}));

// Real availability probe, request/auth layer, ingress, outbox and synchronization.
// Only the native capture, transport adapter and in-memory SQLite are fixtures.
import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import { format } from "date-fns";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { ingestNativeEvent, findEvent } from "../services/offline/AutoAttendanceEventRepository";
import { drainAutoAttendanceEvents } from "../services/offline/AutoAttendanceEventProcessor";
import { submitAutoAttendance } from "../services/offline/AttendanceQueueService";
import { autoCheckInOut, resolveServerTimestampAt } from "../services/api/attendance.service";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { invalidateInstanceAvailability } from "../services/offline/InstanceAvailabilityService";
import { assertAttendanceQueueScope, captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { performSessionTransition, readSession, SESSION_ORIGIN } from "../utils/attendanceSessionState";
import { createRegistrationId } from "../utils/autoAttendanceRegistration";
import { rememberServerOffset, resetServerClockCache } from "../utils/serverClock";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";
import { enableAutomaticAttendance, loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { store } from "../redux/Store";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-SYNTHETIC-AVAILABILITY";
const employeeDocname = "HR-SYNTHETIC-AVAILABILITY";
const office = { latitude: 25.28, longitude: 51.52, radius: 100 };
const endpoint = method => `${TEST_TENANT}/api/method/employee_app.attendance_api.${method}`;
const healthUrl = endpoint("get_server_time");
const onlineUrl = endpoint("add_log_based_on_employee_field");
const offlineUrl = endpoint("add_offline_employee_checkins");
let http;
let scope;
const nativeEvent = (eventId, sequence, transition, timestamp) => {
  const event = { ...office, tenantKey: TEST_TENANT, employeeId, geotagging: 2,
    eventId, sequence, transition, timestamp, identifier: "office-main", nativeIdentifier: "physical-office" };
  return { ...event, registrationId: createRegistrationId(event) };
};

beforeEach(async () => {
  resetServerClockCache();
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability(); invalidateInstanceAvailability();
  await clearTokens(); await AsyncStorage.clear();
  await loginQueueEmployee(employeeId); await saveTokens("synthetic-access", "synthetic-refresh");
  enableAutomaticAttendance(employeeId);
  scope = await captureAttendanceQueueScope(employeeId);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(scope));
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ employeeId, employeeDocname, tenantKey: TEST_TENANT,
    rules: { geotagging: 2, restrictLocation: 0, unrestrictedCheckoutLocation: 0, photo: 0 },
    locations: [{ ...office, reporting_radius: 100, location: "Synthetic office" }] }));
  http = new MockAdapter(apiClient);
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  http.restore(); invalidateInstanceAvailability(); resetSyncService(); jest.restoreAllMocks();
});

it("keeps firewall-blocked ENTER/EXIT safe to upload and drains them after recovery on the same Wi-Fi", async () => {
  const capturedAt = Date.now() - 120000;
  http.onGet(healthUrl).networkError();
  await ingestNativeEvent(nativeEvent("firewall-enter", 1, "ENTER", capturedAt));
  await ingestNativeEvent(nativeEvent("firewall-exit", 2, "EXIT", capturedAt + 60000));
  await drainAutoAttendanceEvents({ scope });
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "AUTO" });
  const originalRows = (await listAll()).sort((a, b) => a.id - b.id);
  expect(originalRows.map(row => [row.action, row.uploadAttemptAt])).toEqual([["checkin", null], ["checkout", null]]);
  expect(await findEvent("firewall-enter")).toMatchObject({ onlineAttemptAt: null, outcome: { queued: true } });
  await syncPendingAttendance({ employeeId });
  expect(http.history.post).toEqual([]);
  expect((await listAll()).every(row => row.uploadAttemptAt === null)).toBe(true);

  // Host availability changes, but NetInfo's Wi-Fi state/revision never changes.
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(offlineUrl).reply(config => [200, { message: {
    inserted: [`SERVER-${JSON.parse(config.data).logs[0].log_type}`], failed: [],
  } }]);
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 61000);
  const summary = await syncPendingAttendance({ employeeId, trigger: "interval" });
  expect(summary.synced).toBe(2);
  expect(http.history.post.map(request => JSON.parse(request.data).logs[0].log_type)).toEqual(["IN", "OUT"]);
  expect(http.history.post.every(request => request.url === offlineUrl)).toBe(true);
  const delivered = (await listAll()).sort((a, b) => a.id - b.id);
  expect(delivered.map(row => row.timestamp)).toEqual(originalRows.map(row => row.timestamp));
  expect(delivered.every(row => row.status === "synced" && row.acceptanceConfirmed === 1)).toBe(true);
});

it("reuses the successful health clock for a direct automatic punch without another clock GET", async () => {
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(200, { message: { name: "DIRECT-SERVER" } });
  await ingestNativeEvent(nativeEvent("healthy-enter", 1, "ENTER", Date.now() - 120000));
  await drainAutoAttendanceEvents({ scope });
  expect(http.history.get.filter(request => request.url === healthUrl)).toHaveLength(1);
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data)).toMatchObject({ log_type: "IN", auto: true });
  expect(await findEvent("healthy-enter")).toMatchObject({ status: "handled", outcome: { serverConfirmed: true } });
});

it("saves an EXIT after a confirmed online ENTER and uploads after same-network recovery", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(200, { message: { name: "CONFIRMED-ONLINE-IN" } });
  await ingestNativeEvent(nativeEvent("online-enter", 1, "ENTER", now - 60000));
  await drainAutoAttendanceEvents({ scope });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN" });
  // The previous health observation expires; a newly blocked instance is
  // discovered without any transport disconnect/reconnect notification.
  clock.mockReturnValue(now + 10000);
  http.onGet(healthUrl).networkError();
  await ingestNativeEvent(nativeEvent("blocked-exit", 2, "EXIT", now + 10000));
  await drainAutoAttendanceEvents({ scope });
  await syncPendingAttendance({ employeeId });
  const [saved] = await listAll();
  expect(saved).toMatchObject({ action: "checkout", status: "pending", uploadAttemptAt: null });
  expect(await findEvent("blocked-exit")).toMatchObject({ onlineAttemptAt: null, outcome: { queued: true } });
  expect(http.history.post).toHaveLength(1);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT" });
  clock.mockReturnValue(now + 71000);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:01:11" } });
  http.onPost(offlineUrl).reply(200, { message: { inserted: ["CONFIRMED-QUEUED-OUT"], failed: [] } });
  expect((await syncPendingAttendance({ employeeId, trigger: "interval" })).synced).toBe(1);
  expect(JSON.parse(http.history.post[1].data).logs[0]).toMatchObject({ log_type: "OUT", timestamp: saved.timestamp });
  expect(http.history.post).toHaveLength(2);
});

it("retains multiple offline sessions across database-handle and worker restarts", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  http.onGet(healthUrl).networkError();
  for (const [index, transition] of ["ENTER", "EXIT", "ENTER", "EXIT"].entries()) {
    await ingestNativeEvent(nativeEvent(`restart-${index}`, index + 1, transition, now - 240000 + index * 60000));
  }
  await drainAutoAttendanceEvents({ scope });
  await syncPendingAttendance({ employeeId });
  const originals = await listAll();
  expect(originals).toHaveLength(4);
  expect(originals.every(row => row.uploadAttemptAt === null)).toBe(true);
  expect(http.history.post).toEqual([]);
  resetSyncService();
  resetDatabaseHandle();
  expect(await listAll()).toEqual(originals);
  clock.mockReturnValue(now + 61000);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:01:01" } });
  http.onPost(offlineUrl).reply(config => [200, { message: {
    inserted: [`RESTART-${JSON.parse(config.data).logs[0].timestamp}`], failed: [],
  } }]);
  expect((await syncPendingAttendance({ employeeId, trigger: "foreground" })).synced).toBe(4);
  expect(http.history.post.map(request => JSON.parse(request.data).logs[0].log_type)).toEqual(["IN", "OUT", "IN", "OUT"]);
  expect(http.history.post.map(request => JSON.parse(request.data).logs[0].timestamp))
    .toEqual([...originals].sort((a, b) => a.id - b.id).map(row => row.timestamp));
});

it("never stamps a safely queued legacy punch using another tenant's server-clock offset", async () => {
  const now = Date.now();
  const occurredAt = now - 60000;
  await rememberServerOffset(format(new Date(now + 3 * 60 * 60 * 1000), "yyyy-MM-dd HH:mm:ss"), now,
    { tenantKey: "https://foreign-clock.example.test" });
  http.onGet(healthUrl).networkError();
  const online = jest.fn();
  expect(await submitAutoAttendance({ type: "IN", employeeCode: employeeId, occurredAt, sourceScope: scope, online }))
    .toMatchObject({ allowed: true, queued: true });
  expect((await listAll())[0]).toMatchObject({ timestamp: format(new Date(occurredAt), "yyyy-MM-dd HH:mm:ss"), uploadAttemptAt: null });
  expect(online).not.toHaveBeenCalled();
  expect(http.history.post).toEqual([]);
});

it("passes the health clock to the legacy automatic callback without another server-time request", async () => {
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(200, { message: { name: "LEGACY-SERVER" } });
  const occurredAt = Date.now() - 120000;
  const result = await submitAutoAttendance({ type: "IN", employeeCode: employeeId, occurredAt, sourceScope: scope,
    online: ({ serverClock, timestamp }) => autoCheckInOut({ type: "IN", employeeCode: employeeId, occurredAt, serverClock, timestamp, syncScope: scope }) });
  expect(result).toMatchObject({ allowed: true, name: "LEGACY-SERVER" });
  expect(http.history.get.filter(request => request.url === healthUrl)).toHaveLength(1);
  expect(http.history.post).toHaveLength(1);
  expect((await listAll())[0]).toMatchObject({ status: "synced", acceptanceConfirmed: 1,
    timestamp: JSON.parse(http.history.post[0].data).timestamp, serverCheckinId: "LEGACY-SERVER" });
});

it("retains a legacy response-lost POST as a receipt and verifies it without an offline repost", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  const committed = [];
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(config => {
    const body = JSON.parse(config.data);
    committed.push({ name: "LEGACY-COMMITTED", employee: employeeDocname, time: body.timestamp, log_type: body.log_type });
    return Promise.reject(Object.assign(new Error("Response lost after commit"), { code: "ECONNABORTED" }));
  });
  http.onGet(endpoint("get_attendance_details")).reply(() => [200, { message: committed }]);
  const occurredAt = now - 120000;
  const result = await submitAutoAttendance({ type: "IN", employeeCode: employeeId, occurredAt, sourceScope: scope,
    online: ({ timestamp, serverClock }) => autoCheckInOut({ type: "IN", employeeCode: employeeId,
      occurredAt, timestamp, serverClock, syncScope: scope }) });
  expect(result).toMatchObject({ allowed: false, queued: false, reason: "online-outcome-unconfirmed" });
  const [saved] = await listAll();
  expect(saved).toMatchObject({ status: "needs_review", uploadAttemptAt: now, timestamp: committed[0].time,
    payload: { directOnline: true } });
  resetSyncService(); resetDatabaseHandle();
  clock.mockReturnValue(now + 61000);
  expect((await syncPendingAttendance({ employeeId, trigger: "interval" })).synced).toBe(1);
  expect(http.history.post).toHaveLength(1);
  expect((await listAll())[0]).toMatchObject({ status: "synced", acceptanceConfirmed: 1, serverCheckinId: "LEGACY-COMMITTED" });
});

it("recovers a repeated live legacy callback from its verified receipt after the clock changes without posting again", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  const occurredAt = now - 120000;
  const sourceEventId = `legacy-live:${JSON.stringify([TEST_TENANT, employeeId, "IN", occurredAt])}`;
  let committed;
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(config => {
    const body = JSON.parse(config.data);
    committed = { name: "VERIFIED-LEGACY-RECEIPT", employee: employeeDocname, time: body.timestamp, log_type: "IN" };
    return Promise.reject(Object.assign(new Error("Response lost"), { code: "ECONNABORTED" }));
  });
  http.onGet(endpoint("get_attendance_details")).reply(() => [200, { message: [committed] }]);
  const attempt = () => performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.AUTO, at: occurredAt,
    assertCurrent: () => assertAttendanceQueueScope(scope), execute: () => submitAutoAttendance({
      type: "IN", employeeCode: employeeId, occurredAt, sourceScope: scope, sourceEventId,
      online: ({ timestamp }) => autoCheckInOut({ type: "IN", employeeCode: employeeId, timestamp, syncScope: scope }),
    }) });
  expect((await attempt()).status).toBe("failed");
  expect((await readSession()).status).toBe("CHECKED_OUT");
  clock.mockReturnValue(now + 61000);
  expect((await syncPendingAttendance({ employeeId })).synced).toBe(1);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-28 11:00:00" } });
  const recovered = await attempt();
  expect(recovered).toMatchObject({ status: "completed", serverConfirmed: true, queued: false,
    session: { status: "CHECKED_IN", startedAt: occurredAt } });
  expect(http.history.post).toHaveLength(1);
  expect(http.history.get.filter(request => request.url === healthUrl)).toHaveLength(1);
  expect((await listAll())[0]).toMatchObject({ sourceEventId, timestamp: committed.time, status: "synced" });
});

it("keeps a connected legacy EXIT behind its queued ENTER and synchronizes both in order", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  http.onGet(healthUrl).networkError();
  const transition = (type, occurredAt) => performSessionTransition({ type, origin: SESSION_ORIGIN.AUTO, at: occurredAt,
    execute: () => submitAutoAttendance({ type, employeeCode: employeeId, occurredAt, sourceScope: scope,
      sourceEventId: `legacy-live:${JSON.stringify([TEST_TENANT, employeeId, type, occurredAt])}`,
      online: ({ timestamp }) => autoCheckInOut({ type, employeeCode: employeeId, timestamp, syncScope: scope }) }) });
  expect(await transition("IN", now - 120000)).toMatchObject({ status: "completed", queued: true });
  clock.mockReturnValue(now + 2000);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:02" } });
  expect(await transition("OUT", now - 60000)).toMatchObject({ status: "completed", queued: true });
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect(http.history.post).toHaveLength(0);
  const originals = (await listAll()).sort((a, b) => a.id - b.id);
  expect(originals.map(row => [row.action, row.uploadAttemptAt])).toEqual([["checkin", null], ["checkout", null]]);
  http.onPost(offlineUrl).reply(config => [200, { message: {
    inserted: [`LEGACY-${JSON.parse(config.data).logs[0].log_type}`], failed: [],
  } }]);
  expect((await syncPendingAttendance({ employeeId })).synced).toBe(2);
  expect(http.history.post.map(request => JSON.parse(request.data).logs[0].log_type)).toEqual(["IN", "OUT"]);
});

const disableOfflineAdmission = () => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeId),
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true, offline_attendance: false } }),
}));

it("keeps a healthy legacy online punch available when offline admission is disabled", async () => {
  disableOfflineAdmission();
  await AsyncStorage.removeItem(CONFIG_KEY);
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(200, { message: { name: "LEGACY-ONLINE-ONLY" } });
  const result = await submitAutoAttendance({ type: "IN", employeeCode: employeeId, sourceScope: scope,
    online: ({ timestamp }) => autoCheckInOut({ type: "IN", employeeCode: employeeId, timestamp, syncScope: scope }) });
  expect(result).toMatchObject({ allowed: true, name: "LEGACY-ONLINE-ONLY" });
  expect((await listAll())[0]).toMatchObject({ status: "synced", acceptanceConfirmed: 1, employeeId, tenantKey: TEST_TENANT });
  expect(http.history.post.every(request => request.url === onlineUrl)).toBe(true);
});

it("cancels a proven-refused legacy attempt when offline admission is disabled and never resends it", async () => {
  disableOfflineAdmission();
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(403, { message: "Synthetic access refusal" });
  const result = await submitAutoAttendance({ type: "IN", employeeCode: employeeId, sourceScope: scope,
    online: ({ timestamp }) => autoCheckInOut({ type: "IN", employeeCode: employeeId, timestamp, syncScope: scope }) });
  expect(result).toMatchObject({ allowed: false, reason: "admin-disabled" });
  expect((await listAll())[0]).toMatchObject({ status: "cancelled", uploadAttemptAt: null,
    failureClass: "auth", verificationIssue: "known-not-inserted", acceptanceConfirmed: 0 });
  await syncPendingAttendance({ employeeId, wakeAllPending: true, wakeAllBlocked: true });
  expect(http.history.post).toHaveLength(1);
  expect(http.history.get.filter(request => request.url === endpoint("get_attendance_details"))).toHaveLength(0);
});

it("backdates using the cached health observation instead of the later callback time", async () => {
  const observedAt = Date.now();
  const timestamp = await resolveServerTimestampAt(observedAt - 120000, observedAt + 2000, { syncScope: scope,
    serverClock: { serverTime: "2026-10-27 09:00:00", observedAt } });
  expect(timestamp).toBe("2026-10-27 08:58:00");
  expect(http.history.get).toEqual([]);
});

it("keeps a response-lost direct POST uncertain and uses later history reads without resending", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  let sent;
  http.onGet(healthUrl).reply(200, { message: { server_time: "2026-10-27 09:00:00" } });
  http.onPost(onlineUrl).reply(config => {
    sent = JSON.parse(config.data);
    return Promise.reject(Object.assign(new Error("Response lost after dispatch"), { code: "ECONNABORTED" }));
  });
  http.onGet(endpoint("get_attendance_details")).reply(200, { message: [] });
  await ingestNativeEvent(nativeEvent("uncertain-enter", 1, "ENTER", now - 120000));
  await drainAutoAttendanceEvents({ scope });
  expect(await findEvent("uncertain-enter")).toMatchObject({ status: "processing", onlineAttemptAt: now });
  clock.mockReturnValue(now + 121000);
  await drainAutoAttendanceEvents({ scope });
  expect(await findEvent("uncertain-enter")).toMatchObject({ status: "needs_review" });
  clock.mockReturnValue(now + 182000);
  http.onGet(endpoint("get_attendance_details")).reply(200, { message: [{
    name: "LATE-POSITIVE-EVIDENCE", employee: employeeDocname, time: sent.timestamp, log_type: "IN",
  }] });
  await drainAutoAttendanceEvents({ scope });
  expect(http.history.post).toHaveLength(1);
  expect(http.history.get.filter(request => request.url === endpoint("get_attendance_details"))).toHaveLength(2);
  expect(await listAll()).toEqual([]);
  expect(await findEvent("uncertain-enter")).toMatchObject({ status: "handled", outcome: { serverConfirmed: true } });
});
