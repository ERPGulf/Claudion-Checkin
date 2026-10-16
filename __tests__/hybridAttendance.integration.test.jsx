/** @jest-environment jsdom */
import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { format } from "date-fns";
import { Button } from "react-native";
import { Toast as CameraToast } from "react-native-toast-message/lib/src/Toast";
import useAttendanceAction from "../hooks/useAttendanceAction";
import AttendanceCamera from "../screens/AttendanceCamera";
import RootReducer from "../redux/RootReducer";
import apiClient from "../services/api/apiClient";
import { employeeBreak, getAttendanceStatus, userCheckIn } from "../services/api/attendance.service";
import { performManualAttendanceTransition } from "../services/offline/ManualAttendanceService";
import { setCheckin } from "../redux/Slices/AttendanceSlice";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { invalidateAuthSession } from "../utils/authSessionGuard";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { findEvent, ingestNativeEvent, updateEvent } from "../services/offline/AutoAttendanceEventRepository";
import { drainAutoAttendanceEvents } from "../services/offline/AutoAttendanceEventProcessor";
import { syncPendingAttendance, resetSyncService } from "../services/offline/AttendanceSyncService";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { getServerOffset, resetServerClockCache } from "../utils/serverClock";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { applySessionOwner, readSession, reconcileSessionFromServer, SESSION_OWNER_KEY, SESSION_STATE_KEY } from "../utils/attendanceSessionState";
import { assertAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
jest.mock("react-native-toast-message", () => ({ show: jest.fn() }));
jest.mock("react-native-toast-message/lib/src/Toast", () => ({ Toast: { show: jest.fn() } }));
jest.mock("../hooks/useModernScreenHeader", () => jest.fn());
jest.mock("expo-image", () => ({ Image: require("react-native").View }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: require("react-native").Text }));
let mockTakePicture;
jest.mock("expo-camera", () => {
  const React = require("react");
  return { useCameraPermissions: () => [{ granted: true }], CameraView: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: (...args) => mockTakePicture(...args) }));
    return null;
  }) };
});
jest.mock("../components/common/ActionButton", () => ({ label, onPress, loading }) =>
  require("react").createElement(require("react-native").Button, { title: label, onPress, disabled: loading }));
jest.mock("../services/api", () => ({
  ...jest.requireActual("../services/api/attendance.service"),
  ...jest.requireActual("../services/api/upload.service"),
}));
jest.mock("../utils/HapticsMessage", () => ({ hapticsMessage: jest.fn() }));
let mockFocus;
const mockNavigation = { addListener: jest.fn((event, callback) => {
  if (event === "focus") mockFocus = callback;
  return jest.fn();
}), navigate: jest.fn() };
jest.mock("@react-navigation/native", () => ({ useNavigation: () => mockNavigation }));
jest.mock("../services/api/apiClient", () => ({
  __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, saveTokens: jest.fn(),
}));
jest.mock("../services/api/attendance.service", () => ({
  ...jest.requireActual("../services/api/attendance.service"),
  getAttendanceStatus: jest.fn(async () => ({ custom_in: 0, unavailable: true })),
  getDailyWorkedHours: jest.fn(async () => "00:00"),
  getMonthlyWorkedHours: jest.fn(async () => "00:00"),
  getTodayBreaks: jest.fn(async () => ({ breaks: [], total_break_minutes: 0 })),
  employeeBreak: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: jest.fn(() => true),
}));
jest.mock("../services/offline/offlineAttendanceGate", () => ({
  ...jest.requireActual("../services/offline/offlineAttendanceGate"),
  resolveNearestOffice: jest.fn(async () => ({ withinRadius: true, latitude: 25.28, longitude: 51.52, radius: 100 })),
}));
let mockJournal = [];
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  getPendingEvents: () => [...mockJournal],
  acknowledgeEvent: id => { mockJournal = mockJournal.filter(event => event.eventId !== id); return true; },
}));

