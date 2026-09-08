/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
let mockState;
let mockDark = false;
jest.mock("react-redux", () => ({ useSelector: selector => selector(mockState) }));
jest.mock("../hooks/useAppTheme", () => ({ __esModule: true, default: () => ({ colors: require("../constants")[mockDark ? "DARK_COLORS" : "COLORS"], isDark: mockDark }) }));
jest.mock("../hooks/useOfflineSyncAlerts", () => ({ __esModule: true, default: () => ({ enabled: false }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
// Use the actual themed controls; replace only the native modal animation.
jest.mock("../components/common/BottomSheet", () => {
  const { View, Text } = require("react-native");
  return ({ visible, children, title, subtitle }) => visible ? <View><Text>{title}</Text><Text>{subtitle}</Text>{children}</View> : null;
});
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
  fetchIsOnline: jest.fn(async () => true), addNetworkChangeListener: () => () => {},
  addReconnectListener: () => () => {}, startNetworkListener: jest.fn(), stopNetworkListener: jest.fn(),
}));
jest.mock("../services/offline/attendancePhotoUpload", () => ({ uploadQueuedPhoto: jest.fn(async () => ({ uploaded: true })) }));

import React from "react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import useOfflineStatus from "../hooks/useOfflineStatus";
import MockAdapter from "axios-mock-adapter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import AttendanceRecoverySetting from "../components/settings/AttendanceRecoverySetting";
import { resetDatabaseHandle, getDatabase } from "../services/offline/AttendanceDatabase";
import * as repository from "../services/offline/AttendanceQueueRepository";
import { resetSyncService, syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { startBackgroundSync, stopBackgroundSync, syncNow } from "../services/offline/BackgroundSyncManager";
import { submitManualAttendance, submitAutoAttendance } from "../services/offline/AttendanceQueueService";
import { setOfflineQueueingAllowed } from "../services/offline/offlineCapability";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { ATTENDANCE_HISTORY_METHOD, reconcileAttendanceRow } from "../services/offline/AttendanceVerification";
import { uploadQueuedPhoto } from "../services/offline/attendancePhotoUpload";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import * as session from "../utils/attendanceSessionState";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const EMPLOYEE = "EMP-001";
const OTHER_TENANT = "https://another.example.com";
const URL = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`;
const HISTORY_URL = `${TEST_TENANT}/api/method/${ATTENDANCE_HISTORY_METHOD}`;
const serverPunch = (overrides = {}) => ({ name: "EXISTING-1", employee: "HR-EMP-00001",
  time: "2026-07-01 09:04:00", log_type: "IN", ...overrides });
const { __resetAll } = require("../test-utils/expoSqliteMock");
const accepted = name => ({ message: { inserted: [name], failed: [] } });
const seed = (overrides = {}) => repository.enqueue({
  employeeId: EMPLOYEE, employeeDocname: "HR-EMP-00001", tenantKey: TEST_TENANT,
  attendanceType: "manual", action: "checkin", timestamp: "2026-07-01 09:04:00",
  payload: { location: "Office", over_time: 0 }, ...overrides,
});
const recovery = () => syncNow({ employeeId: EMPLOYEE, trigger: "user-sync-pending-attendance" });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
let http;

beforeEach(async () => {
  mockDark = false;
  jest.restoreAllMocks();
  stopBackgroundSync();
  resetSyncService();
  __resetAll();
  resetDatabaseHandle();
  await clearTokens();
  await AsyncStorage.clear();
  await loginQueueEmployee(EMPLOYEE);
  await saveTokens("synthetic-access", "synthetic-refresh");
  mockState = { userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: EMPLOYEE } } };
  setOfflineQueueingAllowed(false);
  fetchShouldAttemptRequest.mockResolvedValue(true);
  uploadQueuedPhoto.mockResolvedValue({ uploaded: true });
  http = new MockAdapter(apiClient);
  http.onPost(URL).reply(200, accepted("CHECKIN-1"));
  http.onGet(HISTORY_URL).reply(200, { message: [] });
});

afterEach(() => { http.restore(); stopBackgroundSync(); });

const mountedWithCount = async count => {
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText(`Pending attendance: ${count}`)).toBeTruthy());
  return ui;
};
const pressSync = async ui => { await act(async () => { fireEvent.press(ui.getByLabelText("Sync now")); }); };

it("recovers an attributable old manual IN through the real coordinator/drain/API without enabling new manual queueing", async () => {
  const { row } = await seed();
  const originalPayload = row.payload;
  const enqueueSpy = jest.spyOn(repository, "enqueue");
  const transitionSpy = jest.spyOn(session, "performSessionTransition");
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  await waitFor(() => expect(ui.getByText("Synced successfully.")).toBeTruthy());
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data)).toEqual({ logs: [{
    employee: "HR-EMP-00001", timestamp: row.timestamp, device_id: "MobileAPP", log_type: "IN", location: "Office", over_time: 0,
  }] });
  expect((await repository.findById(row.id)).payload).toEqual(originalPayload);
  expect(enqueueSpy).not.toHaveBeenCalled();
  expect(transitionSpy).not.toHaveBeenCalled();
  expect(ui.getByText("1 Jul 2026 · 09:04 AM")).toBeTruthy();
  await submitManualAttendance({ type: "IN", employeeCode: EMPLOYEE, online: async () => { throw new Error("Network Error"); } });
  expect(enqueueSpy).not.toHaveBeenCalled();
  expect(await repository.listAll()).toHaveLength(1);
});

it("preserves ordered manual IN/OUT pairing and mixed automatic order", async () => {
  const checkout = await seed({ action: "checkout", timestamp: "2026-07-01 18:12:00" });
  const checkin = await seed();
  await repository.pairWithOpenCheckin({ checkoutId: checkout.row.id, employeeId: EMPLOYEE, tenantKey: TEST_TENANT, timestamp: checkout.row.timestamp });
  await seed({ attendanceType: "auto", timestamp: "2026-07-02 09:10:00" });
  const ui = await mountedWithCount(3);
  await pressSync(ui);
  expect(http.history.post.map(request => JSON.parse(request.data).logs.map(log => log.log_type))).toEqual([["IN"], ["OUT"], ["IN"]]);
  expect((await repository.findById(checkout.row.id)).pairedAttendanceId).toBe(checkin.row.id);
  expect((await repository.findById(checkin.row.id)).pairedAttendanceId).toBe(checkout.row.id);
});

it("keeps other employees and same-code other tenants out of counts, claims and retry wakes", async () => {
  const mine = await seed();
  const otherEmployee = await seed({ employeeId: "EMP-002" });
  const otherTenant = await seed({ tenantKey: OTHER_TENANT });
  for (const { row } of [mine, otherEmployee, otherTenant]) await repository.markBlocked({ id: row.id, failureClass: "auth" });
  const before = await repository.findById(otherTenant.row.id);
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  expect(http.history.post).toHaveLength(1);
  expect(await repository.findById(otherTenant.row.id)).toEqual(before);
  expect((await repository.findById(otherEmployee.row.id)).status).toBe("blocked");
  expect(ui.getAllByText("No pending attendance").length).toBeGreaterThan(0);
});

it("preserves unknown legacy photo rows and shows Cannot verify company without uploading or assigning ownership", async () => {
  const { row } = await seed({ tenantKey: null, payload: { photoUri: "file:///old.jpg" } });
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Cannot verify company: 1")).toBeTruthy());
  expect(ui.getByLabelText("Sync now")).toBeDisabled();
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  expect(ui.getByText("Cannot verify company")).toBeTruthy();
  await recovery(); // background and other callers have the same safety rule.
  expect(http.history.post).toHaveLength(0);
  expect(await repository.findById(row.id)).toEqual(row);
});

it("holds newer attributable attendance behind an older unknown record instead of guessing the session order", async () => {
  await seed({ tenantKey: null });
  const { row } = await seed({ action: "checkout", timestamp: "2026-07-01 18:12:00" });
  await recovery();
  expect(http.history.post).toHaveLength(0);
  expect((await repository.findById(row.id)).status).toBe("pending");
});

it("shows a true empty state with no upload, queue creation or transition even when another tenant has records", async () => {
  await seed({ tenantKey: OTHER_TENANT });
  const enqueueSpy = jest.spyOn(repository, "enqueue");
  const transitionSpy = jest.spyOn(session, "performSessionTransition");
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("No pending attendance")).toBeTruthy());
  expect(ui.getByLabelText("Sync now")).toBeDisabled();
  await pressSync(ui);
  expect(http.history.post).toHaveLength(0);
  expect(enqueueSpy).not.toHaveBeenCalled();
  expect(transitionSpy).not.toHaveBeenCalled();
});

it("surfaces database failure rather than claiming zero pending attendance", async () => {
  jest.spyOn(repository, "countRecoveryByScope").mockRejectedValue(new Error("SQLITE_CORRUPT private internal path"));
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Could not read saved attendance. Please try again.")).toBeTruthy());
  expect(ui.queryByText("No pending attendance")).toBeNull();
  expect(ui.getByLabelText("Sync now")).toBeDisabled();
  expect(JSON.stringify(ui.toJSON())).not.toContain("SQLITE_CORRUPT");
});

it.each([200, 417])("treats supported duplicate response %s as success and does not resubmit", async status => {
  await seed();
  http.onGet(HISTORY_URL).reply(200, { message: [serverPunch()] });
  const duplicate = "Employee Checkin CHECKIN-1 already exists";
  http.onPost(URL).reply(status, status === 200 ? { message: { inserted: [], failed: [{ error: duplicate }] } } : { message: duplicate });
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  expect(ui.getByText("Verified on server")).toBeTruthy();
  expect((await repository.listAll())[0]).toMatchObject({ status: "synced", duplicate: true });
  await recovery();
  expect(http.history.post).toHaveLength(1);
});

it.each(["synced", "failed", "resolved", "cancelled", "invalid", "duplicate", "needs_review"])(
  "makes retained historical %s rows discoverable with zero pending work, including after remount", async status => {
    const { row } = await seed({ now: 1000 });
    await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = ?, error = ? WHERE id = ?",
      [status, "PRIVATE_BACKEND_DETAIL", row.id]);
    const before = await repository.findById(row.id);
    let ui = render(<AttendanceRecoverySetting />);
    await waitFor(() => expect(ui.getByText("Saved attendance needs review")).toBeTruthy());
    expect(ui.getByLabelText("Sync now")).toBeDisabled();
    await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
    expect(ui.getByText(`Worker: ${EMPLOYEE} · Record #${row.id}`)).toBeTruthy();
    expect(ui.queryByText("PRIVATE_BACKEND_DETAIL")).toBeNull();
    ui.unmount(); resetDatabaseHandle(); resetSyncService();
    ui = render(<AttendanceRecoverySetting />);
    await waitFor(() => expect(ui.getByText("Saved attendance needs review")).toBeTruthy());
    await recovery();
    expect(http.history.post).toHaveLength(0);
    expect(await repository.findById(row.id)).toEqual(before);
  },
);

