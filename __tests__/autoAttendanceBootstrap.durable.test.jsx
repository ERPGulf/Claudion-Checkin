/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
const mockListeners = { enter: new Set(), exit: new Set(), error: new Set() };
let mockJournal = [];
let mockReconnect;
let mockStore;
jest.mock("../redux/Store", () => ({
  store: {
    getState: () => mockStore?.getState() ?? {},
    dispatch: action => mockStore?.dispatch(action),
  },
}));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main", isAvailable: () => true, supportsDurableEvents: () => true,
  getPendingEvents: jest.fn(() => [...mockJournal]),
  acknowledgeEvent: jest.fn(id => { mockJournal = mockJournal.filter(event => event.eventId !== id); return true; }),
  getRegisteredGeofences: jest.fn(() => []), isMonitoring: () => false, hasFullAccuracy: () => true,
  startGeofence: jest.fn(async () => {}), stopGeofence: jest.fn(async () => {}),
  addGeofenceEnterListener: listener => { mockListeners.enter.add(listener); return { remove: () => mockListeners.enter.delete(listener) }; },
  addGeofenceExitListener: listener => { mockListeners.exit.add(listener); return { remove: () => mockListeners.exit.delete(listener) }; },
  addErrorListener: listener => { mockListeners.error.add(listener); return { remove: () => mockListeners.error.delete(listener) }; },
}));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })), getCurrentPositionAsync: jest.fn(),
}));
jest.mock("../services/offline/NetworkListener", () => ({
  fetchShouldAttemptRequest: jest.fn(async () => false), isOnline: () => false,
  addReconnectListener: listener => { mockReconnect = listener; return () => { mockReconnect = null; }; },
}));
jest.mock("../services/offline/attendanceConfigCache", () => ({
  ...jest.requireActual("../services/offline/attendanceConfigCache"), refreshAttendanceConfig: jest.fn(),
}));
jest.mock("../services/api/attendance.service", () => ({
  ...jest.requireActual("../services/api/attendance.service"),
  getAttendanceStatus: jest.fn(async () => ({ custom_in: 0 })),
  getServerTime: jest.fn(async () => "2026-10-14 09:00:00"),
  resolveServerTimestampAt: jest.fn(async () => "2026-10-14 09:00:00"),
  autoCheckInOut: jest.fn(async () => ({ allowed: true, name: "SYNTHETIC-CHECKIN" })),
}));
jest.mock("../services/notifications/localNotifications", () => ({ presentLocalNotification: jest.fn(async () => {}) }));

import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Native from "../modules/expo-auto-attendance";
import AutoAttendanceBootstrap from "../components/AutoAttendanceBootstrap";
import RootReducer from "../redux/RootReducer";
import { setSignOut } from "../redux/Slices/AuthSlice";
import { setBaseUrl } from "../redux/Slices/UserSlice";
import { CONFIG_KEY, refreshAttendanceConfig } from "../services/offline/attendanceConfigCache";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { findEvent } from "../services/offline/AutoAttendanceEventRepository";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { createRegistrationId } from "../utils/autoAttendanceRegistration";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import {
  beginEmployeeAutoAttendancePolicyReception,
  receiveEmployeeAutoAttendancePolicy,
} from "../services/employeeAutoAttendancePolicy";
const { __resetAll } = require("../test-utils/expoSqliteMock");
let config;
let store;
const event = (id, transition, sequence, policy = 2) => {
  const snapshot = { tenantKey: TEST_TENANT, employeeId: "EMP-001", latitude: 25.28, longitude: 51.52, radius: 100, geotagging: policy };
  return { ...snapshot, eventId: id, sequence, transition, timestamp: Date.now() - 120000 + sequence * 1000,
    identifier: "office-main", nativeIdentifier: "physical-1", registrationId: createRegistrationId(snapshot) };
};
const mount = () => render(<Provider store={store}><AutoAttendanceBootstrap /></Provider>);
const receiveAutomaticAvailability = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, "EMP-001"),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: value } }),
}));
const receiveTenantGeo = (value, tenant = TEST_TENANT) => store.dispatch(settingsReceived({
  scope: buildSettingsScope(tenant, "EMP-001"),
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: value, auto_attendance: true } }),
}));
const receiveEmployeeMode = async mode => {
  const scope = await captureAttendanceQueueScope("EMP-001");
  return receiveEmployeeAutoAttendancePolicy({ geotagging: mode }, beginEmployeeAutoAttendancePolicyReception(scope));
};

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetOfflineCapability();
  await AsyncStorage.clear(); await loginQueueEmployee("EMP-001");
  mockJournal = []; Object.values(mockListeners).forEach(listeners => listeners.clear());
  jest.clearAllMocks();
  fetchShouldAttemptRequest.mockResolvedValue(false);
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  config = { employeeId: "EMP-001", tenantKey: TEST_TENANT, employeeDocname: "HR-EMP-001",
    rules: { geotagging: 2, photo: 0, restrictLocation: 1, unrestrictedCheckoutLocation: 0 },
    locations: [{ latitude: 25.28, longitude: 51.52, reporting_radius: 100, location: "Office" }] };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  refreshAttendanceConfig.mockImplementation(async () => ({ refreshed: false, config }));
  store = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: "EMP-001" } },
    autoAttendance: { geotagging: 2, userEnabled: true, syncRequestId: 0 },
  } });
  mockStore = store;
});