const { __resetAll } = require("../test-utils/expoSqliteMock");
const employeeId = "EMP-001";
const serverOffset = 3 * 60 * 60 * 1000;
let mockHook, store, scope, clock;
const wall = epoch => format(new Date(epoch + serverOffset), "yyyy-MM-dd HH:mm:ss");
const nativeEvent = (eventId, transition, sequence, timestamp) => ({
  eventId, transition, sequence, timestamp, identifier: "office-main", nativeIdentifier: "physical-test",
  tenantKey: TEST_TENANT, employeeId, latitude: 25.28, longitude: 51.52, radius: 100, geotagging: 2,
  registrationId: JSON.stringify([TEST_TENANT, employeeId, "office-main", 25.28, 51.52, 100, 2]),
});
function Harness() { mockHook = useAttendanceAction(); return null; }
const mount = () => render(<Provider store={store}><Harness /></Provider>);

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability(); resetServerClockCache(); await AsyncStorage.clear();
  await loginQueueEmployee(employeeId);
  scope = await captureAttendanceQueueScope(employeeId);
  await applySessionOwner(employeeId, { tenantKey: TEST_TENANT });
  await AsyncStorage.multiSet([["restrict_location", "0"], ["unrestricted_checkout_location", "0"], ["photo", "0"]]);
  clock = Math.floor(Date.now() / 1000) * 1000;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({
    tenantKey: TEST_TENANT, employeeId, employeeDocname: "HR-EMP-001", lastUpdated: clock - 60000,
    rules: { geotagging: 2, restrictLocation: 0, photo: 0, unrestrictedCheckoutLocation: 0 },
    locations: [{ latitude: 25.28, longitude: 51.52, reporting_radius: 100, location: "Office" }],
  }));
  mockJournal = []; jest.clearAllMocks();
  mockTakePicture = jest.fn(async () => ({ uri: "file:///synthetic.jpg" }));
  fetchShouldAttemptRequest.mockResolvedValue(true);
  getAttendanceStatus.mockResolvedValue({ custom_in: 0, unavailable: true });
  employeeBreak.mockResolvedValue({ allowed: true });
  apiClient.get.mockImplementation(async () => ({ data: { message: { server_time: wall(clock) } } }));
  apiClient.post.mockResolvedValue({ data: { message: { name: "CHECKIN-SYNTHETIC" } } });
  apiClient.put.mockResolvedValue({ data: { message: "OK" } });
  store = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: employeeId } },
    autoAttendance: { geotagging: 2, userEnabled: true, syncRequestId: 0 },
  } });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it("real manual hook/API preserves IN time and closes with EXIT captured during upload", async () => {
  const manualAt = clock;
  let accept;
  apiClient.post.mockImplementation((_url, payload) => payload.auto === false
    ? new Promise(resolve => { accept = resolve; })
    : Promise.resolve({ data: { message: { name: "AUTO-OUT" } } }));
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  let manual;
  act(() => { manual = mockHook.handlePrimaryAction(); });
  await waitFor(() => expect(accept).toBeDefined());
  clock += 10000;
  mockJournal = [nativeEvent("delayed-enter", "ENTER", 1, manualAt - 1000), nativeEvent("during-upload-exit", "EXIT", 2, clock)];
  const replay = drainAutoAttendanceEvents({ scope });
  clock += 10000;
  await act(async () => { accept({ data: { message: { name: "MANUAL-IN" } } }); await manual; await replay; });
  expect(apiClient.post.mock.calls.map(([, payload]) => [payload.log_type, payload.auto])).toEqual([["IN", false], ["OUT", true]]);
  expect(apiClient.post.mock.calls[0][1].timestamp).toBe(wall(manualAt));
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", origin: "MANUAL", closedBy: "AUTO", startedAt: manualAt, endedAt: manualAt + 10000 });
  expect(await findEvent("during-upload-exit")).toMatchObject({ status: "handled", reason: null });
  expect(await listAll()).toEqual([]);
});

it("an old manual response after a tenant switch cannot commit or publish IN", async () => {
  let accept;
  apiClient.post.mockImplementation(() => new Promise(resolve => { accept = resolve; }));
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  let manual;
  act(() => { manual = mockHook.handlePrimaryAction(); });
  await waitFor(() => expect(accept).toBeDefined());
  await loginQueueEmployee(employeeId, "https://other.example.com");
  await act(async () => { accept({ data: { message: { name: "OLD-IN" } } }); await manual; });
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect(store.getState().attendance.checkin).toBe(false);
  expect(await listAll()).toEqual([]);
});