it("shows blocked records and their retry details", async () => {
  const { row } = await seed();
  await repository.markBlocked({ id: row.id, failureClass: "auth" });
  const ui = await mountedWithCount(1);
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  expect(ui.getByText("Waiting to retry: 1")).toBeTruthy();
  expect(ui.getByText(/Sign in again if needed/)).toBeTruthy();
  expect(ui.getByText("Saved status: blocked · Transient retries: 0")).toBeTruthy();
});

it("keeps an unresolved review visible in the banner even when ordinary sync alerts are suppressed", async () => {
  const { row } = await seed();
  await (await getDatabase()).runAsync("UPDATE attendance_queue SET status = 'needs_review' WHERE id = ?", [row.id]);
  const { result } = renderHook(() => useOfflineStatus());
  await waitFor(() => expect(result.current.reviewCount).toBe(1));
  expect(result.current.visible).toBe(true);
  expect(result.current.actionable).toBe(true);
  expect(result.current.phase).toBe("needs-admin");
});

it.each([false, true])("renders historical review and verification controls in dark=%s theme", async dark => {
  mockDark = dark;
  const { row } = await seed();
  await repository.markSynced({ id: row.id });
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Saved attendance needs review")).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  expect(ui.getByText("Needs review")).toHaveStyle({ color: require("../constants")[dark ? "DARK_COLORS" : "COLORS"].warningText });
  expect(ui.getByLabelText("Check server record")).not.toBeDisabled();
});

