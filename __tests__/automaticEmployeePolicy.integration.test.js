/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("geolib", () => ({ getPreciseDistance: jest.fn() }));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { plainAxios, clearTokens, saveTokens } from "../services/api/apiClient";
import { fetchEmployeeData } from "../services/api/employee.service";
import { autoCheckInOut, getOfficeLocation } from "../services/api/attendance.service";
import { EMPLOYEE_AUTO_ATTENDANCE_DISABLED } from "../services/employeeAutoAttendancePolicy";
import { store } from "../redux/Store";
import { revertAll } from "../redux/CommonActions";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { CONFIG_KEY, buildConfig } from "../services/offline/attendanceConfigCache";
import { enqueue, findById } from "../services/offline/AttendanceQueueRepository";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-SYNTHETIC-R4";
const endpoint = (method, tenant = TEST_TENANT) => `${tenant}/api/method/employee_app.attendance_api.${method}`;
const employeeUrl = endpoint("get_employee_data");
const punchUrl = endpoint("add_log_based_on_employee_field");
const clockUrl = endpoint("get_server_time");
const employee = (mode) => ({ name: "EMP-DOC-SYNTHETIC-R4", geotagging: mode,
  restrict_location: 1, unrestricted_checkout_location: 0, photo: 0,
  employee_locations: [{ location: "Synthetic office", latitude: 25, longitude: 51, reporting_radius: 100 }] });
let http;
let refresh;

const receiveSettings = (overrides = {}, tenant = TEST_TENANT) => store.dispatch(settingsReceived({
  scope: buildSettingsScope(tenant, employeeId),
  settings: normalizeFeatureSettings({ attendance_action: {
    geo_tagging: true, offline_attendance: true, attendance_history: false, ...overrides,
  } }),
}));
const receiveMode = async mode => {
  http.onGet(employeeUrl).reply(200, { message: employee(mode) });
  return fetchEmployeeData(employeeId);
};
const writeCache = async (mode, overrides = {}) => {
  const config = { ...buildConfig(employee(mode), { employeeId, now: Date.now() - 60000 }),
    tenantKey: TEST_TENANT, ...overrides };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  return config;
};
const punchPosts = () => http.history.post.filter(request => request.url === punchUrl);
const replyWithAutomatic401 = () => {
  // A replyOnce handler appends after existing persistent handlers. Remove the
  // default success so the first dispatch actually exercises refresh/retry.
  http.resetHandlers();
  http.onGet(clockUrl).reply(200, { message: { server_time: "2026-10-16 09:00:00" } });
  http.onPost(punchUrl).replyOnce(401);
  http.onPost(punchUrl).reply(200, { message: { name: "CHECKIN-SYNTHETIC-R4" } });
};

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability();
  await clearTokens(); await AsyncStorage.clear();
  store.dispatch(revertAll());
  await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-access", "synthetic-refresh");
  receiveSettings();
  http = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  http.onGet(clockUrl).reply(200, { message: { server_time: "2026-10-16 09:00:00" } });
  http.onPost(punchUrl).reply(200, { message: { name: "CHECKIN-SYNTHETIC-R4" } });
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  http.restore(); refresh.restore(); resetSyncService();
  jest.restoreAllMocks();
});

it.each([0, 1])("denies direct automatic service and Axios submissions in employee mode %s", async mode => {
  await receiveMode(mode);
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  await expect(apiClient.post(punchUrl, { auto: true, employee_field_value: employeeId, log_type: "IN" }))
    .rejects.toMatchObject({ code: EMPLOYEE_AUTO_ATTENDANCE_DISABLED, mode });
  expect(punchPosts()).toHaveLength(0);
});