it("uncertain automatic IN blocks manual resubmission and retains its EXIT for verification", async () => {
  const originalAt = clock - 10000;
  await ingestNativeEvent(nativeEvent("uncertain-in", "ENTER", 1, originalAt));
  await updateEvent("uncertain-in", { status: "needs_review", onlineAttemptAt: originalAt,
    punchTimestamp: wall(originalAt), reason: "no-exact-match-in-visible-history" });
  apiClient.get.mockImplementation(async url => url.includes("get_attendance_details")
    ? { data: { message: [] } } : { data: { message: { server_time: wall(clock) } } });
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  mockJournal = [nativeEvent("after-uncertain-exit", "EXIT", 2, clock)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post).not.toHaveBeenCalled();
  expect((await findEvent("uncertain-in")).status).toBe("needs_review");
  expect((await findEvent("after-uncertain-exit")).status).toBe("pending");
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("positive history recovers uncertain automatic IN before manual fallback and permits OUT", async () => {
  const originalAt = clock - 10000;
  await ingestNativeEvent(nativeEvent("confirmed-in", "ENTER", 1, originalAt));
  await updateEvent("confirmed-in", { status: "needs_review", onlineAttemptAt: originalAt,
    punchTimestamp: wall(originalAt), reason: "no-exact-match-in-visible-history" });
  apiClient.get.mockImplementation(async url => url.includes("get_attendance_details")
    ? { data: { message: [{ name: "SERVER-IN", employee: "HR-EMP-001", log_type: "IN", time: wall(originalAt) }] } }
    : { data: { message: { server_time: wall(clock) } } });
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", origin: "AUTO", startedAt: originalAt });
  mockJournal = [nativeEvent("confirmed-exit", "EXIT", 2, clock)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.map(([, payload]) => [payload.log_type, payload.auto])).toEqual([["OUT", true]]);
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect((await findEvent("confirmed-in")).status).toBe("handled");
  expect(await listAll()).toEqual([]);
});

it("camera attendance cannot commit an old HTTP response after the tenant changes", async () => {
  let accept;
  apiClient.post.mockImplementation(() => new Promise(resolve => { accept = resolve; }));
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  fireEvent.press(screen.getByLabelText("Take photo"));
  await waitFor(() => expect(screen.getByText("Check in")).toBeTruthy());
  fireEvent.press(screen.getByText("Check in"));
  await waitFor(() => expect(accept).toBeDefined());
  expect(apiClient.post.mock.calls[0][2].attendanceSyncScope).toEqual(scope);
  await loginQueueEmployee(employeeId, "https://other.example.com");
  await act(async () => { accept({ data: { message: { name: "OLD-CAMERA-IN" } } }); });
  await waitFor(() => expect(CameraToast.show).toHaveBeenCalled());
  expect((await readSession()).status).toBe("CHECKED_OUT");
  expect(store.getState().attendance.checkin).toBe(false);
  expect(apiClient.put).not.toHaveBeenCalled();
});

it("camera discards a pending native capture when photo attendance is disabled", async () => {
  let completeCapture;
  mockTakePicture.mockImplementationOnce(() => new Promise(resolve => { completeCapture = resolve; }));
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  fireEvent.press(screen.getByLabelText("Take photo"));
  await waitFor(() => expect(completeCapture).toBeDefined());
  act(() => { store.dispatch(settingsReceived({
    scope: buildSettingsScope(TEST_TENANT, employeeId),
    settings: normalizeFeatureSettings({ attendance_action: { photo_upload: false } }),
  })); });
  await act(async () => { completeCapture({ uri: "file:///synthetic-disabled.jpg" }); });
  expect(screen.queryByText("Check in")).toBeNull();
  expect(CameraToast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: "Photo capture failed" }));
  expect(apiClient.post).not.toHaveBeenCalled();
});