it.each([
  { employee: "OTHER" }, { employee: EMPLOYEE }, { log_type: "OUT" }, { time: "2026-07-01 09:04:01" },
  { time: "2026-07-01 09:04:00.000001" }, { time: "2026-07-01T09:04:00Z" },
  { name: "" }, { employee: undefined },
])("does not accept duplicate wording without equivalent server evidence: %j", async mismatch => {
  const { row } = await seed();
  const checkout = await seed({ action: "checkout", timestamp: "2026-07-01 18:00:00" });
  http.onPost(URL).reply(417, { message: "Duplicate entry for unrelated server object" });
  http.onGet(HISTORY_URL).reply(200, { message: [serverPunch(mismatch)] });
  const report = await recovery();
  expect(report).toMatchObject({ duplicates: 0, needsReview: 1 });
  expect((await repository.findById(row.id))).toMatchObject({ status: "needs_review", duplicate: true, attemptCount: 1 });
  expect((await repository.findById(checkout.row.id)).status).toBe("pending");
  await recovery();
  expect(http.history.post).toHaveLength(1); // later OUT cannot overtake uncertain IN
});

it("preserves a timeout after server commit, then verifies the deduplicated retry", async () => {
  const { row } = await seed();
  const savedServerRows = new Map();
  const requests = [];
  http.onPost(URL).reply(config => {
    const log = JSON.parse(config.data).logs[0];
    requests.push(log);
    const key = `${log.employee}|${log.timestamp}|${log.log_type}`;
    if (savedServerRows.has(key)) return [417, { message: "already has a log with the same timestamp" }];
    savedServerRows.set(key, serverPunch({ employee: log.employee, time: log.timestamp, log_type: log.log_type }));
    return Promise.reject(Object.assign(new Error("timeout after commit"), { code: "ECONNABORTED" }));
  });
  http.onGet(HISTORY_URL).reply(() => [200, { message: [...savedServerRows.values()] }]);
  await recovery();
  expect((await repository.findById(row.id)).status).toBe("pending");
  resetDatabaseHandle(); resetSyncService();
  await recovery();
  expect(savedServerRows.size).toBe(1);
  expect(requests[1]).toEqual(requests[0]);
  expect(await repository.findById(row.id)).toMatchObject({ status: "synced", duplicate: true, attemptCount: 2 });
  await recovery();
  expect(http.history.post).toHaveLength(2);
});