it("restores a denied automatic capability without registering or submitting a captured event", async () => {
  receiveAutomaticAvailability(false);
  mockJournal = [event("denied-cold-start", "ENTER", 1)];
  mount();
  await waitFor(async () => expect(await findEvent("denied-cold-start")).toMatchObject({ status: "pending" }));
  expect(await listAll()).toEqual([]);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.stopGeofence).toHaveBeenCalled();
});

it.each([false, 0, null])("tenant geo %s prevents employee mode 2 monitoring and captured-event attendance on cold start", async value => {
  await receiveEmployeeMode(2);
  receiveTenantGeo(value);
  mockJournal = [event("tenant-geo-disabled-cold-start", "ENTER", 1)];
  mount();
  await waitFor(async () => expect(await findEvent("tenant-geo-disabled-cold-start")).toMatchObject({ status: "pending" }));
  expect(await listAll()).toEqual([]);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.stopGeofence).toHaveBeenCalled();
  expect(store.getState().autoAttendance.employeePolicy.mode).toBe(2);
});

it("a geo-only disabling refresh stops monitoring and preserves later background receipts", async () => {
  receiveTenantGeo(2);
  mount();
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledTimes(1));
  Native.stopGeofence.mockClear();
  await act(async () => {
    store.dispatch(settingsReceived({ scope: buildSettingsScope(TEST_TENANT, "EMP-001"),
      settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: 0 } }) }));
  });
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  expect(store.getState().featureSettings.settings.attendance_action.auto_attendance).toBe(true);
  await act(async () => {
    mockJournal = [event("background-after-tenant-geo-disabled", "ENTER", 1)];
    mockListeners.enter.forEach(listener => listener(mockJournal[0]));
  });
  await waitFor(async () => expect(await findEvent("background-after-tenant-geo-disabled")).toMatchObject({ status: "pending" }));
  expect(await listAll()).toEqual([]);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("tenant geo revocation stops immediately while a scoped employee refresh remains pending", async () => {
  await receiveEmployeeMode(2);
  receiveTenantGeo(2);
  fetchShouldAttemptRequest.mockResolvedValue(true);
  let releaseRefresh;
  refreshAttendanceConfig.mockImplementation(() => new Promise(resolve => { releaseRefresh = resolve; }));
  mount();
  await waitFor(() => expect(releaseRefresh).toBeDefined());
  Native.stopGeofence.mockClear();
  await act(async () => { receiveTenantGeo(0); });
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  await act(async () => { releaseRefresh({ refreshed: false, config }); });
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
});