it("a retained camera confirmation cannot submit after photo attendance is disabled", async () => {
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  fireEvent.press(screen.getByLabelText("Take photo"));
  await waitFor(() => expect(screen.getByText("Check in")).toBeTruthy());
  const confirm = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === "Check in").props.onPress;
  act(() => { store.dispatch(settingsReceived({
    scope: buildSettingsScope(TEST_TENANT, employeeId),
    settings: normalizeFeatureSettings({ attendance_action: { photo_upload: false } }),
  })); });
  screen.unmount();
  await act(async () => { await confirm(); });
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(CameraToast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: "Check-in failed" }));
});

it("a retained camera confirmation cannot adopt a reauthenticated session", async () => {
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  fireEvent.press(screen.getByLabelText("Take photo"));
  await waitFor(() => expect(screen.getByText("Check in")).toBeTruthy());
  const confirm = screen.UNSAFE_getAllByType(Button).find(button => button.props.title === "Check in").props.onPress;
  await loginQueueEmployee(employeeId);
  screen.unmount();
  await act(async () => { await confirm(); });
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.put).not.toHaveBeenCalled();
});

it("does not start native photo capture while logout suspends the session", async () => {
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  invalidateAuthSession();
  fireEvent.press(screen.getByLabelText("Take photo"));
  expect(mockTakePicture).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it("camera status update remains inside the manual transition before automatic OUT", async () => {
  let completeStatus;
  apiClient.put.mockImplementation(() => new Promise(resolve => { completeStatus = resolve; }));
  apiClient.post.mockImplementation(async (_url, payload) => payload?.auto === undefined
    ? { data: { message: ["/files/synthetic.jpg"] } }
    : { data: { message: { name: payload.auto ? "AUTO-OUT" : "CAMERA-IN" } } });
  const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
  fireEvent.press(screen.getByLabelText("Take photo"));
  await waitFor(() => expect(screen.getByText("Check in")).toBeTruthy());
  fireEvent.press(screen.getByText("Check in"));
  await waitFor(() => expect(completeStatus).toBeDefined());
  clock += 10000;
  mockJournal = [nativeEvent("camera-exit", "EXIT", 1, clock)];
  const replay = drainAutoAttendanceEvents({ scope });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(apiClient.post.mock.calls.filter(([, payload]) => payload.auto === true)).toEqual([]);
  apiClient.put.mockResolvedValue({ data: { message: "OK" } });
  await act(async () => { completeStatus({ data: { message: "OK" } }); await replay; });
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("server-status reconciliation keeps native/session comparisons on the device clock", async () => {
  const manualAt = clock;
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  clock += 60000;
  getAttendanceStatus.mockImplementation(jest.requireActual("../services/api/attendance.service").getAttendanceStatus);
  apiClient.get.mockImplementation(async url => url.includes("get_attendance_details")
    ? { data: { message: [{ log_type: "IN", time: wall(manualAt), employee: "HR-EMP-001" }] } }
    : { data: { message: { server_time: wall(clock) } } });
  await act(async () => { await mockFocus(); });
  expect((await readSession()).startedAt).toBe(manualAt);
  mockJournal = [nativeEvent("after-clock-reconcile-exit", "EXIT", 1, clock)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.filter(([, payload]) => payload.auto === true)).toHaveLength(1);
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("tenant changes during the session write cannot leave a foreign active session", async () => {
  const setItem = AsyncStorage.setItem.getMockImplementation();
  let switched = false;
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (!switched && key === SESSION_STATE_KEY && JSON.parse(value).status === "CHECKED_IN") {
      switched = true;
      await loginQueueEmployee(employeeId, "https://other.example.com");
    }
    return setItem(key, value);
  });
  try {
    mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
    await act(async () => { await mockHook.handlePrimaryAction(); });
    expect(switched).toBe(true);
    expect((await readSession()).status).toBe("CHECKED_OUT");
    expect(store.getState().attendance.checkin).toBe(false);
  } finally { AsyncStorage.setItem.mockImplementation(setItem); }
});

it("verified legacy manual ownership restores server time to the native clock before EXIT", async () => {
  const manualAt = clock;
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  await AsyncStorage.setItem(SESSION_OWNER_KEY, employeeId);
  await applySessionOwner(employeeId, { tenantKey: TEST_TENANT });
  getAttendanceStatus.mockImplementation(jest.requireActual("../services/api/attendance.service").getAttendanceStatus);
  apiClient.get.mockImplementation(async url => url.includes("get_attendance_details")
    ? { data: { message: [{ log_type: "IN", time: wall(manualAt), employee: "HR-EMP-001" }] } }
    : { data: { message: { server_time: wall(clock) } } });
  clock += 60000;
  mockJournal = [nativeEvent("legacy-owner-exit", "EXIT", 1, clock)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.filter(([, payload]) => payload.auto === true)).toHaveLength(1);
  expect((await readSession()).status).toBe("CHECKED_OUT");
});

it("manual IN survives remount, skips repeated ENTER and closes on one repeated EXIT", async () => {
  const manualAt = clock;
  const first = mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  first.unmount(); resetDatabaseHandle();
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  clock += 60000;
  mockJournal = [nativeEvent("late-enter", "ENTER", 1, manualAt - 1000),
    nativeEvent("repeat-enter", "ENTER", 2, manualAt + 1000),
    nativeEvent("restart-exit", "EXIT", 3, clock), nativeEvent("repeat-exit", "EXIT", 4, clock + 1)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.map(([, payload]) => payload.log_type)).toEqual(["IN", "OUT"]);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", startedAt: manualAt, origin: "MANUAL", closedBy: "AUTO" });
  expect(await listAll()).toEqual([]);
  expect((await findEvent("repeat-enter")).status).toBe("handled");
  expect((await findEvent("repeat-exit")).status).toBe("handled");
});

it("confirmed manual IN followed by offline EXIT synchronizes one original OUT on reconnect", async () => {
  const manualAt = clock;
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await mockHook.handlePrimaryAction(); });
  clock += 60000;
  fetchShouldAttemptRequest.mockResolvedValue(false);
  mockJournal = [nativeEvent("offline-manual-exit", "EXIT", 1, clock)];
  await drainAutoAttendanceEvents({ scope });
  const queued = await listAll();
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ action: "checkout", timestamp: wall(clock), sourceEventId: "offline-manual-exit", tenantKey: TEST_TENANT });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(await readSession()).toMatchObject({ status: "CHECKED_OUT", startedAt: manualAt });
  apiClient.post.mockResolvedValue({ data: { message: { inserted: ["OFFLINE-OUT"], failed: [] } } });
  fetchShouldAttemptRequest.mockResolvedValue(true);
  await Promise.all([syncPendingAttendance({ employeeId }), syncPendingAttendance({ employeeId })]);
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(apiClient.post.mock.calls[1][1].logs).toHaveLength(1);
  expect(apiClient.post.mock.calls[1][1].logs[0]).toMatchObject({ log_type: "OUT", timestamp: wall(clock) });
  expect((await listAll())[0]).toMatchObject({ status: "synced", acceptanceConfirmed: 1 });
});