it.each(["checkin", "checkout"])("verifies an old %s with no pair/server ID using GET only and preserves originals", async action => {
  const { row } = await seed({ action });
  await repository.markSynced({ id: row.id, duplicate: true, serverResponse: { legacy: "original" }, now: 1000 });
  const original = await repository.findById(row.id);
  http.onGet(HISTORY_URL).reply(200, { message: [serverPunch({ log_type: action === "checkout" ? "OUT" : "IN" })] });
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Saved attendance needs review")).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  await act(async () => fireEvent.press(ui.getByLabelText("Check server record")));
  await waitFor(() => expect(ui.getByText("Verified on server")).toBeTruthy());
  expect(http.history.post).toHaveLength(0);
  expect(http.history.get).toHaveLength(1);
  const saved = await repository.findById(row.id);
  expect(saved).toMatchObject({ payload: original.payload, timestamp: original.timestamp,
    serverResponse: original.serverResponse, updatedAt: original.updatedAt, pairedAttendanceId: null, serverCheckinId: null });
  expect(saved.verificationEvidence).toMatchObject({ name: "EXISTING-1", originalStatus: "synced" });
});

it("does not resend or change a terminal row when history is empty, malformed, denied or conflicting", async () => {
  const { row } = await seed();
  await repository.markSynced({ id: row.id, duplicate: true });
  const original = await repository.findById(row.id);
  for (const [code, body] of [[200, { message: [] }], [200, {}], [403, {}], [200, { message: [serverPunch(), serverPunch({ name: "SECOND" })] }]]) {
    http.onGet(HISTORY_URL).reply(code, body);
    expect((await reconcileAttendanceRow({ id: row.id, employeeId: EMPLOYEE })).verified).toBe(false);
    expect(await repository.findById(row.id)).toMatchObject({ ...original,
      verificationCheckedAt: expect.any(Number), verificationIssue: expect.any(String),
    });
  }
  expect(http.history.post).toHaveLength(0);
});

