/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("expo-location", () => ({}));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  getPendingEvents: jest.fn(() => []), acknowledgeEvent: jest.fn(() => true),
}));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: jest.fn(() => true),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { userCheckIn } from "../services/api/attendance.service";
import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { ingestNativeEvent, findEvent } from "../services/offline/AutoAttendanceEventRepository";
import { drainAutoAttendanceEvents } from "../services/offline/AutoAttendanceEventProcessor";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { performManualAttendanceTransition } from "../services/offline/ManualAttendanceService";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { resetOfflineCapability, setOfflineQueueingAllowed } from "../services/offline/offlineCapability";
import { readSession } from "../utils/attendanceSessionState";
import { createRegistrationId } from "../utils/autoAttendanceRegistration";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-001";
const office = { latitude: 25.28, longitude: 51.52, radius: 100 };
const onlineUrl = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`;
const offlineUrl = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`;
let http, scope;
const nativeEnter = eventId => {
  const event = { ...office, tenantKey: TEST_TENANT, employeeId, geotagging: 2,
    eventId, sequence: 1, transition: "ENTER", timestamp: Date.now() - 120000,
    identifier: "office-main", nativeIdentifier: "physical-office" };
  return { ...event, registrationId: createRegistrationId(event) };
};
beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability();
  await clearTokens(); await AsyncStorage.clear();
  await loginQueueEmployee(employeeId); await saveTokens("synthetic-access", "synthetic-refresh");
  await AsyncStorage.multiSet([["restrict_location", "0"], ["unrestricted_checkout_location", "0"]]);
  scope = await captureAttendanceQueueScope(employeeId);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(scope));
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ employeeId, tenantKey: TEST_TENANT,
    employeeDocname: "HR-EMP-001", rules: { geotagging: 2, restrictLocation: 0, unrestrictedCheckoutLocation: 0, photo: 0 },
    locations: [{ ...office, reporting_radius: 100, location: "Office" }] }));
  http = new MockAdapter(apiClient);
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_server_time`)
    .reply(200, { message: { server_time: "2026-10-14 09:00:00" } });
});
afterEach(() => { http.restore(); jest.restoreAllMocks(); });

it("an online committed ENTER timeout is verified before offline replay or a manual OUT can submit", async () => {
  const committed = [];
  http.onPost(onlineUrl).reply(config => {
    const payload = JSON.parse(config.data);
    const name = `ONLINE-${committed.length + 1}`;
    committed.push({ name, employee: "HR-EMP-001", time: payload.timestamp, log_type: payload.log_type });
    if (payload.log_type === "IN") return Promise.reject(Object.assign(new Error("timeout after server commit"), { code: "ECONNABORTED" }));
    return [200, { message: { name } }];
  });
  // This fake backend deliberately provides no deduplication guarantee.
  http.onPost(offlineUrl).reply(config => {
    const log = JSON.parse(config.data).logs[0];
    const name = `OFFLINE-${committed.length + 1}`;
    committed.push({ name, employee: log.employee, time: log.timestamp, log_type: log.log_type });
    return [200, { message: { inserted: [name], failed: [] } }];
  });
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_attendance_details`)
    .reply(() => [200, { message: committed }]);
  const event = nativeEnter("ambiguous-enter");
  await ingestNativeEvent(event);
  await drainAutoAttendanceEvents({ scope });
  await syncPendingAttendance({ employeeId });
  expect(http.history.post).toHaveLength(1);
  expect(await listAll()).toEqual([]);
  expect(await findEvent(event.eventId)).toMatchObject({ status: "processing", onlineAttemptAt: expect.any(Number) });
  // Resume the quiescent interrupted processor after its ownership lease.
  await (await getDatabase()).runAsync("UPDATE auto_attendance_events SET claimExpiresAt = ? WHERE eventId = ?;", [Date.now() - 1, event.eventId]);
  const result = await performManualAttendanceTransition({ type: "OUT", employeeCode: employeeId,
    online: ({ scope: syncScope, occurredAt }) => userCheckIn({ employeeCode: employeeId, type: "OUT", syncScope, occurredAt }) });
  expect(result).toMatchObject({ status: "completed", queued: false, serverConfirmed: true });
  expect(committed.map(row => row.log_type)).toEqual(["IN", "OUT"]);
  expect(http.history.post).toHaveLength(2);
  expect(http.history.post.filter(request => request.url === offlineUrl)).toEqual([]);
  expect(JSON.parse(http.history.post[1].data)).toMatchObject({ log_type: "OUT", auto: false });
  expect(await findEvent(event.eventId)).toMatchObject({ status: "handled", outcome: { serverConfirmed: true } });
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", closedBy: "MANUAL" });
});

it("a confirmed no-insert refusal remains safely retryable when offline admission is disabled", async () => {
  await setOfflineQueueingAllowed(false);
  http.onPost(onlineUrl).reply(config => JSON.parse(config.data).auto
    ? [403, { message: "Not permitted" }]
    : [200, { message: { name: "MANUAL-IN" } }]);
  const event = nativeEnter("known-refused-enter");
  await ingestNativeEvent(event);
  await drainAutoAttendanceEvents({ scope });
  expect(await listAll()).toEqual([]);
  expect(await findEvent(event.eventId)).toMatchObject({ status: "pending", onlineAttemptAt: null,
    outcome: { requestOutcome: "not-inserted", httpStatus: 403, failureClass: "auth" } });
  const result = await performManualAttendanceTransition({ type: "IN", employeeCode: employeeId,
    online: ({ scope: syncScope, occurredAt }) => userCheckIn({ employeeCode: employeeId, type: "IN", syncScope, occurredAt }) });
  expect(result.status).toBe("completed");
  await drainAutoAttendanceEvents({ scope });
  expect(http.history.post).toHaveLength(2); // refused auto request and accepted manual IN
  expect((await findEvent(event.eventId)).status).toBe("handled");
});

it("a pre-dispatch server-clock failure still queues the native event without an attendance POST", async () => {
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_server_time`).networkError();
  const event = nativeEnter("pre-dispatch-enter");
  await ingestNativeEvent(event);
  await drainAutoAttendanceEvents({ scope });
  expect(http.history.post).toHaveLength(0);
  expect((await listAll())[0]).toMatchObject({ status: "pending", sourceEventId: event.eventId, uploadAttemptAt: null });
  expect(await findEvent(event.eventId)).toMatchObject({ status: "handled", onlineAttemptAt: null, outcome: { queued: true } });
});