it("status requested during manual upload cannot close its later accepted session", async () => {
  const manualAt = clock;
  let accept, answerStatus;
  apiClient.post.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  let manual, focus;
  act(() => { manual = mockHook.handlePrimaryAction(); });
  await waitFor(() => expect(accept).toBeDefined());
  clock += 10000;
  getAttendanceStatus.mockImplementationOnce(() => new Promise(resolve => { answerStatus = resolve; }));
  act(() => { focus = mockFocus(); });
  await waitFor(() => expect(answerStatus).toBeDefined());
  clock += 10000;
  await act(async () => { accept({ data: { message: { name: "MANUAL-IN" } } }); await manual; });
  clock += 10000;
  await act(async () => { answerStatus({ custom_in: 0 }); await focus; });
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", startedAt: manualAt });
  expect(store.getState().attendance.checkin).toBe(true);
  mockJournal = [nativeEvent("after-delayed-status-exit", "EXIT", 1, clock)];
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.map(([, payload]) => payload.log_type)).toEqual(["IN", "OUT"]);
});

it("camera skipped OUT after automatic EXIT reports the already-closed session", async () => {
  const seeded = await performManualAttendanceTransition({ type: "IN", employeeCode: employeeId,
    online: ({ scope, occurredAt }) => userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope, occurredAt }),
  });
  store.dispatch(setCheckin({ checkinTime: seeded.session.startedAt, sessionOrigin: "MANUAL" }));
  const getItem = AsyncStorage.getItem.getMockImplementation();
  let releasePreparation;
  AsyncStorage.getItem.mockImplementation(key => key === "restrict_location"
    ? new Promise(resolve => { releasePreparation = () => resolve("0"); }) : getItem(key));
  try {
    const screen = render(<Provider store={store}><AttendanceCamera /></Provider>);
    fireEvent.press(screen.getByLabelText("Take photo"));
    await waitFor(() => expect(screen.getByText("Check out")).toBeTruthy());
    fireEvent.press(screen.getByText("Check out"));
    await waitFor(() => expect(releasePreparation).toBeDefined());
    clock += 10000;
    mockJournal = [nativeEvent("before-camera-exit", "EXIT", 1, clock)];
    await drainAutoAttendanceEvents({ scope });
    await act(async () => { releasePreparation(); });
    await waitFor(() => expect(CameraToast.show).toHaveBeenCalledWith(expect.objectContaining({
      type: "info", text1: "Already checked out",
    })));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Attendance action");
    expect(apiClient.post.mock.calls.map(([, payload]) => payload.log_type)).toEqual(["IN", "OUT"]);
  } finally { AsyncStorage.getItem.mockImplementation(getItem); }
});