it("keeps an inconclusive check of acknowledged attendance visible after restart", async () => {
  const { row } = await seed();
  await recovery();
  expect((await repository.findById(row.id)).acceptanceConfirmed).toBe(1);
  http.resetHistory();
  await reconcileAttendanceRow({ id: row.id, employeeId: EMPLOYEE });
  resetDatabaseHandle();
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Saved attendance needs review")).toBeTruthy());
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  expect(ui.getByText(/This does not prove it is missing/)).toBeTruthy();
  expect(http.history.post).toHaveLength(0);
  http.onGet(HISTORY_URL).reply(200, { message: [serverPunch()] });
  await act(async () => fireEvent.press(ui.getByLabelText("Check server record")));
  expect(ui.getByText("Verified on server")).toBeTruthy();
  expect((await repository.findById(row.id)).verificationIssue).toBeNull();
});

it("looks beyond the first history page using the existing page contract without sending attendance", async () => {
  const { row } = await seed();
  await repository.markSynced({ id: row.id });
  http.onGet(HISTORY_URL).reply(config => [200, { message: config.params.limit_start === 0
    ? Array.from({ length: 20 }, (_, index) => serverPunch({ name: `NEWER-${index}`, time: "2026-07-02 09:00:00" }))
    : [serverPunch({ time: "2026-07-01 09:04:00.000000" })] }]);
  expect((await reconcileAttendanceRow({ id: row.id, employeeId: EMPLOYEE })).verified).toBe(true);
  expect(http.history.get.map(request => request.params.limit_start)).toEqual([0, 20]);
  expect(http.history.post).toHaveLength(0);
});

it.each(["checkin", "checkout"])("still sends a legacy pending %s without any pairing metadata", async action => {
  const { row } = await seed({ action });
  await recovery();
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data).logs[0]).toMatchObject({
    timestamp: row.timestamp, log_type: action === "checkout" ? "OUT" : "IN",
  });
  expect(await repository.findById(row.id)).toMatchObject({ status: "synced", pairedAttendanceId: null, sessionId: null });
});

it("leaves unknown-company terminal evidence untouched and prevents verification under another company", async () => {
  const { row } = await seed({ tenantKey: null });
  await repository.markSynced({ id: row.id });
  const original = await repository.findById(row.id);
  const result = await reconcileAttendanceRow({ id: row.id, employeeId: EMPLOYEE });
  expect(result.verified).toBe(false);
  expect(http.history.get).toHaveLength(0);
  expect(http.history.post).toHaveLength(0);
  expect(await repository.findById(row.id)).toEqual(original);
});

it("does not apply verification if the account changes during the server read", async () => {
  const { row } = await seed();
  await repository.markSynced({ id: row.id });
  const before = await repository.findById(row.id);
  const pause = deferred(); const sent = deferred();
  http.onGet(HISTORY_URL).reply(() => { sent.resolve(); return pause.promise; });
  const check = reconcileAttendanceRow({ id: row.id, employeeId: EMPLOYEE });
  const failed = expect(check).rejects.toThrow();
  await sent.promise;
  await clearTokens(); await loginQueueEmployee(EMPLOYEE, OTHER_TENANT);
  pause.resolve([200, { message: [serverPunch()] }]);
  await failed;
  expect(await repository.findById(row.id)).toEqual(before);
  expect(http.history.post).toHaveLength(0);
});

it("retains a malformed success as a visible review issue without retrying the uncertain request", async () => {
  const { row } = await seed();
  http.onPost(URL).reply(200, { message: { inserted: [null] } });
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  expect(ui.getByText("Needs review")).toBeTruthy();
  expect((await repository.findById(row.id)).status).toBe("needs_review");
  await recovery();
  expect(http.history.post).toHaveLength(1);
});

it("keeps a transient failure saved, halts before checkout, exits loading and can recover on a later tap", async () => {
  await seed();
  await seed({ action: "checkout", timestamp: "2026-07-01 18:12:00" });
  http.onPost(URL).networkError();
  const ui = await mountedWithCount(2);
  await pressSync(ui);
  expect(ui.getByText("Could not reach the server. This attendance is still saved on this device.")).toBeTruthy();
  expect(ui.getByLabelText("Sync now")).not.toBeDisabled();
  expect(http.history.post).toHaveLength(1);
  expect((await repository.listAll()).every(row => row.status === "pending")).toBe(true);
  http.onPost(URL).reply(200, accepted("RECOVERED"));
  await pressSync(ui);
  expect(http.history.post).toHaveLength(3);
  expect((await repository.listAll()).every(row => row.status === "synced")).toBe(true);
});

