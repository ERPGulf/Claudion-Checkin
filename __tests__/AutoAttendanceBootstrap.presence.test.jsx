import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";

let mockStore;
jest.mock("../redux/Store", () => ({
  store: {
    getState: () => mockStore?.getState() ?? {},
    dispatch: action => mockStore?.dispatch(action),
  },
}));

/**
 * Presence reconciliation when monitoring starts.
 *
 * These legacy-binary regressions now require an OS event for attendance. Previously, enabling monitoring while already inside the office
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

// What the server says about the open session. `custom_in: 0` is "no open
// session", which is the state every pre-existing test here assumed.
let mockServerStatus = { custom_in: 0 };

// The outbox, as reconcilePresence sees it. All zero means "the server has seen
// everything this device did", which is what every pre-existing test assumes.
//
// Both fields are supplied because they differ in exactly the case that matters:
// an `endpoint-missing` row is awaiting the server but can never reach it, so it
// is counted by the first and not the second.
let mockQueueCounts = { awaitingServerCount: 0, mayAffectServerCount: 0 };

jest.mock("../services/offline/AttendanceQueueService", () => ({
  getQueueCounts: jest.fn(() => Promise.resolve(mockQueueCounts)),
  // Passes straight through to the mocked API, so these suites keep asserting
  // on `autoCheckInOut` exactly as they did.
  submitAutoAttendance: jest.fn(({ online }) => online()),
}));

jest.mock("../services/offline/BackgroundSyncManager", () => ({
  syncNow: jest.fn(() => Promise.resolve({ ran: false })),
}));

jest.mock("../services/api/attendance.service", () => ({
  // Server-side session authority. `reconcilePresence` consults it before
  // opening a session, so every suite that mounts the bootstrap has to answer.
  getAttendanceStatus: jest.fn(() => Promise.resolve(mockServerStatus)),
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
  setAutoAttendanceUserEnabled,
} from "../redux/Slices/AutoAttendanceSlice";
import {
  autoCheckInOut,
  getOfficeLocation,
} from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { startGeofence, stopGeofence } from "../modules/expo-auto-attendance";
import {
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  SESSION_STATUS,
} from "../utils/attendanceSessionState";
import { getLastProcessedEventAt } from "../utils/geofenceEventLog";
import { getAttendanceStatus } from "../services/api/attendance.service";
import { syncNow } from "../services/offline/BackgroundSyncManager";
import { getQueueCounts } from "../services/offline/AttendanceQueueService";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import {
  beginEmployeeAutoAttendancePolicyReception,
  receiveEmployeeAutoAttendancePolicy,
} from "../services/employeeAutoAttendancePolicy";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";

const EMPLOYEE_CODE = "HR-EMP-00011";

const buildStore = (geotagging = GEOTAGGING.ALL_ACTIONS) => {
  mockStore = configureStore({
    reducer: RootReducer,
    preloadedState: {
      userAuth: { isLoggedIn: true, token: "tok" },
      user: { baseUrl: "https://fixture.example.test", userDetails: { employeeCode: EMPLOYEE_CODE } },
      autoAttendance: { geotagging, userEnabled: true },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  return mockStore;
};

const manualCheckIn = (at) =>
  performSessionTransition({
    type: "IN",
    origin: SESSION_ORIGIN.MANUAL,
    at,
    execute: async () => ({ allowed: true, name: "MANUAL-001" }),
  });

describe("AutoAttendanceBootstrap presence reconciliation", () => {
  let store;

  const receiveTenantGeo = value => store.dispatch(settingsReceived({
    scope: buildSettingsScope("https://fixture.example.test", EMPLOYEE_CODE),
    settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: value, auto_attendance: true } }),
  }));

  const mountBootstrap = async (geotagging = GEOTAGGING.ALL_ACTIONS) => {
    const attached = listeners.onGeofenceExit.length + 1;
    store = buildStore(geotagging);
    const scope = await captureAttendanceQueueScope(EMPLOYEE_CODE);
    await receiveEmployeeAutoAttendancePolicy({ geotagging }, beginEmployeeAutoAttendancePolicyReception(scope));
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
    mockQueueCounts = { awaitingServerCount: 0, mayAffectServerCount: 0 };
    mockServerStatus = { custom_in: 0 };
    fetchEmployeeData.mockResolvedValue({ geotagging: GEOTAGGING.ALL_ACTIONS });
    getOfficeLocation.mockImplementation(() => Promise.resolve(mockOffice));
    await AsyncStorage.clear();
    await AsyncStorage.multiSet([
      ["baseUrl", "https://fixture.example.test"],
      ["employee_code", EMPLOYEE_CODE],
      ["access_token", "fixture-access"],
    ]);
  });

  it.each([false, 0, null])("tenant geo %s prevents employee mode 2 legacy monitoring on login", async value => {
    store = buildStore();
    const scope = await captureAttendanceQueueScope(EMPLOYEE_CODE);
    await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(scope));
    receiveTenantGeo(value);
    render(<Provider store={store}><AutoAttendanceBootstrap /></Provider>);
    await flushStartup();
    expect(stopGeofence).toHaveBeenCalled();
    expect(startGeofence).not.toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(store.getState().autoAttendance.employeePolicy.mode).toBe(2);
  });

  it("does not register after tenant geo is revoked during the office/GPS wait", async () => {
    let releaseOffice;
    getOfficeLocation.mockImplementationOnce(() => new Promise(resolve => { releaseOffice = resolve; }));
    await mountBootstrap();
    await waitFor(() => expect(releaseOffice).toBeDefined());
    await act(async () => { receiveTenantGeo(0); });
    await act(async () => { releaseOffice(OFFICE_INSIDE); });
    await flushStartup();
    expect(startGeofence).not.toHaveBeenCalled();
    expect(stopGeofence).toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  it("removes a late legacy native registration after tenant geo revocation", async () => {
    let releaseStart;
    startGeofence.mockImplementationOnce(() => new Promise(resolve => {
      releaseStart = () => { mockIsMonitoring = true; resolve(); };
    }));
    await mountBootstrap();
    await waitFor(() => expect(releaseStart).toBeDefined());
    await act(async () => { receiveTenantGeo(0); });
    await act(async () => { releaseStart(); });
    await flushStartup();
    expect(mockIsMonitoring).toBe(false);
    expect(stopGeofence).toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  it("does not register after employee mode 0 arrives during the office/GPS wait", async () => {
    let releaseOffice;
    getOfficeLocation.mockImplementationOnce(() => new Promise(resolve => { releaseOffice = resolve; }));
    await mountBootstrap();
    await waitFor(() => expect(releaseOffice).toBeDefined());
    await act(async () => {
      const scope = await captureAttendanceQueueScope(EMPLOYEE_CODE);
      await receiveEmployeeAutoAttendancePolicy({ geotagging: 0 }, beginEmployeeAutoAttendancePolicyReception(scope));
    });
    await act(async () => { releaseOffice(OFFICE_INSIDE); });
    await flushStartup();
    expect(startGeofence).not.toHaveBeenCalled();
    expect(stopGeofence).toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  it("removes a native registration completed after employee mode 0 was received", async () => {
    let releaseStart;
    startGeofence.mockImplementationOnce(() => new Promise(resolve => {
      releaseStart = () => { mockIsMonitoring = true; resolve(); };
    }));
    await mountBootstrap();
    await waitFor(() => expect(releaseStart).toBeDefined());
    await act(async () => {
      const scope = await captureAttendanceQueueScope(EMPLOYEE_CODE);
      await receiveEmployeeAutoAttendancePolicy({ geotagging: 0 }, beginEmployeeAutoAttendancePolicyReception(scope));
    });
    await act(async () => { releaseStart(); });
    await flushStartup();
    expect(mockIsMonitoring).toBe(false);
    expect(stopGeofence).toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  it("keeps monitoring stopped when the user opts out during native registration", async () => {
    let releaseStart;
    startGeofence.mockImplementationOnce(() => new Promise(resolve => {
      releaseStart = () => { mockIsMonitoring = true; resolve(); };
    }));
    await mountBootstrap();
    await waitFor(() => expect(releaseStart).toBeDefined());
    await act(async () => { store.dispatch(setAutoAttendanceUserEnabled(false)); });
    await act(async () => { releaseStart(); });
    await flushStartup();
    expect(mockIsMonitoring).toBe(false);
    expect(stopGeofence).toHaveBeenCalled();
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  // The reported scenario: monitoring was enabled outside, turned off, the user
  // walked in, and turned it on again while already inside.
  it("does not manufacture IN from an inside location snapshot", async () => {
    await mountBootstrap();
    await flushStartup();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(store.getState().attendance.checkin).toBe(false);
  });

  it("registers the fence exactly once and then reconciles presence", async () => {
    await mountBootstrap();

    await flushStartup();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(startGeofence).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "office-main",
        latitude: OFFICE_INSIDE.latitude,
        radius: OFFICE_INSIDE.radius,
      }),
      expect.objectContaining({ tenantKey: "https://fixture.example.test", employeeId: EMPLOYEE_CODE }),
    );
  });

  // Recovery path for an ENTER the OS never delivered on an earlier launch: the
  // fence is already registered, so nothing re-registers, but presence still
  // runs. It also proves officeRef is populated on this path, so the log is
  // tagged with the office rather than going out bare.
  it("still reconciles presence when the fence is already registered", async () => {
    mockIsMonitoring = true;

    await mountBootstrap();

    await flushStartup();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(startGeofence).not.toHaveBeenCalled();
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

    await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(await getLastProcessedEventAt()).toBeNull();
  });

  it("retains a later unowned native EXIT without closing the manual check-in", async () => {
    await performSessionTransition({ type: "IN", origin: SESSION_ORIGIN.MANUAL,
      at: Date.now() - 60000, execute: async () => ({ allowed: true }) });
    await mountBootstrap();
    await flushStartup();

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

    await flushStartup();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    expect(await getLastProcessedEventAt()).toBeNull();
    expect(mockNativeLastEvent.timestamp).toBe(leftAt);
  });

  // Replay runs first so the log carries the real crossing time; presence would
  // only ever be able to claim "now".
  it("does not replace an unowned historical ENTER with a presence-based check-in", async () => {
    const enteredAt = Date.now() - 25 * 60 * 1000;
    mockNativeLastEvent = {
      transition: "ENTER",
      identifier: "office-main",
      timestamp: enteredAt,
    };

    await mountBootstrap();

    await flushStartup();
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(await getLastProcessedEventAt()).toBeNull();
    expect(mockNativeLastEvent.timestamp).toBe(enteredAt);
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
    expect(autoCheckInOut).not.toHaveBeenCalled();
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
    await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
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

  /**
   * The production duplicate-IN, reproduced at the point where it was decided.
   *
   * Presence reconciliation used to check in on two facts: the device is inside
   * the fence, and the local record says CHECKED_OUT. After an authentication
   * recovery neither of those says anything about the server, and the employee
   * ended the day with two INs and no OUT.
   */
  describe("does not trust a local CHECKED_OUT after an auth recovery", () => {
    it("waits for a queued punch to sync instead of opening a new session", async () => {
      // The queued automatic check-out that survived the forced logout. The
      // server still has the morning's session open; it just does not know yet.
      mockQueueCounts = { awaitingServerCount: 1, mayAffectServerCount: 1 };
      syncNow.mockImplementation(() => Promise.resolve({ ran: false }));

      await mountBootstrap();
      await flushStartup();

      expect(syncNow).toHaveBeenCalled();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    });

    it("continues once the queued punch has drained", async () => {
      mockAwaitingServerCount = 1;
      // The drain lands: the server now knows about the check-out, and says the
      // session is closed. A fresh check-in is a real new session, not a
      // duplicate.
      syncNow.mockImplementation(async () => {
        mockQueueCounts = { awaitingServerCount: 0, mayAffectServerCount: 0 };
        return { ran: true, synced: 1 };
      });

      await mountBootstrap();

      await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    it("restores the server's open session rather than checking in again", async () => {
      // Nothing queued, but the server still holds the morning's session — the
      // exact state a deleted queue used to leave behind.
      mockServerStatus = { custom_in: 1, checkin_time: "2026-09-01 07:54:00" };

      await mountBootstrap();
      await flushStartup();

      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
      expect(store.getState().attendance.checkin).toBe(true);
    });

    it("waits for an OS event when the server confirms no session is open", async () => {
      mockServerStatus = { custom_in: 0 };

      await mountBootstrap();

      await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    // "No answer" is not "no session" — but with an empty outbox the local
    // record is the best evidence there is, and refusing here would break the
    // offline check-in the queue exists to serve.
    it("falls back to the local record when the server cannot be reached and nothing is queued", async () => {
      mockServerStatus = { custom_in: 0, unavailable: true };

      await mountBootstrap();

      await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    it("does not consult the server at all when a session is already open locally", async () => {
      await manualCheckIn(Date.now() - 60_000);

      await mountBootstrap();
      await flushStartup();

      expect(getAttendanceStatus).not.toHaveBeenCalled();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    // The deadlock guard. An `endpoint-missing` row is awaiting the server and
    // always will be, so gating on `awaitingServerCount` would disable automatic
    // check-in permanently on any tenant without the offline endpoint deployed.
    it("is not held shut by a row that can never be delivered", async () => {
      mockQueueCounts = { awaitingServerCount: 1, mayAffectServerCount: 0 };

      await mountBootstrap();

      await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      // Nothing to drain, so it should not have bothered trying.
      expect(syncNow).not.toHaveBeenCalled();
    });

    it("is still held shut by a row that can be delivered", async () => {
      // Blocked on auth or configuration: resolves by itself, so the server's
      // view of the session is genuinely unsettled until it does.
      mockQueueCounts = { awaitingServerCount: 1, mayAffectServerCount: 1 };
      syncNow.mockImplementation(() => Promise.resolve({ ran: false }));

      await mountBootstrap();
      await flushStartup();

      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    // The server holds a session open but names a start the local check-out
    // floor rejects — exactly what a queued-then-lost OUT leaves behind. The
    // restore is best-effort; refusing to check in is not.
    it("still refuses to check in when the open session cannot be dated", async () => {
      mockServerStatus = { custom_in: 1 }; // no usable checkin_time

      await mountBootstrap();
      await flushStartup();

      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    it("does not manufacture attendance when the queue cannot be read", async () => {
      getQueueCounts.mockRejectedValueOnce(new Error("database locked"));

      await mountBootstrap();

      await flushStartup();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });
  });
});
