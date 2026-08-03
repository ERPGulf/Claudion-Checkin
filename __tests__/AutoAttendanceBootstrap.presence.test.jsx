import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Presence reconciliation when monitoring starts.
 *
 * The regression these cover: enabling monitoring while already inside the office
 * used to do nothing until the OS happened to deliver an ENTER. It often never
 * did — Android's INITIAL_TRIGGER_ENTER is judged against a possibly stale
 * location estimate, and iOS's requestState answers `.unknown` when it has no
 * fix. Replay could not rescue it either, because it only ever reconsiders the
 * single last native event, which in that scenario was an already-handled EXIT.
 *
 * Unlike the sibling checkout suite, these tests drive the registration path
 * itself, so `isMonitoring` and `getOfficeLocation` are controllable here.
 */

const listeners = { onGeofenceEnter: [], onGeofenceExit: [] };

let mockNativeLastEvent = null;
let mockIsMonitoring = false;

jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  isAvailable: () => true,
  isMonitoring: () => mockIsMonitoring,
  startGeofence: jest.fn(() => {
    mockIsMonitoring = true;
    return Promise.resolve();
  }),
  stopGeofence: jest.fn(() => {
    mockIsMonitoring = false;
    return Promise.resolve();
  }),
  getLastEvent: () => mockNativeLastEvent,
  addGeofenceEnterListener: (listener) => {
    listeners.onGeofenceEnter.push(listener);
    return { remove: jest.fn() };
  },
  addGeofenceExitListener: (listener) => {
    listeners.onGeofenceExit.push(listener);
    return { remove: jest.fn() };
  },
}));

jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "granted" }),
  ),
  getBackgroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "granted" }),
  ),
}));

// The office as getOfficeLocation resolves it: a fresh GPS fix already reduced
// to a distance and a withinRadius verdict.
const OFFICE_INSIDE = {
  locationName: "ERPGulf HQ",
  latitude: 25.286106,
  longitude: 51.534817,
  radius: 100,
  distance: 18,
  withinRadius: true,
};

const OFFICE_OUTSIDE = { ...OFFICE_INSIDE, distance: 4200, withinRadius: false };

let mockOffice = OFFICE_INSIDE;

jest.mock("../services/api/attendance.service", () => ({
  autoCheckInOut: jest.fn(() =>
    Promise.resolve({ allowed: true, name: "EMP-CHKIN-001", location: null }),
  ),
  getOfficeLocation: jest.fn(() => Promise.resolve(mockOffice)),
}));

jest.mock("../services/api/employee.service", () => ({
  fetchEmployeeData: jest.fn(() => Promise.resolve({ geotagging: 2 })),
}));