it("renders success, duplicate, rejection and retry distinctly without exposing raw backend diagnostics", async () => {
  http.onGet(HISTORY_URL).reply(200, { message: [serverPunch({ time: "2026-07-02 09:04:00" })] });
  for (let day = 1; day <= 4; day++) await seed({ timestamp: `2026-07-0${day} 09:04:00` });
  let call = 0;
  http.onPost(URL).reply(() => {
    call += 1;
    if (call === 1) return [200, accepted("OK")];
    if (call === 2) return [200, { message: { failed: [{ error: "Employee Checkin CHECKIN-1 already exists" }] } }];
    if (call === 3) return [200, { message: { failed: [{ error: "Employee EMP-001 is inactive. Traceback SECRET_DIAGNOSTIC" }] } }];
    return [503, { message: "SECRET_DIAGNOSTIC raw server body" }];
  });
  const ui = await mountedWithCount(4);
  await pressSync(ui);
  expect(ui.getByText("2 synced · 1 waiting to retry · 1 needs attention")).toBeTruthy();
  expect(ui.getByText("Needs attention")).toBeTruthy();
  expect(ui.getByText("Verified on server")).toBeTruthy();
  expect(ui.queryAllByText(/SECRET_DIAGNOSTIC/)).toHaveLength(0);
  expect((await repository.listAll()).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(row => row.status)).toEqual(["synced", "synced", "rejected", "pending"]);
  http.resetHistory();
  await recovery();
  expect(http.history.post).toHaveLength(1); // rejected row was not retried
});

it("does not duplicate uploads on rapid taps or background overlap", async () => {
  await seed();
  const pause = deferred();
  http.onPost(URL).reply(() => pause.promise);
  const ui = await mountedWithCount(1);
  await act(async () => {
    const button = ui.getByLabelText("Sync now");
    fireEvent.press(button); fireEvent.press(button);
  });
  await waitFor(() => expect(http.history.post).toHaveLength(1));
  startBackgroundSync({ employeeId: EMPLOYEE, drainOnly: true });
  const overlapping = recovery();
  await act(async () => { pause.resolve([200, accepted("ONE")]); await overlapping; });
  await waitFor(() => expect(ui.getByText("Synced successfully.")).toBeTruthy());
  expect(http.history.post).toHaveLength(1);
});

it("refuses a claimed row after account/backend changes across an await", async () => {
  const { row } = await seed();
  const claimed = deferred(); const resume = deferred();
  const originalClaim = repository.claimNextPending;
  jest.spyOn(repository, "claimNextPending").mockImplementation(async (...args) => {
    const value = await originalClaim(...args); claimed.resolve(); await resume.promise; return value;
  });
  const run = recovery();
  await claimed.promise;
  await clearTokens();
  await loginQueueEmployee(EMPLOYEE, OTHER_TENANT, "other-account-token");
  resume.resolve();
  const report = await run;
  expect(report.reason).toBe("scope-changed");
  expect(http.history.post).toHaveLength(0);
  expect((await repository.findById(row.id)).status).toBe("pending");
});

it("retains a successful old punch beyond the former purge window", async () => {
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now);
  const { row } = await seed({ now: now - 30 * 86400000 });
  await recovery();
  expect(await repository.findById(row.id)).toMatchObject({ status: "synced", updatedAt: now });
  const pending = await seed({ timestamp: "2026-07-03 09:04:00" });
  await repository.purgeSynced({ now: now + 8 * 86400000 });
  expect(await repository.findById(row.id)).toMatchObject({ status: "synced", updatedAt: now });
  expect((await repository.findById(pending.row.id)).status).toBe("pending");
});

it("reports optional photo failure while attendance remains successful", async () => {
  await seed({ payload: { photoUri: "file:///missing.jpg" } });
  uploadQueuedPhoto.mockResolvedValue({ uploaded: false, reason: "missing" });
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  expect(ui.getByText("Attendance synced, but the photo could not be uploaded.")).toBeTruthy();
  expect((await repository.listAll())[0].status).toBe("synced");
});

