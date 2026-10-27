/**
 * @jest-environment jsdom
 *
 * A geofence EXIT that lands while authentication is temporarily unavailable.
 *
 * The refresh endpoint relays a 502 from the OAuth server as a 401. That used to
 * end the session — stopping the geofence, so the rest of the day's crossings
 * were never seen. Now the session survives, the check-out waits in the queue,
 * and it is delivered once a refresh succeeds. Real apiClient, store and queue.
 */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("geolib", () => ({ getPreciseDistance: jest.fn() }));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { plainAxios, clearTokens, saveTokens, registerSessionCleanupHandler } from "../services/api/apiClient";
import { fetchEmployeeData } from "../services/api/employee.service";
import { autoCheckInOut } from "../services/api/attendance.service";
import { store } from "../redux/Store";
import { revertAll } from "../redux/CommonActions";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { CONFIG_KEY, buildConfig } from "../services/offline/attendanceConfigCache";
import { submitAutoAttendance } from "../services/offline/AttendanceQueueService";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { QUEUE_STATUS, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-SYNTHETIC-OUTAGE";
const endpoint = (method) => `${TEST_TENANT}/api/method/employee_app.${method}`;
const punchUrl = endpoint("attendance_api.add_log_based_on_employee_field");
const bulkUrl = endpoint("attendance_api.add_offline_employee_checkins");
const refreshUrl = endpoint("gauth.create_refresh_token");
const employee = { name: "EMP-DOC-SYNTHETIC-OUTAGE", geotagging: 2,
  restrict_location: 0, unrestricted_checkout_location: 1, photo: 0,
  employee_locations: [{ location: "Synthetic office", latitude: 25, longitude: 51, reporting_radius: 100 }] };
let http;
let refresh;

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability();
  await clearTokens(); await AsyncStorage.clear();
  store.dispatch(revertAll());
  await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-access", "synthetic-refresh");
  store.dispatch(settingsReceived({
    scope: buildSettingsScope(TEST_TENANT, employeeId),
    settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true, offline_attendance: true } }),
  }));
  http = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  http.onGet(endpoint("attendance_api.get_employee_data")).reply(200, { message: employee });
  http.onGet(endpoint("attendance_api.get_server_time")).reply(200, { message: { server_time: "2026-10-26 17:05:00" } });
  await fetchEmployeeData(employeeId);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({
    ...buildConfig(employee, { employeeId, now: Date.now() - 60000 }), tenantKey: TEST_TENANT,
  }));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  http.restore(); refresh.restore(); resetSyncService();
  registerSessionCleanupHandler(null);
  jest.restoreAllMocks();
});

it("keeps the session and the check-out through a relayed upstream failure, then delivers it", async () => {
  const forcedLogout = jest.fn();
  registerSessionCleanupHandler(forcedLogout);
  // The access token has expired, and the OAuth server behind the refresh
  // endpoint is restarting.
  http.onPost(punchUrl).reply(401);
  refresh.onPost(refreshUrl).reply(401, { data: "<html><title>502 Bad Gateway</title></html>" });

  const result = await submitAutoAttendance({
    type: "OUT", employeeCode: employeeId, occurredAt: Date.now() - 60000,
    sourceScope: await captureAttendanceQueueScope(employeeId),
    online: () => autoCheckInOut({ employeeCode: employeeId, type: "OUT" }),
  });

  expect(result).toMatchObject({ allowed: true, queued: true });
  expect(forcedLogout).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem("refresh_token")).toBe("synthetic-refresh");
  const [queued] = await listAll();
  expect(queued).toMatchObject({ employeeId, action: "checkout" });

  // The OAuth server is back: the next refresh succeeds and the check-out
  // goes out under the rotated token.
  refresh.reset();
  refresh.onPost(refreshUrl).reply(200, { data: { access_token: "synthetic-rotated", refresh_token: "synthetic-rotated-refresh" } });
  http.onPost(bulkUrl).replyOnce(401);
  http.onPost(bulkUrl).reply(200, { message: { inserted: ["EMP-CKIN-SYNTHETIC-OUT"], failed: [] } });

  const summary = await syncPendingAttendance({ employeeId, wakeAllPending: true, wakeAllBlocked: true });

  expect(summary.synced).toBe(1);
  const delivered = http.history.post.filter((request) => request.url === bulkUrl).pop();
  expect(delivered.headers.Authorization).toBe("Bearer synthetic-rotated");
  expect((await listAll())[0].status).toBe(QUEUE_STATUS.SYNCED);
  expect(forcedLogout).not.toHaveBeenCalled();
});
