import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Native geofencing module: capture the ENTER/EXIT listeners the component
// attaches so the tests can fire real transitions at it.
const listeners = { onGeofenceEnter: [], onGeofenceExit: [] };

// The transition native persisted while JS was not running, if any.
let mockNativeLastEvent = null;

jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  isAvailable: () => true,
  isMonitoring: () => true, // already registered — skip the (re)start path
  startGeofence: jest.fn(() => Promise.resolve()),
  stopGeofence: jest.fn(() => Promise.resolve()),
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

jest.mock("../services/api/attendance.service", () => ({
  autoCheckInOut: jest.fn(() =>
    Promise.resolve({ allowed: true, name: "EMP-CHKIN-001", location: null }),
  ),
  getOfficeLocation: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../services/api/employee.service", () => ({
  fetchEmployeeData: jest.fn(() => Promise.resolve({ geotagging: 2 })),
}));

jest.mock("../services/notifications/localNotifications", () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

import AutoAttendanceBootstrap from "../components/AutoAttendanceBootstrap";
import RootReducer from "../redux/RootReducer";
import { GEOTAGGING } from "../redux/Slices/AutoAttendanceSlice";
import { autoCheckInOut } from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { stopGeofence } from "../modules/expo-auto-attendance";
import { presentLocalNotification } from "../services/notifications/localNotifications";
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
      autoAttendance: {
        geotagging,
        userEnabled: true,
      },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });

/** Performs a manual check-in exactly as the attendance screens do. */
const manualCheckIn = (at) =>
  performSessionTransition({
    type: "IN",
    origin: SESSION_ORIGIN.MANUAL,
    at,
    execute: async () => ({ allowed: true, name: "MANUAL-001" }),
  });

const manualCheckOut = () =>
  performSessionTransition({
    type: "OUT",
    origin: SESSION_ORIGIN.MANUAL,
    execute: async () => ({ allowed: true, name: "MANUAL-002" }),
  });

// A realistic timeline: checked in this morning, left 90 minutes ago.
const startedWorkAt = () => Date.now() - 4 * 60 * 60 * 1000;
const leftTheOfficeAt = () => Date.now() - 90 * 60 * 1000;

const fireGeofence = async (transition) => {
  const event = {
    identifier: "office-main",
    transition,
    timestamp: Date.now(),
  };
  await Promise.all(
    listeners[
      transition === "ENTER" ? "onGeofenceEnter" : "onGeofenceExit"
    ].map((listener) => listener(event)),
  );
};

