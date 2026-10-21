import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { fetchEmployeeData } from "../services/api/employee.service";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
const employeeId = "EMP-001";
const endpoint = `${TEST_TENANT}/api/method/employee_app.attendance_api.get_employee_data`;
let http;
beforeEach(async () => {
  await clearTokens(); await AsyncStorage.clear();
  await loginQueueEmployee(employeeId); await saveTokens("synthetic-access", "synthetic-refresh");
  http = new MockAdapter(apiClient);
});
afterEach(() => { http.restore(); jest.restoreAllMocks(); });

it("scoped employee policy requests preserve the existing GET payload and response", async () => {
  const syncScope = await captureAttendanceQueueScope(employeeId);
  http.onGet(endpoint).reply(config => {
    expect(config.attendanceSyncScope).toEqual(syncScope);
    expect(config.params).toEqual({ employee_id: employeeId });
    expect(config.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    return [200, { message: { name: "EMP-DOC", geotagging: 2 } }];
  });
  expect(await fetchEmployeeData(employeeId, { syncScope })).toEqual({ name: "EMP-DOC", geotagging: 2 });
});

it("a captured employee request cannot dispatch after a tenant switch", async () => {
  const syncScope = await captureAttendanceQueueScope(employeeId);
  await clearTokens(); await loginQueueEmployee(employeeId, "https://other.example.com");
  await saveTokens("other-access", "other-refresh");
  http.onAny().reply(200, { message: {} });
  await expect(fetchEmployeeData(employeeId, { syncScope })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.get).toHaveLength(0);
});

it("scoped employee requests refuse an employee outside the captured scope", async () => {
  const syncScope = await captureAttendanceQueueScope(employeeId);
  http.onAny().reply(200, { message: {} });
  await expect(fetchEmployeeData("OTHER-EMPLOYEE", { syncScope })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.get).toHaveLength(0);
});

it("an old employee response cannot return policy after identity changes in flight", async () => {
  const syncScope = await captureAttendanceQueueScope(employeeId);
  let release, started;
  const awaitingResponse = new Promise(resolve => { started = resolve; });
  http.onGet(endpoint).reply(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const result = fetchEmployeeData(employeeId, { syncScope }).catch(error => error);
  await awaitingResponse;
  await clearTokens(); await loginQueueEmployee(employeeId, "https://other.example.com");
  await saveTokens("other-access", "other-refresh");
  release([200, { message: { geotagging: 2 } }]);
  expect((await result).code).toBe("ATTENDANCE_SYNC_SCOPE_CHANGED");
});

it("ordinary callers keep the existing response unwrapping", async () => {
  http.onGet(endpoint).reply(200, { message: { name: "EMP-DOC" } });
  expect(await fetchEmployeeData(employeeId)).toEqual({ name: "EMP-DOC" });
});
