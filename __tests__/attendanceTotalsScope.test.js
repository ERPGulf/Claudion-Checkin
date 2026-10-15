import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { getDailyWorkedHours, getMonthlyWorkedHours, getTodayBreaks, employeeBreak } from "../services/api/attendance.service";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
const employeeId = "EMP-001";
const prefix = `${TEST_TENANT}/api/method/employee_app.attendance_api`;
const reads = [
  ["daily", "get_total_hours", scope => getDailyWorkedHours(employeeId, "14-10-2026", { syncScope: scope }), "08:00"],
  ["monthly", "get_monthly_hours", scope => getMonthlyWorkedHours(employeeId, 10, 2026, { syncScope: scope }), "80:00"],
  ["breaks", "get_today_breaks", scope => getTodayBreaks(employeeId, "14-10-2026", { syncScope: scope }), { total_break_minutes: 30, breaks: [] }],
];
let http, scope;
beforeEach(async () => {
  await clearTokens(); await AsyncStorage.clear(); await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-original", "synthetic-refresh");
  scope = await captureAttendanceQueueScope(employeeId);
  http = new MockAdapter(apiClient);
  http.onGet(`${prefix}.get_server_time`).reply(200, { message: { server_time: "2026-10-14 09:00:00" } });
});
afterEach(() => { http.restore(); jest.restoreAllMocks(); });
const switchTenant = async () => {
  await loginQueueEmployee(employeeId, "https://other.example.com", "synthetic-other");
  await saveTokens("synthetic-other", "synthetic-other-refresh");
};

it.each(reads)("%s totals reject an old-account response instead of returning it", async (_name, method, read, message) => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  http.onGet(`${prefix}.${method}`).reply(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const pending = read(scope);
  await started; await switchTenant();
  release([200, { message }]);
  await expect(pending).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
});

it.each(reads)("%s totals reject a stale scope before making any request", async (_name, _method, read) => {
  await switchTenant();
  await expect(read(scope)).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.get).toEqual([]);
});

it.each(reads)("%s totals include the request scope and preserve successful response shape", async (_name, method, read, message) => {
  http.onGet(`${prefix}.${method}`).reply(200, { message });
  expect(await read(scope)).toEqual(message);
  expect(http.history.get[0].attendanceSyncScope).toEqual(scope);
});

it.each(reads)("%s totals preserve ordinary network-failure defaults for scoped and unscoped callers", async (_name, method, read, message) => {
  http.onGet(`${prefix}.${method}`).reply(500);
  expect(await read(scope)).toEqual(typeof message === "string" ? "00:00" : { total_break_minutes: 0, breaks: [] });
  expect(await read(undefined)).toEqual(typeof message === "string" ? "00:00" : { total_break_minutes: 0, breaks: [] });
});

it.each(reads)("%s totals never turn an explicit scope error into a fallback", async (_name, _method, read) => {
  const error = Object.assign(new Error("Synthetic request scope invalidation"), { code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  jest.spyOn(apiClient, "get").mockRejectedValueOnce(error);
  await expect(read(scope)).rejects.toBe(error);
});

it("refuses an employee inconsistent with the totals request scope", async () => {
  await expect(getDailyWorkedHours("EMP-OTHER", "14-10-2026", { syncScope: scope }))
    .rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.get).toEqual([]);
});

it("does not end a break after scope changes during server-time lookup", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  http.onGet(`${prefix}.get_server_time`).reply(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const pending = employeeBreak({ employeeCode: employeeId, type: "OUT", syncScope: scope });
  await started; await switchTenant();
  release([200, { message: { server_time: "2026-10-14 09:00:00" } }]);
  await expect(pending).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.post).toEqual([]);
});

it("does not report a previous-account break response as current success", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  http.onPost(`${prefix}.Employee_break`).reply(() => { entered(); return new Promise(resolve => { release = resolve; }); });
  const pending = employeeBreak({ employeeCode: employeeId, type: "OUT", syncScope: scope });
  await started; await switchTenant(); release([200, { message: { name: "OLD-BREAK" } }]);
  await expect(pending).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
});

it("preserves the form body and response shape of scoped and unscoped break actions", async () => {
  http.onPost(`${prefix}.Employee_break`).reply(200, { message: { name: "BREAK-1" } });
  const input = { employeeCode: employeeId, type: "IN", reason: "Rest" };
  expect(await employeeBreak({ ...input, syncScope: scope })).toMatchObject({ allowed: true, name: "BREAK-1", message: "Break started" });
  expect(await employeeBreak(input)).toMatchObject({ allowed: true, name: "BREAK-1", message: "Break started" });
  expect(http.history.post[0].data).toBe(http.history.post[1].data);
  expect(http.history.post[0].attendanceSyncScope).toEqual(scope);
  expect(http.history.post[1].attendanceSyncScope).toBeUndefined();
});

it("preserves ordinary break request failure responses for current scoped and unscoped callers", async () => {
  http.onPost(`${prefix}.Employee_break`).reply(500);
  const input = { employeeCode: employeeId, type: "OUT" };
  expect(await employeeBreak({ ...input, syncScope: scope })).toMatchObject({ allowed: false, message: expect.any(String) });
  expect(await employeeBreak(input)).toMatchObject({ allowed: false, message: expect.any(String) });
});