describe("AutoAttendanceBootstrap geofence transitions", () => {
  let store;

  /** Renders the bootstrap under a given server policy. */
  const renderBootstrap = (geotagging = GEOTAGGING.ALL_ACTIONS) => {
    store = buildStore(geotagging);
    render(
      <Provider store={store}>
        <AutoAttendanceBootstrap />
      </Provider>,
    );
  };

  /** Mounts the bootstrap and waits until it is listening. */
  const mountBootstrap = async (geotagging = GEOTAGGING.ALL_ACTIONS) => {
    const attached = listeners.onGeofenceExit.length + 1;

    renderBootstrap(geotagging);

    await waitFor(() =>
      expect(listeners.onGeofenceExit).toHaveLength(attached),
    );
  };

  /**
   * Drains the launch-time replay chain, so a "nothing happened" assertion is
   * about the replay having decided to do nothing rather than about it not
   * having run yet.
   */
  const flushReplay = async () => {
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {});
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    listeners.onGeofenceEnter = [];
    listeners.onGeofenceExit = [];
    mockNativeLastEvent = null;
    // clearAllMocks keeps implementations, so restore the policy baseline.
    fetchEmployeeData.mockResolvedValue({ geotagging: GEOTAGGING.ALL_ACTIONS });
    await AsyncStorage.clear();
  });

  describe("live transitions", () => {
    beforeEach(mountBootstrap);

    // Scenario 2: manual check-in → automatic check-out.
    it("checks out automatically when the user leaves after checking in manually", async () => {
      await manualCheckIn();

      await fireGeofence("EXIT");

      expect(autoCheckInOut).toHaveBeenCalledTimes(1);
      expect(autoCheckInOut).toHaveBeenCalledWith(
        expect.objectContaining({ employeeCode: EMPLOYEE_CODE, type: "OUT" }),
      );

      const session = await readSession();
      expect(session).toMatchObject({
        status: SESSION_STATUS.CHECKED_OUT,
        origin: SESSION_ORIGIN.MANUAL,
        closedBy: SESSION_ORIGIN.AUTO,
      });

      const state = store.getState().attendance;
      expect(state.checkin).toBe(false);
      expect(state.checkoutTime).toBe(session.endedAt);

      expect(presentLocalNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            "your check-in was closed automatically",
          ),
        }),
      );
    });

    // Scenario 1: manual check-in → manual check-out, before leaving.
    it("does not check out again when the user already checked out manually", async () => {
      await manualCheckIn();
      await manualCheckOut();

      await fireGeofence("EXIT");

      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    // Scenario 3: the existing fully automatic flow is unchanged.
    it("still checks in on ENTER and out on EXIT with no manual action", async () => {
      await fireGeofence("ENTER");

      expect(autoCheckInOut).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "IN" }),
      );
      expect(store.getState().attendance.checkin).toBe(true);
      expect(store.getState().attendance.sessionOrigin).toBe(
        SESSION_ORIGIN.AUTO,
      );

      await fireGeofence("EXIT");

      expect(autoCheckInOut).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "OUT" }),
      );
      expect(autoCheckInOut).toHaveBeenCalledTimes(2);
      expect(store.getState().attendance.checkin).toBe(false);
      expect(presentLocalNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            "you've been checked out automatically",
          ),
        }),
      );
    });

    it("ignores a re-entry into the office while a manual session is open", async () => {
      await manualCheckIn();

      await fireGeofence("ENTER");

      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).origin).toBe(SESSION_ORIGIN.MANUAL);
    });

    it("does not duplicate the check-out when EXIT fires twice", async () => {
      await manualCheckIn();

      await Promise.all([fireGeofence("EXIT"), fireGeofence("EXIT")]);

      expect(autoCheckInOut).toHaveBeenCalledTimes(1);
    });

    it("leaves the session open when the automatic check-out is refused", async () => {
      await manualCheckIn();
      autoCheckInOut.mockResolvedValueOnce({
        allowed: false,
        message: "Failed to register automatic attendance",
      });

      await fireGeofence("EXIT");

      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
      expect(presentLocalNotification).not.toHaveBeenCalled();

      // The next EXIT retries, since the session is still open.
      await fireGeofence("EXIT");
      expect(autoCheckInOut).toHaveBeenCalledTimes(2);
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    });
  });

  // The OS delivers transitions to native code even with the app killed, but
  // the attendance call needs JS. These cover picking that up at next launch.
  describe("replay of a transition missed while JS was not running", () => {

    it("checks out at launch using the time the user actually left", async () => {
      await manualCheckIn(startedWorkAt());
      const occurredAt = leftTheOfficeAt();
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: occurredAt,
      };

      await mountBootstrap();

      await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
      expect(autoCheckInOut).toHaveBeenCalledWith(
        expect.objectContaining({ type: "OUT", occurredAt }),
      );

      const session = await readSession();
      expect(session).toMatchObject({
        status: SESSION_STATUS.CHECKED_OUT,
        origin: SESSION_ORIGIN.MANUAL,
        closedBy: SESSION_ORIGIN.AUTO,
        // Backdated to the crossing, not to app launch.
        endedAt: occurredAt,
      });
    });

    it("does not replay the same event on the next launch", async () => {
      await manualCheckIn(startedWorkAt());
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: leftTheOfficeAt(),
      };

      await mountBootstrap();
      await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));

      // Second launch, same native record, and the user has checked in again.
      await manualCheckIn(startedWorkAt());
      autoCheckInOut.mockClear();
      await mountBootstrap();

      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("does not replay a live event that was already handled", async () => {
      await manualCheckIn();
      const occurredAt = Date.now();

      await mountBootstrap();
      await fireGeofence("EXIT");
      expect(autoCheckInOut).toHaveBeenCalledTimes(1);

      // Native recorded the same transition the live listener just handled.
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: occurredAt,
      };
      autoCheckInOut.mockClear();

      await mountBootstrap();

      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
    });

    it("discards a transition older than the replay window", async () => {
      await manualCheckIn();
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: Date.now() - 30 * 60 * 60 * 1000,
      };

      await mountBootstrap();

      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      // Recorded as handled so it is not reconsidered on every later launch.
      expect(await getLastProcessedEventAt()).toBe(
        mockNativeLastEvent.timestamp,
      );
      // Left open for the user to resolve rather than silently backdated.
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("retries at the next launch when the replayed call fails", async () => {
      await manualCheckIn(startedWorkAt());
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: leftTheOfficeAt(),
      };
      autoCheckInOut.mockResolvedValueOnce({
        allowed: false,
        message: "Network down",
      });

      await mountBootstrap();
      await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);

      autoCheckInOut.mockClear();
      await mountBootstrap();

      await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    });

    it("discards an EXIT that predates the session currently open", async () => {
      // A manual check-in won the race against the launch replay: the crossing
      // happened before the session it would otherwise close.
      const occurredAt = Date.now() - 90 * 60 * 1000;
      await manualCheckIn();
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: occurredAt,
      };

      await mountBootstrap();

      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect(await getLastProcessedEventAt()).toBe(occurredAt);

      const session = await readSession();
      expect(session.status).toBe(SESSION_STATUS.CHECKED_IN);
      expect(session.startedAt).toBeGreaterThan(occurredAt);
    });

    it("replays a missed ENTER as a check-in", async () => {
      const occurredAt = Date.now() - 20 * 60 * 1000;
      mockNativeLastEvent = {
        transition: "ENTER",
        identifier: "office-main",
        timestamp: occurredAt,
      };

      await mountBootstrap();

      await waitFor(() => expect(autoCheckInOut).toHaveBeenCalledTimes(1));
      expect(autoCheckInOut).toHaveBeenCalledWith(
        expect.objectContaining({ type: "IN", occurredAt }),
      );
      expect((await readSession()).startedAt).toBe(occurredAt);
    });

    it("ignores a missed ENTER when the user is already checked in", async () => {
      await manualCheckIn();
      mockNativeLastEvent = {
        transition: "ENTER",
        identifier: "office-main",
        timestamp: Date.now() - 20 * 60 * 1000,
      };

      await mountBootstrap();

      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).origin).toBe(SESSION_ORIGIN.MANUAL);
    });
  });

  // The server-side `geotagging` policy: 0 disabled, 1 warnings only,
  // 2 all attendance actions.
  describe("geotagging policy levels", () => {
    it("never monitors or logs when the policy is disabled", async () => {
      fetchEmployeeData.mockResolvedValue({ geotagging: GEOTAGGING.DISABLED });
      await manualCheckIn(startedWorkAt());
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: leftTheOfficeAt(),
      };

      renderBootstrap(GEOTAGGING.DISABLED);
      await flushReplay();

      expect(listeners.onGeofenceExit).toHaveLength(0);
      expect(stopGeofence).toHaveBeenCalled();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("detects a crossing under warnings-only but never turns it into a log", async () => {
      fetchEmployeeData.mockResolvedValue({
        geotagging: GEOTAGGING.WARNINGS_ONLY,
      });
      await manualCheckIn(startedWorkAt());

      await mountBootstrap(GEOTAGGING.WARNINGS_ONLY);
      await fireGeofence("EXIT");

      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("does not replay a warnings-only crossing after the policy is raised", async () => {
      fetchEmployeeData.mockResolvedValue({
        geotagging: GEOTAGGING.WARNINGS_ONLY,
      });
      await manualCheckIn(startedWorkAt());
      mockNativeLastEvent = {
        transition: "EXIT",
        identifier: "office-main",
        timestamp: leftTheOfficeAt(),
      };

      // Launch under "warnings only": the crossing is recorded as handled.
      await mountBootstrap(GEOTAGGING.WARNINGS_ONLY);
      await flushReplay();
      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect(await getLastProcessedEventAt()).toBe(
        mockNativeLastEvent.timestamp,
      );

      // Admin raises the policy; the earlier crossing must not be logged now.
      fetchEmployeeData.mockResolvedValue({
        geotagging: GEOTAGGING.ALL_ACTIONS,
      });
      await mountBootstrap(GEOTAGGING.ALL_ACTIONS);
      await flushReplay();

      expect(autoCheckInOut).not.toHaveBeenCalled();
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    });

    it("acts on a crossing that happens after the policy is raised", async () => {
      await manualCheckIn(startedWorkAt());

      await mountBootstrap(GEOTAGGING.ALL_ACTIONS);
      await fireGeofence("EXIT");

      expect(autoCheckInOut).toHaveBeenCalledTimes(1);
      expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    });
  });
});
