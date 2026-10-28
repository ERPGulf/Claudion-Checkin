/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
let mockChannel = "preview";
let mockDark = false;
jest.mock("expo-updates", () => ({ get channel() { return mockChannel; } }));
jest.mock("../hooks/useAppTheme", () => ({ __esModule: true, default: () => ({
  colors: require("../constants")[mockDark ? "DARK_COLORS" : "COLORS"], isDark: mockDark,
}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import React from "react";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";
import apiClient, { clearTokens, saveTokens } from "../services/api/apiClient";
import { store } from "../redux/Store";
import { setBaseUrl, setEmployeeCode } from "../redux/Slices/UserSlice";
import { setSignIn } from "../redux/Slices/AuthSlice";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { automaticAttendanceSettings, enableAutomaticAttendance, loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { getDatabase, resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { listAll, enqueue, enqueueSyncTestPair } from "../services/offline/AttendanceQueueRepository";
import { addAttendanceSyncTestPair, canUseAttendanceSyncTest } from "../services/offline/AttendanceSyncTestService";
import { registerQueueDrainHandler } from "../services/offline/AttendanceQueueService";
import { resetOfflineCapability, setOfflineQueueingAllowed } from "../services/offline/offlineCapability";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { resetSyncService, syncPendingAttendance } from "../services/offline/AttendanceSyncService";
import { invalidateInstanceAvailability } from "../services/offline/InstanceAvailabilityService";
import { parseServerWallClock, rememberServerOffset, resetServerClockCache } from "../utils/serverClock";
import { format } from "date-fns";
import AttendanceSyncTestSetting from "../components/settings/AttendanceSyncTestSetting";

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-SYNTHETIC-SYNC-TEST";
const input = { employeeId, tenantKey: TEST_TENANT };
let http;
let drain;
let unregister;
let originalDev;

beforeEach(async () => {
  originalDev = global.__DEV__;
  mockChannel = "preview"; mockDark = false;
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability(); resetServerClockCache(); invalidateInstanceAvailability();
  await clearTokens(); await AsyncStorage.clear();
  store.dispatch({ type: "REVERT_ALL" });
  await loginQueueEmployee(employeeId);
  await saveTokens("synthetic-access", "synthetic-refresh");
  store.dispatch(setBaseUrl(TEST_TENANT));
  store.dispatch(setEmployeeCode(employeeId));
  store.dispatch(setSignIn({ isLoggedIn: true }));
  enableAutomaticAttendance(employeeId);
  const scope = await captureAttendanceQueueScope(employeeId);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(scope));
  await setOfflineQueueingAllowed(true);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ tenantKey: TEST_TENANT, employeeId, employeeDocname: "HR-SYNTHETIC-EMPLOYEE",
    rules: { geotagging: 2, restrictLocation: 1, photo: 0 },
    locations: [{ latitude: 10, longitude: 20, reporting_radius: 100, location: "Synthetic office" }] }));
  http = new MockAdapter(apiClient);
  drain = jest.fn(); unregister = registerQueueDrainHandler(drain);
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  http.restore(); unregister(); resetSyncService();
  global.__DEV__ = originalDev;
  jest.restoreAllMocks();
});

const add = mode => addAttendanceSyncTestPair({ ...input, mode });

it("appends random complete chronological pairs without changing the live session or calling APIs", async () => {
  await AsyncStorage.setItem("attendanceSessionState", "synthetic-existing-session");
  const first = await add("chronological");
  const second = await add("chronological");
  const rows = (await listAll()).sort((a, b) => a.id - b.id);
  expect(rows.map(row => row.action)).toEqual(["checkin", "checkout", "checkin", "checkout"]);
  expect(first.checkoutTime < second.checkinTime).toBe(true);
  expect(rows.every(row => row.attendanceType === "auto" && row.status === "pending" && row.sourceEventId === null && row.uploadAttemptAt === null)).toBe(true);
  expect(rows[0]).toMatchObject({ pairedAttendanceId: rows[1].id, sessionId: rows[1].sessionId, employeeDocname: "HR-SYNTHETIC-EMPLOYEE" });
  expect(rows[1].pairedAttendanceId).toBe(rows[0].id);
  expect(drain).toHaveBeenCalledTimes(2);
  expect(http.history.get).toEqual([]); expect(http.history.post).toEqual([]);
  expect(await AsyncStorage.getItem("attendanceSessionState")).toBe("synthetic-existing-session");
});

it("inserts an older pair OUT first and the real worker still uploads timestamp order and pairing", async () => {
  const newer = await add("chronological");
  const older = await add("non-chronological");
  expect(older.checkoutTime < newer.checkinTime).toBe(true);
  expect(older.rows.map(row => row.action)).toEqual(["checkout", "checkin"]);
  expect(older.rows[0].pairedAttendanceId).toBe(older.rows[1].id);
  http.onGet(`${TEST_TENANT}/api/method/employee_app.attendance_api.get_server_time`)
    .reply(200, { message: { server_time: "2026-10-28 10:00:00" } });
  http.onPost(`${TEST_TENANT}/api/method/employee_app.attendance_api.add_offline_employee_checkins`)
    .reply(config => [200, { message: { inserted: [`TEST-${JSON.parse(config.data).logs[0].timestamp}`], failed: [] } }]);
  expect((await syncPendingAttendance({ employeeId })).synced).toBe(4);
  const records = http.history.post.map(request => JSON.parse(request.data).logs[0]);
  expect(records.map(record => [record.log_type, record.timestamp])).toEqual([
    ["IN", older.checkinTime], ["OUT", older.checkoutTime], ["IN", newer.checkinTime], ["OUT", newer.checkoutTime],
  ]);
  expect(records.every(record => record.employee === "HR-SYNTHETIC-EMPLOYEE" && !record.syncTest)).toBe(true);
});

it("does not change existing rows, including another tenant and uncertain records", async () => {
  await enqueue({ ...input, attendanceType: "auto", timestamp: "2026-01-01 08:00:00", action: "checkin" });
  await enqueue({ ...input, tenantKey: "https://foreign.example.test", attendanceType: "auto", timestamp: "2026-01-01 08:00:00", action: "checkin" });
  const before = await listAll();
  await add("non-chronological");
  const after = await listAll();
  for (const row of before) expect(after.find(saved => saved.id === row.id)).toEqual(row);
  expect(after).toHaveLength(4);
});

it("rolls back the entire pair on timestamp collision and never exposes half a pair", async () => {
  const original = await add("chronological");
  const before = await listAll();
  await expect(enqueueSyncTestPair({ ...input, sessionId: "conflicting-test-pair", reverse: false,
    checkinTime: original.checkinTime, checkoutTime: original.checkoutTime, payload: {}, assertCurrent: () => {} }))
    .rejects.toBeDefined();
  expect(await listAll()).toEqual(before);
});

it("serializes concurrent button requests and respects the autoincrement sequence", async () => {
  await enqueue({ ...input, employeeId: "ANOTHER-EMPLOYEE", action: "checkin", timestamp: "2026-01-01 08:00:00", attendanceType: "auto" });
  await (await getDatabase()).runAsync("UPDATE sqlite_sequence SET seq = 1000 WHERE name = 'attendance_queue';");
  const pairs = await Promise.all([add("chronological"), add("chronological")]);
  expect(pairs[0].checkoutTime < pairs[1].checkinTime).toBe(true);
  const generated = (await listAll()).filter(row => row.payload.syncTest);
  expect(new Set(generated.map(row => row.id)).size).toBe(4);
  expect(Math.min(...generated.map(row => row.id))).toBeGreaterThan(1000);
});

it("uses the current tenant's cached server clock to generate past timestamps", async () => {
  const now = Date.now();
  const serverNow = now + 3 * 60 * 60 * 1000;
  await rememberServerOffset(format(new Date(serverNow), "yyyy-MM-dd HH:mm:ss"), now, { tenantKey: TEST_TENANT });
  const result = await add("chronological");
  const generated = parseServerWallClock(result.checkinTime).getTime();
  expect(generated).toBeGreaterThan(serverNow - 7 * 24 * 60 * 60 * 1000);
  expect(generated).toBeLessThan(serverNow);
});

it("refuses a disabled offline capability and an invalid employee policy without inserting", async () => {
  store.dispatch(settingsReceived(automaticAttendanceSettings(employeeId, TEST_TENANT, { offline_attendance: false })));
  await expect(add("chronological")).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  store.dispatch(settingsReceived(automaticAttendanceSettings(employeeId, TEST_TENANT, { offline_attendance: true })));
  const scope = await captureAttendanceQueueScope(employeeId);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 1 }, beginEmployeeAutoAttendancePolicyReception(scope));
  await expect(add("chronological")).rejects.toMatchObject({ code: "EMPLOYEE_AUTO_ATTENDANCE_DISABLED" });
  expect(await listAll()).toEqual([]);
});