it("stamps future automatic records from the originating scope and keeps unattributed replay unknown", async () => {
  setOfflineQueueingAllowed(true);
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await AsyncStorage.setItem("attendanceConfigCache", JSON.stringify({ employeeId: EMPLOYEE, locations: [], rules: { restrictLocation: 0 } }));
  await submitAutoAttendance({ type: "IN", employeeCode: EMPLOYEE });
  expect((await repository.listAll())[0].tenantKey).toBe(TEST_TENANT);
  await submitAutoAttendance({ type: "OUT", employeeCode: EMPLOYEE, occurredAt: new Date(2026, 6, 1, 18).getTime() });
  expect((await repository.listAll()).find(row => row.action === "checkout").tenantKey).toBeNull();
});

it("does not relabel a delayed automatic event with the current tenant", async () => {
  const sourceScope = await captureAttendanceQueueScope(EMPLOYEE);
  await loginQueueEmployee(EMPLOYEE, OTHER_TENANT);
  setOfflineQueueingAllowed(true);
  fetchShouldAttemptRequest.mockResolvedValue(false);
  await AsyncStorage.setItem("attendanceConfigCache", JSON.stringify({ employeeId: EMPLOYEE, locations: [], rules: { restrictLocation: 0 } }));
  await submitAutoAttendance({ type: "IN", employeeCode: EMPLOYEE, sourceScope });
  expect((await repository.listAll())[0].tenantKey).toBeNull();
});

it("keeps known rejected rows out of the pending count and offers their attention details", async () => {
  const { row } = await seed();
  await repository.markRejected({ id: row.id, error: "SECRET_DIAGNOSTIC" });
  const ui = render(<AttendanceRecoverySetting />);
  await waitFor(() => expect(ui.getByText("Needs attention: 1")).toBeTruthy());
  expect(ui.getByLabelText("Sync now")).toBeDisabled();
  await act(async () => fireEvent.press(ui.getByLabelText("View attendance records")));
  expect(ui.getByText("Needs attention")).toBeTruthy();
  expect(ui.queryAllByText(/SECRET_DIAGNOSTIC/)).toHaveLength(0);
  await recovery();
  expect(http.history.post).toHaveLength(0);
  expect((await repository.findById(row.id)).status).toBe("rejected");
});

it("never hands another session the active run's report and stops before the next old-account row", async () => {
  await seed();
  const checkout = await seed({ action: "checkout", timestamp: "2026-07-01 18:12:00" });
  const pause = deferred(); const sent = deferred();
  http.onPost(URL).reply(() => { sent.resolve(); return pause.promise; });
  const original = recovery();
  await sent.promise;
  await clearTokens();
  await loginQueueEmployee(EMPLOYEE, OTHER_TENANT);
  expect(await recovery()).toMatchObject({ reason: "another-session-syncing", records: [] });
  pause.resolve([200, accepted("OLD-ACCOUNT-SUCCESS")]);
  await original;
  expect(http.history.post).toHaveLength(1);
  expect(http.history.post[0].url).toBe(URL);
  expect((await repository.findById(checkout.row.id)).status).toBe("pending");
});

it("releases a stranded claim only within the current employee and tenant", async () => {
  const mine = await seed();
  const theirs = await seed({ tenantKey: OTHER_TENANT });
  const db = await getDatabase();
  await db.runAsync("UPDATE attendance_queue SET status = 'syncing'");
  const before = await repository.findById(theirs.row.id);
  await recovery();
  expect((await repository.findById(mine.row.id)).status).toBe("synced");
  expect(await repository.findById(theirs.row.id)).toEqual(before);
});

it("retains paired checkout rejection without sending the checkout", async () => {
  const checkin = await seed();
  const checkout = await seed({ action: "checkout", timestamp: "2026-07-01 18:12:00" });
  await repository.pairWithOpenCheckin({ checkoutId: checkout.row.id, employeeId: EMPLOYEE, tenantKey: TEST_TENANT, timestamp: checkout.row.timestamp });
  http.onPost(URL).reply(200, { message: { failed: [{ error: "Employee EMP-001 is inactive" }] } });
  const ui = await mountedWithCount(2);
  await pressSync(ui);
  expect(http.history.post).toHaveLength(1);
  expect(ui.getAllByText("Needs attention")).toHaveLength(2);
  expect((await repository.findById(checkin.row.id)).status).toBe("rejected");
  expect((await repository.findById(checkout.row.id)).failureClass).toBe("dependent");
});
