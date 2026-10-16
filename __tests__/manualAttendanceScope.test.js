import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { userCheckIn } from "../services/api/attendance.service";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
const employeeId = "EMP-001";
const clockUrl = `${TEST_TENANT}/api/method/employee_app.attendance_api.get_server_time`;
const punchUrl = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_log_based_on_employee_field`;
let http, scope;
beforeEach(async () => {
  await clearTokens(); await AsyncStorage.clear(); await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-original", "synthetic-refresh");
  await AsyncStorage.multiSet([["restrict_location", "0"], ["unrestricted_checkout_location", "0"]]);
  scope = await captureAttendanceQueueScope(employeeId);
  http = new MockAdapter(apiClient);
  http.onGet(clockUrl).reply(200, { message: { server_time: "2026-10-14 09:00:00" } });
  http.onPost(punchUrl).reply(200, { message: { name: "CHECKIN-1" } });
});
afterEach(() => { http.restore(); jest.restoreAllMocks(); });
const switchTenant = async () => {
  await loginQueueEmployee(employeeId, "https://other.example.com", "synthetic-other");
  await saveTokens("synthetic-other", "synthetic-other-refresh");
};

it("does not POST old manual attendance when tenant changes during server-time lookup", async () => {
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  http.onGet(clockUrl).reply(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const punch = userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope });
  await entered; await switchTenant();
  release([200, { message: { server_time: "2026-10-14 09:00:00" } }]);
  expect(await punch).toMatchObject({ allowed: false, error: { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" } });
  expect(http.history.post).toEqual([]);
});

it("does not POST old manual attendance when employee changes during GPS lookup", async () => {
  await AsyncStorage.setItem("restrict_location", "1");
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_employee_data`).reply(200, {
    message: { restrict_location: 1, unrestricted_checkout_location: 0, photo: 0, geotagging: 2,
      employee_locations: [{ latitude: 25.28, longitude: 51.52, reporting_radius: 100 }] },
  });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  Location.getCurrentPositionAsync.mockImplementationOnce(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const punch = userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope });
  await entered; await loginQueueEmployee("EMP-OTHER");
  release({ coords: { latitude: 25.28, longitude: 51.52 } });
  expect(await punch).toMatchObject({ allowed: false, error: { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" } });
  expect(http.history.post).toEqual([]);
});

it("does not report an old manual HTTP response as a current-account success", async () => {
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  http.onPost(punchUrl).reply(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const punch = userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope });
  await entered; await switchTenant();
  release([200, { message: { name: "OLD-CHECKIN" } }]);
  expect(await punch).toMatchObject({ allowed: false, error: { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" } });
  expect(http.history.post).toHaveLength(1);
});

it.each([0, 1, 2])("keeps restricted check-in and unrestricted checkout independent of employee geo mode %s", async geotagging => {
  await AsyncStorage.multiSet([["restrict_location", "1"], ["unrestricted_checkout_location", "1"], ["geotagging", String(geotagging)]]);
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_employee_data`).reply(200, {
    message: { restrict_location: 1, unrestricted_checkout_location: 1, photo: 0, geotagging,
      employee_locations: [{ location: "Synthetic office", latitude: 25.28, longitude: 51.52, reporting_radius: 100 }] },
  });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 25.35, longitude: 51.6 } });

  expect(await userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope })).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
  expect(await userCheckIn({ employeeCode: employeeId, type: "OUT", syncScope: scope })).toMatchObject({ allowed: true });
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data)).toMatchObject({ log_type: "OUT", auto: false });
});
