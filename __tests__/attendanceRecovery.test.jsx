/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("../redux/Store", () => ({ store: { dispatch: jest.fn() } }));
let mockState;
jest.mock("react-redux", () => ({ useSelector: selector => selector(mockState) }));
jest.mock("../hooks/useAppTheme", () => ({ __esModule: true, default: () => ({ colors: require("../constants").COLORS, isDark: false }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
// Use the actual themed controls; replace only the native modal animation.
jest.mock("../components/common/BottomSheet", () => {
  const { View, Text } = require("react-native");
  return ({ visible, children, title, subtitle }) => visible ? <View><Text>{title}</Text><Text>{subtitle}</Text>{children}</View> : null;
});
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
  addReconnectListener: () => () => {}, startNetworkListener: jest.fn(), stopNetworkListener: jest.fn(),
}));
jest.mock("../services/offline/attendancePhotoUpload", () => ({ uploadQueuedPhoto: jest.fn(async () => ({ uploaded: true })) }));

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
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
import { uploadQueuedPhoto } from "../services/offline/attendancePhotoUpload";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import * as session from "../utils/attendanceSessionState";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const EMPLOYEE = "EMP-001";
const OTHER_TENANT = "https://another.example.com";
const URL = `${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`;
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
  const duplicate = "Employee Checkin CHECKIN-1 already exists";
  http.onPost(URL).reply(status, status === 200 ? { message: { inserted: [], failed: [{ error: duplicate }] } } : { message: duplicate });
  const ui = await mountedWithCount(1);
  await pressSync(ui);
  expect(ui.getByText("Already recorded")).toBeTruthy();
  expect((await repository.listAll())[0]).toMatchObject({ status: "synced", duplicate: true });
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
  expect(ui.getByText("Already recorded")).toBeTruthy();
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

it("retains a successful old punch from sync time and only later purges synced rows", async () => {
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now);
  const { row } = await seed({ now: now - 30 * 86400000 });
  await recovery();
  expect(await repository.findById(row.id)).toMatchObject({ status: "synced", updatedAt: now });
  const pending = await seed({ timestamp: "2026-07-03 09:04:00" });
  await repository.purgeSynced({ now: now + 8 * 86400000 });
  expect(await repository.findById(row.id)).toBeNull();
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
