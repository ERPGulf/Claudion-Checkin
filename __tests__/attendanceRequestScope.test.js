import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, plainAxios, saveTokens } from "../services/api/apiClient";
import { pushCheckin } from "../services/offline/AttendanceApi";
import { captureAttendanceQueueScope, normalizeAttendanceTenantKey } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { uploadQueuedPhoto } from "../services/offline/attendancePhotoUpload";

jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
const EMPLOYEE = "EMP-001";
const endpoint = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`;
const refreshEndpoint = `${TEST_TENANT}/api/method/employee_app.gauth.create_refresh_token`;
const accepted = { message: { inserted: ["CHECKIN-1"], failed: [] } };
const row = { employeeId: EMPLOYEE, tenantKey: TEST_TENANT, action: "checkin", timestamp: "2026-07-01 09:00:00", payload: {} };
let http, refreshHttp;

beforeEach(async () => {
  await clearTokens();
  await AsyncStorage.clear();
  await loginQueueEmployee(EMPLOYEE);
  await saveTokens("access-original", "refresh-original");
  http = new MockAdapter(apiClient);
  refreshHttp = new MockAdapter(plainAxios);
});
afterEach(() => { http.restore(); refreshHttp.restore(); jest.restoreAllMocks(); });

it("normalizes backend formatting without accepting credentials or query strings as tenant identity", () => {
  expect(normalizeAttendanceTenantKey(" HTTPS://ATTENDANCE.EXAMPLE.COM:443/// ")).toBe(TEST_TENANT);
  expect(normalizeAttendanceTenantKey("https://example.com/site/")).toBe("https://example.com/site");
  expect(normalizeAttendanceTenantKey("https://user:secret@example.com")).toBeNull();
  expect(normalizeAttendanceTenantKey("https://example.com?token=secret")).toBeNull();
  expect(normalizeAttendanceTenantKey("not-a-backend")).toBeNull();
});

it("resolves the latest access token within the same session", async () => {
  const syncScope = await captureAttendanceQueueScope(EMPLOYEE);
  expect(syncScope).not.toHaveProperty("accessToken");
  await saveTokens("rotated-access", "rotated-refresh");
  http.onPost(endpoint).reply(config => {
    expect(config.headers.Authorization).toBe("Bearer rotated-access");
    return [200, accepted];
  });
  await expect(pushCheckin(row, { syncScope })).resolves.toMatchObject({ result: "inserted" });
});

it("retains request scope through an ordinary 401 refresh and uses the rotated token", async () => {
  http.onPost(endpoint).replyOnce(401);
  refreshHttp.onPost(refreshEndpoint).reply(200, { data: { access_token: "refreshed-access", refresh_token: "refreshed-refresh" } });
  http.onPost(endpoint).reply(config => {
    expect(config.attendanceSyncScope.tenantKey).toBe(TEST_TENANT);
    expect(config.headers.Authorization).toBe("Bearer refreshed-access");
    return [200, accepted];
  });
  await expect(pushCheckin(row)).resolves.toMatchObject({ result: "inserted" });
  expect(http.history.post).toHaveLength(2);
  expect(refreshHttp.history.post).toHaveLength(1);
});

it("does not retry an old request or overwrite new credentials when the account switches during refresh", async () => {
  let release, started;
  const awaitingRefresh = new Promise(resolve => { started = resolve; });
  http.onPost(endpoint).reply(401);
  refreshHttp.onPost(refreshEndpoint).reply(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const result = pushCheckin(row).catch(error => error);
  await awaitingRefresh;
  await clearTokens();
  await loginQueueEmployee(EMPLOYEE, "https://other.example.com", "new-account");
  await saveTokens("new-account", "new-account-refresh");
  release([200, { data: { access_token: "stale-response", refresh_token: "stale-refresh" } }]);
  expect((await result).code).toBe("ATTENDANCE_SYNC_SCOPE_CHANGED");
  expect(http.history.post).toHaveLength(1);
  expect(await AsyncStorage.getItem("access_token")).toBe("new-account");
});

it("invalidates a paused request across logout and re-login to the same employee and tenant", async () => {
  const scope = await captureAttendanceQueueScope(EMPLOYEE);
  await clearTokens();
  await loginQueueEmployee(EMPLOYEE);
  http.onPost(endpoint).reply(200, accepted);
  await expect(pushCheckin(row, { syncScope: scope })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.post).toHaveLength(0);
});

it("never permits the uploader's default entry to bypass unknown or different tenant provenance", async () => {
  await expect(pushCheckin({ ...row, tenantKey: null })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  await expect(pushCheckin({ ...row, tenantKey: "https://other.example.com" })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.post).toHaveLength(0);
});

it("does not attach credentials to a request whose URL disagrees with its expected queue scope", async () => {
  const scope = await captureAttendanceQueueScope(EMPLOYEE);
  await expect(apiClient.post("https://other.example.com/api/test", {}, { attendanceSyncScope: scope })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(http.history.post).toHaveLength(0);
});

it("guards optional photo requests against account changes too", async () => {
  const scope = await captureAttendanceQueueScope(EMPLOYEE);
  await loginQueueEmployee(EMPLOYEE, "https://other.example.com");
  expect(await uploadQueuedPhoto({ photoUri: "file:///cached.jpg", docname: "CHECKIN-1", syncScope: scope })).toMatchObject({ uploaded: false });
  expect(http.history.post).toHaveLength(0);
  expect(http.history.put).toHaveLength(0);
});