it("delayed manual OUT break cleanup cannot overwrite a newer automatic IN in Redux", async () => {
  const seeded = await performManualAttendanceTransition({ type: "IN", employeeCode: employeeId,
    online: ({ scope, occurredAt }) => userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope, occurredAt }),
  });
  store.dispatch(setCheckin({ checkinTime: seeded.session.startedAt, sessionOrigin: "MANUAL" }));
  await AsyncStorage.setItem("breakStartTime", String(clock));
  mount(); await waitFor(() => expect(mockHook.onBreak).toBe(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  let finishBreak;
  employeeBreak.mockImplementationOnce(() => new Promise(resolve => { finishBreak = resolve; }));
  clock += 10000;
  let manual;
  act(() => { manual = mockHook.handlePrimaryAction(); });
  await waitFor(() => expect(finishBreak).toBeDefined());
  expect(apiClient.post.mock.calls.map(([, payload]) => payload.log_type)).toEqual(["IN", "OUT"]);
  clock += 10000;
  mockJournal = [nativeEvent("newer-auto-enter", "ENTER", 1, clock)];
  await act(async () => { await drainAutoAttendanceEvents({ scope, onTransition: result => {
    store.dispatch(setCheckin({ checkinTime: result.session.startedAt, sessionOrigin: result.session.origin }));
  } }); });
  expect(store.getState().attendance.checkin).toBe(true);
  const displayedStates = [];
  const unsubscribe = store.subscribe(() => displayedStates.push(store.getState().attendance.checkin));
  await act(async () => { finishBreak({ allowed: true }); await manual; });
  unsubscribe();
  expect(displayedStates).not.toContain(false);
  expect(await readSession()).toMatchObject({ status: "CHECKED_IN", startedAt: clock, origin: "AUTO" });
  expect(store.getState().attendance).toMatchObject({ checkin: true, checkinTime: clock, sessionOrigin: "AUTO" });
});