it("a tenant switch cannot apply another tenant's permitted geo policy to a pending native event", async () => {
  receiveTenantGeo(0);
  mockJournal = [event("tenant-a-revoked-crossing", "ENTER", 1)];
  mount();
  await waitFor(async () => expect(await findEvent("tenant-a-revoked-crossing")).toMatchObject({ status: "pending" }));
  const otherTenant = "https://other-attendance.example.test";
  config = { ...config, tenantKey: otherTenant };
  await act(async () => {
    await loginQueueEmployee("EMP-001", otherTenant);
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    store.dispatch(setBaseUrl(otherTenant));
    receiveTenantGeo(2, otherTenant);
    await receiveEmployeeMode(2);
  });
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledWith(
    expect.objectContaining({ tenantKey: otherTenant, geotagging: 2 }),
    expect.objectContaining({ tenantKey: otherTenant }),
  ));
  expect(await listAll()).toEqual([]);
  expect(await findEvent("tenant-a-revoked-crossing")).toMatchObject({ status: "pending", tenantKey: TEST_TENANT });
});

it("stops live monitoring on a received denial and retains later native callbacks", async () => {
  mount();
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledTimes(1));
  Native.stopGeofence.mockClear();
  await act(async () => { receiveAutomaticAvailability(false); });
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  await act(async () => {
    mockJournal = [event("after-denial", "ENTER", 1)];
    mockListeners.enter.forEach(listener => listener(mockJournal[0]));
  });
  await waitFor(async () => expect((await findEvent("after-denial"))?.status).toBe("pending"));
  expect(await listAll()).toEqual([]);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("stops immediately when a settings denial arrives during a pending employee refresh", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(true);
  let releaseRefresh;
  refreshAttendanceConfig.mockImplementation(() => new Promise(resolve => { releaseRefresh = resolve; }));
  mount();
  await waitFor(() => expect(refreshAttendanceConfig).toHaveBeenCalled());
  await act(async () => { receiveAutomaticAvailability(false); });
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  await act(async () => { releaseRefresh({ refreshed: false, config }); });
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
});

it("refreshes connected policy before replay so authoritative revocation creates no punch", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(true);
  mockJournal = [event("revoked-enter", "ENTER", 1)];
  const revoked = { ...config, locations: [], rules: { ...config.rules, geotagging: 0, restrictLocation: 0 } };
  refreshAttendanceConfig.mockImplementation(async () => {
    expect(await listAll()).toEqual([]);
    await receiveEmployeeMode(0);
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(revoked));
    return { refreshed: true, config: revoked };
  });
  mount();
  await waitFor(() => expect(store.getState().autoAttendance.geotagging).toBe(0));
  expect(await listAll()).toEqual([]);
  expect((await findEvent("revoked-enter")).status).toBe("pending");
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it.each([0, 1])("employee mode %s refuses fresh punches while mode 1 retains eligible monitoring", async mode => {
  await receiveEmployeeMode(mode);
  mockJournal = [event(`employee-mode-${mode}`, "ENTER", 1)];
  mount();
  await waitFor(async () => expect(await findEvent(`employee-mode-${mode}`)).not.toBeNull());
  expect(await listAll()).toEqual([]);
  if (mode === 0) {
    expect(Native.startGeofence).not.toHaveBeenCalled();
    expect(Native.stopGeofence).toHaveBeenCalled();
  } else {
    await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledWith(
      expect.objectContaining({ geotagging: 1 }), expect.objectContaining({ employeeId: "EMP-001" }),
    ));
  }
});

it("a new employee response authorizes mode 2 despite an older cached mode 0", async () => {
  config = { ...config, rules: { ...config.rules, geotagging: 0 } };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  await receiveEmployeeMode(2);
  mount();
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledWith(
    expect.objectContaining({ geotagging: 2 }), expect.objectContaining({ employeeId: "EMP-001" }),
  ));
  expect(store.getState().autoAttendance.employeePolicy.mode).toBe(2);
});

it("employee mode 0 stops monitoring while an older configuration refresh is pending", async () => {
  await receiveEmployeeMode(2);
  fetchShouldAttemptRequest.mockResolvedValue(true);
  let releaseRefresh;
  refreshAttendanceConfig.mockImplementation(() => new Promise(resolve => { releaseRefresh = resolve; }));
  mount();
  await waitFor(() => expect(refreshAttendanceConfig).toHaveBeenCalled());
  Native.stopGeofence.mockClear();
  await act(async () => { await receiveEmployeeMode(0); });
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  await act(async () => { releaseRefresh({ refreshed: false, config }); });
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(await listAll()).toEqual([]);
  expect(store.getState().autoAttendance.employeePolicy.mode).toBe(0);
});

