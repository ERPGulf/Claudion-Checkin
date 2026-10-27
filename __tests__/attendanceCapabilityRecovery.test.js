/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { store } from "../redux/Store";
import { settingsReceived, settingsInvalidated } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { verifyQueuedAttendance } from "../services/offline/AttendanceVerification";
import { enqueue, findById } from "../services/offline/AttendanceQueueRepository";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-SYNTHETIC";
const row = {
  tenantKey: TEST_TENANT, employeeId, employeeDocname: "EMP-DOC-SYNTHETIC",
  attendanceType: "auto", timestamp: "2026-10-15 09:00:00", action: "checkin",
};
let http;

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability();
  await clearTokens(); await AsyncStorage.clear(); await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-access", "synthetic-refresh");
  store.dispatch(settingsInvalidated());
  store.dispatch(settingsReceived({
    scope: buildSettingsScope(TEST_TENANT, employeeId),
    settings: normalizeFeatureSettings({ attendance_action: {
      offline_attendance: false, geo_tagging: false, attendance_history: false, photo_upload: false,
    } }),
  }));
  http = new MockAdapter(apiClient);
});
afterEach(() => { http.restore(); store.dispatch(settingsInvalidated()); resetSyncService(); });

it("allows scoped positive-evidence outbox verification while history browsing is disabled", async () => {
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_attendance_details`).reply(200, {
    message: [{ name: "SYNTHETIC-CHECKIN", employee: row.employeeDocname, time: row.timestamp, log_type: "IN" }],
  });
  const syncScope = await captureAttendanceQueueScope(employeeId);
  await expect(verifyQueuedAttendance(row, { syncScope })).resolves.toMatchObject({
    verified: true, evidence: { name: "SYNTHETIC-CHECKIN" },
  });
  expect(http.history.get).toHaveLength(1);
  expect(http.history.get[0].attendanceStatusRead).toBe(true);
  await expect(apiClient.get(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_attendance_details`))
    .rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(http.history.get).toHaveLength(1);
});

it("delivers previously accepted attendance after admission is disabled and preserves other-tenant rows", async () => {
  const mine = (await enqueue(row)).row;
  const foreign = (await enqueue({ ...row, tenantKey: "https://other.example.test" })).row;
  const unknown = (await enqueue({ ...row, tenantKey: null, employeeId: "OTHER-EMPLOYEE" })).row;
  http.onPost(`${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`).reply(200, {
    message: { status: "success", inserted: ["SYNTHETIC-CHECKIN"], failed: [] },
  });
  const result = await syncPendingAttendance({ employeeId });
  expect(result.synced).toBe(1);
  expect(await findById(mine.id)).toMatchObject({ status: "synced", acceptanceConfirmed: 1 });
  expect(await findById(foreign.id)).toMatchObject({ status: "pending", tenantKey: "https://other.example.test" });
  expect(await findById(unknown.id)).toMatchObject({ status: "pending", tenantKey: null });
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data).logs).toHaveLength(1);
});
