/** @jest-environment jsdom */
jest.mock("expo-sqlite", () => require("../test-utils/expoSqliteMock"));
const mockListeners = { enter: new Set(), exit: new Set(), error: new Set() };
let mockJournal = [];
let mockReconnect;
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
import { CONFIG_KEY, refreshAttendanceConfig } from "../services/offline/attendanceConfigCache";
import { fetchShouldAttemptRequest } from "../services/offline/NetworkListener";
import { listAll } from "../services/offline/AttendanceQueueRepository";
import { findEvent } from "../services/offline/AutoAttendanceEventRepository";
import { resetDatabaseHandle } from "../services/offline/AttendanceDatabase";
import { resetOfflineCapability } from "../services/offline/offlineCapability";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { createRegistrationId } from "../utils/autoAttendanceRegistration";
const { __resetAll } = require("../test-utils/expoSqliteMock");
let config;
let store;
const event = (id, transition, sequence, policy = 2) => {
  const snapshot = { tenantKey: TEST_TENANT, employeeId: "EMP-001", latitude: 25.28, longitude: 51.52, radius: 100, geotagging: policy };
  return { ...snapshot, eventId: id, sequence, transition, timestamp: Date.now() - 120000 + sequence * 1000,
    identifier: "office-main", nativeIdentifier: "physical-1", registrationId: createRegistrationId(snapshot) };
};
const mount = () => render(<Provider store={store}><AutoAttendanceBootstrap /></Provider>);

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
});

it("refreshes connected policy before replay so authoritative revocation creates no punch", async () => {
  fetchShouldAttemptRequest.mockResolvedValue(true);
  mockJournal = [event("revoked-enter", "ENTER", 1)];
  const revoked = { ...config, locations: [], rules: { ...config.rules, geotagging: 0, restrictLocation: 0 } };
  refreshAttendanceConfig.mockImplementation(async () => {
    expect(await listAll()).toEqual([]);
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(revoked));
    return { refreshed: true, config: revoked };
  });
  mount();
  await waitFor(() => expect(store.getState().autoAttendance.geotagging).toBe(0));
  expect(await listAll()).toEqual([]);
  expect((await findEvent("revoked-enter")).status).toBe("pending");
  expect(Native.startGeofence).not.toHaveBeenCalled();
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