it("updates live native monitoring to warnings-only without accepting a delayed punch", async () => {
  await receiveEmployeeMode(2);
  mount();
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledTimes(1));
  await act(async () => { await receiveEmployeeMode(1); });
  await waitFor(() => expect(Native.startGeofence).toHaveBeenLastCalledWith(
    expect.objectContaining({ geotagging: 1 }), expect.objectContaining({ employeeId: "EMP-001" }),
  ));
  await act(async () => {
    mockJournal = [event("delayed-after-employee-revocation", "ENTER", 1)];
    mockListeners.enter.forEach(listener => listener(mockJournal[0]));
  });
  await waitFor(async () => expect(await findEvent("delayed-after-employee-revocation")).not.toBeNull());
  expect(await listAll()).toEqual([]);
});

it("replays cached offline events without waiting for a network policy request", async () => {
  refreshAttendanceConfig.mockImplementation(() => new Promise(() => {}));
  mockJournal = [event("offline-enter", "ENTER", 1)];
  mount();
  await waitFor(async () => expect(await listAll()).toHaveLength(1));
  expect(refreshAttendanceConfig).not.toHaveBeenCalled();
});

it("replays both offline callbacks before registration without requesting a GPS fix", async () => {
  mockJournal = [event("enter", "ENTER", 1), event("exit", "EXIT", 2)];
  mount();
  await waitFor(async () => expect(await listAll()).toHaveLength(2));
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledTimes(1));
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(mockJournal).toEqual([]);
  expect(store.getState().attendance.checkin).toBe(false);
});

it("permission denial prevents registration but does not discard already captured events", async () => {
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
  mockJournal = [event("enter", "ENTER", 1), event("exit", "EXIT", 2)];
  mount();
  await waitFor(async () => expect(await listAll()).toHaveLength(2));
  await waitFor(() => expect(Native.stopGeofence).toHaveBeenCalled());
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("registration alone creates no attendance without an OS callback", async () => {
  mount();
  await waitFor(() => expect(Native.startGeofence).toHaveBeenCalledTimes(1));
  expect(await listAll()).toEqual([]);
  expect(store.getState().attendance.checkin).toBe(false);
});

it("live callbacks transfer from the journal and update the shared UI session", async () => {
  mount(); await waitFor(() => expect(Native.startGeofence).toHaveBeenCalled());
  await act(async () => {
    mockJournal = [event("live-enter", "ENTER", 1)];
    mockListeners.enter.forEach(listener => listener(mockJournal[0]));
  });
  await waitFor(() => expect(store.getState().attendance.checkin).toBe(true));
  expect((await findEvent("live-enter")).outcome.queued).toBe(true);
});

it("logout stops monitoring and leaves captured receipts isolated", async () => {
  mount(); await waitFor(() => expect(Native.startGeofence).toHaveBeenCalled());
  await act(async () => {
    mockJournal = [event("captured-before-logout", "ENTER", 1)];
    store.dispatch(setSignOut());
  });
  await waitFor(() => expect(Native.stopGeofence.mock.calls.length).toBeGreaterThan(1));
  expect(await listAll()).toEqual([]);
  expect((await findEvent("captured-before-logout")).status).toBe("pending");
});

it("reconnect retries durable receipts after missing scoped configuration is restored", async () => {
  await AsyncStorage.removeItem(CONFIG_KEY);
  refreshAttendanceConfig.mockResolvedValue({ config: null });
  mockJournal = [event("retained", "ENTER", 1)];
  mount(); await waitFor(async () => expect((await findEvent("retained"))?.status).toBe("pending"));
  expect(await listAll()).toEqual([]);
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  refreshAttendanceConfig.mockResolvedValue({ config });
  await act(async () => { mockReconnect(); });
  await waitFor(async () => expect(await listAll()).toHaveLength(1));
});