it("does not authorize a new automatic action before receiving employee policy or an owned cache", async () => {
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it("does not apply the current employee mode 2 to a direct automatic request for another employee", async () => {
  await receiveMode(2);
  await expect(apiClient.post(punchUrl, {
    auto: true, employee_field_value: "OTHER-SYNTHETIC-EMPLOYEE", log_type: "IN",
  })).rejects.toBeDefined();
  expect(punchPosts()).toHaveLength(0);
});

it("receives getOfficeLocation employee revocation even when the later GPS permission step fails", async () => {
  await receiveMode(2);
  http.onGet(employeeUrl).reply(200, { message: employee(0) });
  await expect(getOfficeLocation(employeeId)).rejects.toThrow("Location permission denied");
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it("allows legacy online mode 2 with offline disabled and no attendance configuration cache", async () => {
  receiveSettings({ offline_attendance: false });
  await receiveMode(2);
  expect(await AsyncStorage.getItem(CONFIG_KEY)).toBeNull();
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "OUT" }))
    .resolves.toMatchObject({ allowed: true, name: "CHECKIN-SYNTHETIC-R4" });
  expect(punchPosts()).toHaveLength(1);
});

it.each([0, 1])("rechecks mode %s received while the server-clock read is pending", async mode => {
  await receiveMode(2);
  let release;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(clockUrl).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const result = autoCheckInOut({ employeeCode: employeeId, type: "IN" });
  await sent;
  await receiveMode(mode);
  release([200, { message: { server_time: "2026-10-16 09:00:00" } }]);
  await expect(result).resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it.each([0, 1])("does not retry an automatic 401 after receiving employee mode %s during token refresh", async mode => {
  await receiveMode(2);
  replyWithAutomatic401();
  refresh.onPost(`${TEST_TENANT}/api/method/employee_app.gauth.create_refresh_token`).reply(async () => {
    await receiveMode(mode);
    return [200, { data: { access_token: "synthetic-rotated", refresh_token: "synthetic-refresh-rotated" } }];
  });
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it.each(["reauthentication", "tenant switch"])("does not retry a direct automatic 401 across %s", async scenario => {
  await receiveMode(2);
  replyWithAutomatic401();
  refresh.onPost(`${TEST_TENANT}/api/method/employee_app.gauth.create_refresh_token`).reply(async () => {
    const nextTenant = scenario === "tenant switch" ? "https://other-synthetic.example.test" : TEST_TENANT;
    await loginQueueEmployee(employeeId, nextTenant);
    await saveTokens("synthetic-other-access", "synthetic-other-refresh");
    receiveSettings({}, nextTenant);
    return [200, { data: { access_token: "synthetic-rotated", refresh_token: "synthetic-refresh-rotated" } }];
  });
  await expect(apiClient.post(punchUrl, { auto: true, employee_field_value: employeeId, log_type: "IN" }))
    .rejects.toBeDefined();
  expect(punchPosts()).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it("reenables mode 2 after a later authoritative employee response despite an old disabled cache", async () => {
  await writeCache(0);
  await receiveMode(0);
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  await receiveMode(2);
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: true });
  expect(punchPosts()).toHaveLength(1);
});

it("does not let a previously enabled cache override a newer employee revocation", async () => {
  await writeCache(2);
  await receiveMode(0);
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it("preserves a successful request already dispatched before employee-mode revocation", async () => {
  await receiveMode(2);
  http.onPost(punchUrl).reply(async () => {
    await receiveMode(0);
    return [200, { message: { name: "CHECKIN-SYNTHETIC-R4" } }];
  });
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: true, name: "CHECKIN-SYNTHETIC-R4" });
  expect(punchPosts()).toHaveLength(1);
});

it("ignores an older employee response finishing after a newer revocation", async () => {
  let release;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(employeeUrl).replyOnce(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const oldResponse = fetchEmployeeData(employeeId);
  await sent;
  await receiveMode(0);
  release([200, { message: employee(2) }]);
  await oldResponse;
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it.each([
  ["foreign tenant", { tenantKey: "https://other-synthetic.example.test" }],
  ["foreign employee", { employeeId: "OTHER-SYNTHETIC-EMPLOYEE" }],
])("refuses new automatic attendance from an enabled %s cache", async (_label, overrides) => {
  await writeCache(2, overrides);
  await expect(autoCheckInOut({ employeeCode: employeeId, type: "IN" }))
    .resolves.toMatchObject({ allowed: false });
  expect(punchPosts()).toHaveLength(0);
});

it.each(["reauthentication", "tenant switch"])("keeps the original automatic operation owner during %s", async scenario => {
  await receiveMode(2);
  let release;
  let started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(clockUrl).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  // A direct service invocation must capture its owner even without a caller-
  // supplied scope; reauthentication to the same owner still changes generation.
  const result = autoCheckInOut({ employeeCode: employeeId, type: "IN" });
  await sent;
  const nextTenant = scenario === "tenant switch" ? "https://other-synthetic.example.test" : TEST_TENANT;
  await loginQueueEmployee(employeeId, nextTenant);
  await saveTokens("synthetic-other-access", "synthetic-other-refresh");
  receiveSettings({}, nextTenant);
  release([200, { message: { server_time: "2026-10-16 09:00:00" } }]);
  await expect(result).resolves.toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it.each([0, 1])("delivers previously accepted queue rows after employee mode changes to %s", async mode => {
  await receiveMode(2);
  const row = (await enqueue({ tenantKey: TEST_TENANT, employeeId,
    employeeDocname: "EMP-DOC-SYNTHETIC-R4", attendanceType: "auto",
    timestamp: "2026-10-15 09:00:00", action: "checkin" })).row;
  await receiveMode(mode);
  receiveSettings({ offline_attendance: false, geo_tagging: false });
  http.onPost(endpoint("add_offline_employee_checkins")).reply(200, {
    message: { status: "success", inserted: ["CHECKIN-SYNTHETIC-R4"], failed: [] },
  });
  const result = await syncPendingAttendance({ employeeId });
  expect(result.synced).toBe(1);
  expect(await findById(row.id)).toMatchObject({ status: "synced", acceptanceConfirmed: 1 });
  expect(punchPosts()).toHaveLength(0);
});