it("the direct manual tap time survives asynchronous photo-mode preparation", async () => {
  const manualAt = clock;
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  const getItem = AsyncStorage.getItem.getMockImplementation();
  let releasePhotoMode;
  AsyncStorage.getItem.mockImplementation(key => key === "photo"
    ? new Promise(resolve => { releasePhotoMode = () => resolve("0"); }) : getItem(key));
  try {
    let manual;
    act(() => { manual = mockHook.handlePrimaryAction(); });
    await waitFor(() => expect(releasePhotoMode).toBeDefined());
    clock += 10000;
    mockJournal = [nativeEvent("during-manual-preparation-exit", "EXIT", 1, clock)];
    clock += 10000;
    await act(async () => { releasePhotoMode(); await manual; });
    await drainAutoAttendanceEvents({ scope });
    expect(apiClient.post.mock.calls.map(([, payload]) => payload.log_type)).toEqual(["IN", "OUT"]);
    expect((await readSession()).startedAt).toBe(manualAt);
  } finally { AsyncStorage.getItem.mockImplementation(getItem); }
});

it("status reconciliation removes a partial old-tenant session write", async () => {
  const setItem = AsyncStorage.setItem.getMockImplementation();
  let switched = false;
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (!switched && key === SESSION_STATE_KEY && JSON.parse(value).status === "CHECKED_IN") {
      switched = true;
      await loginQueueEmployee(employeeId, "https://other.example.com");
    }
    return setItem(key, value);
  });
  try {
    await expect(reconcileSessionFromServer({ activeStartedAt: clock - 1000,
      assertCurrent: () => assertAttendanceQueueScope(scope),
    })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
    expect((await readSession()).status).toBe("CHECKED_OUT");
    expect(await AsyncStorage.getItem("checkinStartTime")).toBeNull();
  } finally { AsyncStorage.setItem.mockImplementation(setItem); }
});

it("a scope change during owner persistence cannot leave an old active owner or submit IN", async () => {
  await AsyncStorage.removeItem(SESSION_OWNER_KEY);
  const setItem = AsyncStorage.setItem.getMockImplementation();
  let switched = false;
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (!switched && key === SESSION_OWNER_KEY) {
      switched = true;
      await loginQueueEmployee(employeeId, "https://other.example.com");
    }
    return setItem(key, value);
  });
  try {
    await expect(performManualAttendanceTransition({ type: "IN", employeeCode: employeeId,
      online: ({ scope, occurredAt }) => userCheckIn({ employeeCode: employeeId, type: "IN", syncScope: scope, occurredAt }),
    })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
    expect(await AsyncStorage.getItem(SESSION_OWNER_KEY)).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();
  } finally { AsyncStorage.setItem.mockImplementation(setItem); }
});

it("a delayed server-time lookup keeps the backend IN timestamp before a captured EXIT", async () => {
  const manualAt = clock;
  mount(); await waitFor(() => expect(mockHook.restrictionLoaded).toBe(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  let answerClock, held = false;
  apiClient.get.mockImplementation(url => {
    if (url.includes("get_server_time") && !held) {
      held = true;
      return new Promise(resolve => { answerClock = resolve; });
    }
    return Promise.resolve({ data: { message: { server_time: wall(clock) } } });
  });
  let manual;
  act(() => { manual = mockHook.handlePrimaryAction(); });
  await waitFor(() => expect(answerClock).toBeDefined());
  clock += 10000;
  mockJournal = [nativeEvent("during-time-lookup-exit", "EXIT", 1, clock)];
  clock += 10000;
  await act(async () => { answerClock({ data: { message: { server_time: wall(clock) } } }); await manual; });
  expect(await getServerOffset({ tenantKey: TEST_TENANT })).toBe(serverOffset);
  await drainAutoAttendanceEvents({ scope });
  expect(apiClient.post.mock.calls.map(([, payload]) => [payload.log_type, payload.timestamp])).toEqual([
    ["IN", wall(manualAt)], ["OUT", wall(manualAt + 10000)],
  ]);
});

it("a provided manual context cannot mutate ownership for another employee", async () => {
  const owner = await AsyncStorage.getItem(SESSION_OWNER_KEY);
  const online = jest.fn();
  await expect(performManualAttendanceTransition({ type: "IN", employeeCode: "OTHER-EMPLOYEE",
    context: { scope, occurredAt: clock }, online,
  })).rejects.toMatchObject({ code: "ATTENDANCE_SYNC_SCOPE_CHANGED" });
  expect(await AsyncStorage.getItem(SESSION_OWNER_KEY)).toBe(owner);
  expect(online).not.toHaveBeenCalled();
});