it("refuses stale tenant forms and cancelled actions before any insert", async () => {
  await expect(addAttendanceSyncTestPair({ ...input, tenantKey: "https://another.example.test", mode: "chronological" })).rejects.toThrow(/account changed/);
  await expect(addAttendanceSyncTestPair({ ...input, isCancelled: () => true, mode: "chronological" })).rejects.toBeDefined();
  expect(await listAll()).toEqual([]);
});

it("checks policy at the final write boundary and leaves no partial data on refusal", async () => {
  const db = await getDatabase();
  const read = db.getFirstAsync;
  db.getFirstAsync = async (sql, params) => {
    const result = await read(sql, params);
    if (sql.includes("MIN(timestamp)")) store.dispatch(settingsReceived(automaticAttendanceSettings(employeeId, TEST_TENANT, { offline_attendance: false })));
    return result;
  };
  try { await expect(add("chronological")).rejects.toMatchObject({ code: "FEATURE_DISABLED" }); }
  finally { db.getFirstAsync = read; }
  expect(await listAll()).toEqual([]);
});

it("does not run in a production build, even when called outside the screen", async () => {
  global.__DEV__ = false; mockChannel = "production";
  expect(canUseAttendanceSyncTest()).toBe(false);
  await expect(add("chronological")).rejects.toThrow(/development and preview/);
  expect(await listAll()).toEqual([]);
  const ui = render(<Provider store={store}><AttendanceSyncTestSetting /></Provider>);
  expect(ui.queryByText("Offline attendance API test")).toBeNull();
});

it.each([false, true])("offers both buttons and shows generated times in dark=%s", async dark => {
  mockDark = dark;
  const ui = render(<Provider store={store}><AttendanceSyncTestSetting /></Provider>);
  expect(ui.getByText("Offline attendance API test")).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByLabelText("Add chronological pair")); });
  await waitFor(() => expect(ui.getByText(/Added 2 records: IN/)).toBeTruthy());
  await act(async () => { fireEvent.press(ui.getByLabelText("Add non-chronological pair")); });
  await waitFor(() => expect(listAll()).resolves.toHaveLength(4));
  expect((await listAll()).filter(row => row.payload.syncTest.mode === "non-chronological")).toHaveLength(2);
});

it("ignores rapid double taps while a pair is being saved", async () => {
  const ui = render(<Provider store={store}><AttendanceSyncTestSetting /></Provider>);
  await act(async () => {
    fireEvent.press(ui.getByLabelText("Add chronological pair"));
    fireEvent.press(ui.getByLabelText("Add non-chronological pair"));
  });
  await waitFor(() => expect(listAll()).resolves.toHaveLength(2));
});