jest.mock("../services/notifications/localNotifications", () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

import AutoAttendanceBootstrap from "../components/AutoAttendanceBootstrap";
import RootReducer from "../redux/RootReducer";
import {
  GEOTAGGING,
  requestAutoAttendanceSync,
} from "../redux/Slices/AutoAttendanceSlice";
import {
  autoCheckInOut,
  getOfficeLocation,
} from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { startGeofence } from "../modules/expo-auto-attendance";
import {
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  SESSION_STATUS,
} from "../utils/attendanceSessionState";
import { getLastProcessedEventAt } from "../utils/geofenceEventLog";

const EMPLOYEE_CODE = "HR-EMP-00011";

const buildStore = (geotagging = GEOTAGGING.ALL_ACTIONS) =>
  configureStore({
    reducer: RootReducer,
    preloadedState: {
      userAuth: { isLoggedIn: true, token: "tok" },
      user: { userDetails: { employeeCode: EMPLOYEE_CODE } },
      autoAttendance: { geotagging, userEnabled: true },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });

const manualCheckIn = (at) =>
  performSessionTransition({
    type: "IN",
    origin: SESSION_ORIGIN.MANUAL,
    at,
    execute: async () => ({ allowed: true, name: "MANUAL-001" }),
  });

describe("AutoAttendanceBootstrap presence reconciliation", () => {
  let store;

  const mountBootstrap = async (geotagging = GEOTAGGING.ALL_ACTIONS) => {
    const attached = listeners.onGeofenceExit.length + 1;
    store = buildStore(geotagging);
    render(
      <Provider store={store}>
        <AutoAttendanceBootstrap />
      </Provider>,
    );
    await waitFor(() =>
      expect(listeners.onGeofenceExit).toHaveLength(attached),
    );
  };

  /** Drains the startup chain so "nothing happened" means it decided not to. */
  const flushStartup = async () => {
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {});
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    listeners.onGeofenceEnter = [];
    listeners.onGeofenceExit = [];
    mockNativeLastEvent = null;
    mockIsMonitoring = false;
    mockOffice = OFFICE_INSIDE;
    fetchEmployeeData.mockResolvedValue({ geotagging: GEOTAGGING.ALL_ACTIONS });
    getOfficeLocation.mockImplementation(() => Promise.resolve(mockOffice));
    await AsyncStorage.clear();
  });

  // The reported scenario: monitoring was enabled outside, turned off, the user
  // walked in, and turned it on again while already inside.
  it("checks in when monitoring starts while the user is already inside", async () => {
    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeCode: EMPLOYEE_CODE,
        type: "IN",
        office: OFFICE_INSIDE,
      }),
    );

    const session = await readSession();
    expect(session).toMatchObject({
      status: SESSION_STATUS.CHECKED_IN,
      origin: SESSION_ORIGIN.AUTO,
    });

    expect(store.getState().attendance.checkin).toBe(true);
    expect(store.getState().attendance.sessionOrigin).toBe(SESSION_ORIGIN.AUTO);
  });

  it("registers the fence exactly once and then reconciles presence", async () => {
    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(startGeofence).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "office-main",
        latitude: OFFICE_INSIDE.latitude,
        radius: OFFICE_INSIDE.radius,
      }),
    );
  });

  // Recovery path for an ENTER the OS never delivered on an earlier launch: the
  // fence is already registered, so nothing re-registers, but presence still
  // runs. It also proves officeRef is populated on this path, so the log is
  // tagged with the office rather than going out bare.
  it("still reconciles presence when the fence is already registered", async () => {
    mockIsMonitoring = true;

    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(startGeofence).not.toHaveBeenCalled();
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: "IN", office: OFFICE_INSIDE }),
    );
  });

  it("does not check in again when a session is already open", async () => {
    await manualCheckIn();

    await mountBootstrap();
    await flushStartup();

    expect(autoCheckInOut).not.toHaveBeenCalled();
    const session = await readSession();
    expect(session.status).toBe(SESSION_STATUS.CHECKED_IN);
    expect(session.origin).toBe(SESSION_ORIGIN.MANUAL);
  });

  it("does nothing when the fix puts the user outside the office", async () => {
    mockOffice = OFFICE_OUTSIDE;

    await mountBootstrap();
    await flushStartup();

    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
  });

  // Presence is not a geofence transition. Advancing the high-water mark from it
  // would mark a native event that has not been replayed yet as handled.
  it("does not advance the replay high-water mark", async () => {
    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(await getLastProcessedEventAt()).toBeNull();
  });

  it("leaves a later native EXIT replayable after a presence check-in", async () => {
    await mountBootstrap();
    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));

    // The user leaves; the OS records it while JS is not running.
    const leftAt = Date.now();
    mockNativeLastEvent = {
      transition: "EXIT",
      identifier: "office-main",
      timestamp: leftAt,
    };
    mockOffice = OFFICE_OUTSIDE;
    autoCheckInOut.mockClear();

    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: "OUT", occurredAt: leftAt }),
    );
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
  });

  // Replay runs first so the log carries the real crossing time; presence would
  // only ever be able to claim "now".
  it("prefers a replayed ENTER's crossing time over now", async () => {
    const enteredAt = Date.now() - 25 * 60 * 1000;
    mockNativeLastEvent = {
      transition: "ENTER",
      identifier: "office-main",
      timestamp: enteredAt,
    };

    await mountBootstrap();

    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: "IN", occurredAt: enteredAt }),
    );
    expect((await readSession()).startedAt).toBe(enteredAt);

    // Presence saw the session was already open and stood down.
    await flushStartup();
    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  });

  it("never logs under the warnings-only policy", async () => {
    fetchEmployeeData.mockResolvedValue({
      geotagging: GEOTAGGING.WARNINGS_ONLY,
    });

    await mountBootstrap(GEOTAGGING.WARNINGS_ONLY);
    await flushStartup();

    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    // Still not a transition, so the mark stays put here too.
    expect(await getLastProcessedEventAt()).toBeNull();
  });

  // The bootstrap is the sole registrar, so overlapping runs of its effect must
  // not both register. Without the serialized startup chain both would observe
  // isMonitoring() === false while the first is still awaiting getOfficeLocation.
  it("registers once when a sync is requested while registration is in flight", async () => {
    // Registration is held open, so `isMonitoring()` is still false for as long
    // as it is pending — exactly the window in which a second, unserialized run
    // would register the same fence again.
    let releaseRegistration;
    startGeofence.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRegistration = () => {
            mockIsMonitoring = true;
            resolve();
          };
        }),
    );

    await mountBootstrap();
    await waitFor(() => expect(startGeofence).toHaveBeenCalledTimes(1));

    await act(async () => {
      store.dispatch(requestAutoAttendanceSync());
    });
    // Give an unserialized second run every chance to reach startGeofence.
    await flushStartup();
    expect(startGeofence).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseRegistration();
    });
    await flushStartup();

    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
  });

  it("registers after a sync request once permission is granted late", async () => {
    // eslint-disable-next-line global-require
    const Location = require("expo-location");
    Location.getBackgroundPermissionsAsync.mockResolvedValueOnce({
      status: "denied",
    });

    await mountBootstrap();
    await flushStartup();
    expect(startGeofence).not.toHaveBeenCalled();

    // The screen granted permission and asks the bootstrap to try again.
    await act(async () => {
      store.dispatch(requestAutoAttendanceSync());
    });

    await waitFor(() => expect(startGeofence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
  });

  it("does nothing when location permission has not been granted", async () => {
    // eslint-disable-next-line global-require
    const Location = require("expo-location");
    Location.getBackgroundPermissionsAsync.mockResolvedValueOnce({
      status: "denied",
    });

    await mountBootstrap();
    await flushStartup();

    expect(startGeofence).not.toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });
});
