import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MockAdapter from "axios-mock-adapter";

/**
 * M0 characterizes the real JS orchestration, reducers, session authority,
 * queue-scope capture and replay high-water mark at source commit de722c9.
 * Native/location/network/delivery are boundaries, not implementations tested
 * here. A getLastEvent fixture is a native bridge response, not a simulation of
 * native durability or the single-slot store. Actual SQLite effects are covered
 * by autoAttendanceQueueProvenance.test.js. SDK-* todos are specifications,
 * not passing assertions of future behavior; see 08-M0-VALIDATION.md and
 * 09-SDK-DECISIONS.md in docs/auto-attendance-sdk/.
 */
const mockListeners = { ENTER: new Set(), EXIT: new Set() };
let mockNativeLastEvent = null;
let mockIsMonitoring = true;
let mockOffice = null;
let mockQueueCounts = { awaitingServerCount: 0, mayAffectServerCount: 0 };
let mockStore;

jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main",
  isAvailable: () => true,
  isMonitoring: () => mockIsMonitoring,
  getLastEvent: jest.fn(() => mockNativeLastEvent),
  clearLastEvent: jest.fn(),
  startGeofence: jest.fn(async () => {
    mockIsMonitoring = true;
  }),
  stopGeofence: jest.fn(async () => {
    mockIsMonitoring = false;
  }),
  addGeofenceEnterListener: jest.fn((listener) => {
    mockListeners.ENTER.add(listener);
    return { remove: () => mockListeners.ENTER.delete(listener) };
  }),
  addGeofenceExitListener: jest.fn((listener) => {
    mockListeners.EXIT.add(listener);
    return { remove: () => mockListeners.EXIT.delete(listener) };
  }),
}));

jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
}));

jest.mock("../services/api/attendance.service", () => ({
  autoCheckInOut: jest.fn(async () => ({
    allowed: true,
    name: "M0-RECEIPT",
    location: null,
  })),
  getOfficeLocation: jest.fn(async () => mockOffice),
  getAttendanceStatus: jest.fn(async () => ({ custom_in: 0 })),
}));
jest.mock("../services/api/employee.service", () => ({
  fetchEmployeeData: jest.fn(async () => ({ geotagging: 2 })),
}));
jest.mock("../services/offline/AttendanceQueueService", () => ({
  getQueueCounts: jest.fn(async () => mockQueueCounts),
  submitAutoAttendance: jest.fn(({ online }) => online()),
}));
jest.mock("../services/offline/BackgroundSyncManager", () => ({
  syncNow: jest.fn(async () => ({ ran: false })),
}));
jest.mock("../services/notifications/localNotifications", () => ({
  presentLocalNotification: jest.fn(async () => {}),
}));

// Keep apiClient teardown/expiry real and direct its dispatch into this test's
// real root reducer, avoiding the application's persistent singleton store.
jest.mock("../redux/Store", () => ({
  store: { dispatch: (action) => mockStore.dispatch(action) },
}));

import AutoAttendanceBootstrap from "../components/AutoAttendanceBootstrap";
import RootReducer from "../redux/RootReducer";
import { setSignIn } from "../redux/Slices/AuthSlice";
import { setBaseUrl, setEmployeeCode } from "../redux/Slices/UserSlice";
import {
  GEOTAGGING,
  requestAutoAttendanceSync,
  selectAutoAttendanceActive,
  setAutoAttendanceUserEnabled,
} from "../redux/Slices/AutoAttendanceSlice";
import {
  autoCheckInOut,
  getAttendanceStatus,
  getOfficeLocation,
} from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import apiClient, {
  clearStore,
  clearTokens,
  plainAxios,
  registerSessionCleanupHandler,
  saveTokens,
} from "../services/api/apiClient";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import {
  getQueueCounts,
  submitAutoAttendance,
} from "../services/offline/AttendanceQueueService";
import { syncNow } from "../services/offline/BackgroundSyncManager";
import { presentLocalNotification } from "../services/notifications/localNotifications";
import {
  clearLastEvent,
  startGeofence,
  stopGeofence,
} from "../modules/expo-auto-attendance";
import {
  applySessionOwner,
  performSessionTransition,
  readSession,
  SESSION_ORIGIN,
  SESSION_OWNER_KEY,
  SESSION_STATE_KEY,
  SESSION_STATUS,
} from "../utils/attendanceSessionState";
import {
  getLastProcessedEventAt,
  markEventProcessed,
  MAX_REPLAY_AGE_MS,
} from "../utils/geofenceEventLog";

const EMPLOYEE_A = "M0-EMPLOYEE-A";
const EMPLOYEE_B = "M0-EMPLOYEE-B";
const TENANT_A = "https://tenant-a.example.test";
const TENANT_B = "https://tenant-b.example.test";
const OFFICE_A = {
  locationName: "Fixture office A",
  latitude: 25,
  longitude: 51,
  radius: 100,
  distance: 500,
  withinRadius: false,
};
const OFFICE_B = {
  ...OFFICE_A,
  locationName: "Fixture office B",
  latitude: 26,
  longitude: 52,
  radius: 150,
};

const buildStore = () => {
  mockStore = configureStore({
    reducer: RootReducer,
    preloadedState: {
      userAuth: { isLoggedIn: true, token: "fixture-access" },
      user: { userDetails: { employeeCode: EMPLOYEE_A }, baseUrl: TENANT_A },
      autoAttendance: {
        geotagging: GEOTAGGING.ALL_ACTIONS,
        userEnabled: true,
        syncRequestId: 0,
      },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  return mockStore;
};

const provision = async (employeeCode = EMPLOYEE_A, tenant = TENANT_A) => {
  await AsyncStorage.multiSet([
    ["baseUrl", tenant],
    ["employee_code", employeeCode],
    ["api_key", `fixture-account-${employeeCode}`],
  ]);
  await saveTokens("fixture-access", "fixture-refresh");
};

const manualTransition = (type, at) =>
  performSessionTransition({
    type,
    at,
    origin: SESSION_ORIGIN.MANUAL,
    execute: async () => ({ allowed: true, name: `M0-MANUAL-${type}` }),
  });

const nativeResponse = (transition, timestamp) => ({
  identifier: "office-main",
  transition,
  timestamp,
});

const flushStartup = async () => {
  for (let index = 0; index < 25; index += 1) {
    // Existing bootstrap suites use act to drain the serialized startup chain.
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {});
  }
};

const mountBootstrap = async (store = mockStore) => {
  const view = render(
    <Provider store={store}>
      <AutoAttendanceBootstrap />
    </Provider>,
  );
  await waitFor(() => expect(mockListeners.ENTER.size).toBe(1));
  await flushStartup();
  return view;
};

const emit = async (transition, timestamp = Date.now()) => {
  await act(async () => {
    await Promise.all(
      [...mockListeners[transition]].map((listener) =>
        listener(nativeResponse(transition, timestamp)),
      ),
    );
  });
};

const loginThroughReducers = async (employeeCode, tenant) => {
  await provision(employeeCode, tenant);
  await applySessionOwner(employeeCode);
  await act(async () => {
    mockStore.dispatch(setEmployeeCode(employeeCode));
    mockStore.dispatch(setBaseUrl(tenant));
    mockStore.dispatch(
      setSignIn({ isLoggedIn: true, token: "fixture-access" }),
    );
  });
  await flushStartup();
};

describe("M0 current-behaviour characterization", () => {
  let httpMock;
  let refreshMock;
  let logSpy;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockListeners.ENTER.clear();
    mockListeners.EXIT.clear();
    mockNativeLastEvent = null;
    mockIsMonitoring = true;
    mockOffice = OFFICE_A;
    mockQueueCounts = { awaitingServerCount: 0, mayAffectServerCount: 0 };
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    autoCheckInOut.mockResolvedValue({
      allowed: true,
      name: "M0-RECEIPT",
      location: null,
    });
    getOfficeLocation.mockImplementation(async () => mockOffice);
    getAttendanceStatus.mockResolvedValue({ custom_in: 0 });
    fetchEmployeeData.mockResolvedValue({ geotagging: GEOTAGGING.ALL_ACTIONS });
    getQueueCounts.mockImplementation(async () => mockQueueCounts);
    submitAutoAttendance.mockImplementation(({ online }) => online());
    syncNow.mockResolvedValue({ ran: false });
    registerSessionCleanupHandler(null);
    await clearTokens();
    await AsyncStorage.clear();
    await provision();
    await applySessionOwner(EMPLOYEE_A);
    buildStore();
    httpMock = new MockAdapter(apiClient);
    refreshMock = new MockAdapter(plainAxios);
  });

  afterEach(() => {
    registerSessionCleanupHandler(null);
    httpMock.restore();
    refreshMock.restore();
    logSpy.mockRestore();
  });

  it("characterizes current behaviour: A pre-launch replay passes null sourceScope even with valid current provisioning", async () => {
    const crossedAt = Date.now() - 60_000;
    mockNativeLastEvent = nativeResponse("ENTER", crossedAt);
    submitAutoAttendance.mockResolvedValue({
      allowed: true,
      queued: true,
      location: null,
    });

    await mountBootstrap();

    expect(await captureAttendanceQueueScope(EMPLOYEE_A)).toMatchObject({
      tenantKey: TENANT_A,
      employeeId: EMPLOYEE_A,
    });
    expect(submitAutoAttendance).toHaveBeenCalledTimes(1);
    expect(submitAutoAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "IN",
        employeeCode: EMPLOYEE_A,
        occurredAt: crossedAt,
        sourceScope: null,
      }),
    );
    expect((await readSession()).startedAt).toBe(crossedAt);
    expect(await getLastProcessedEventAt()).toBe(crossedAt);
    expect(autoCheckInOut).not.toHaveBeenCalled();
  });

  it("characterizes current behaviour: A live event uses the observed queue scope without retaining its access token", async () => {
    await mountBootstrap();
    await emit("ENTER");

    const { sourceScope } = submitAutoAttendance.mock.calls[0][0];
    expect(sourceScope).toMatchObject({
      tenantKey: TENANT_A,
      employeeId: EMPLOYEE_A,
      authenticated: true,
    });
    expect(sourceScope).not.toHaveProperty("accessToken");
  });

  it("characterizes current behaviour: B a restart inside retains manual checkout until a native ENTER", async () => {
    const initialMount = await mountBootstrap();
    const checkedInAt = Date.now() - 2 * 60 * 60 * 1000;
    const checkedOutAt = Date.now() - 60 * 60 * 1000;
    await manualTransition("IN", checkedInAt);
    await manualTransition("OUT", checkedOutAt);
    expect(await readSession()).toMatchObject({
      status: SESSION_STATUS.CHECKED_OUT,
      closedBy: SESSION_ORIGIN.MANUAL,
    });
    await initialMount.unmountAsync();
    mockOffice = { ...OFFICE_A, distance: 10, withinRadius: true };

    await mountBootstrap();

    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect(await readSession()).toMatchObject({
      status: SESSION_STATUS.CHECKED_OUT,
      closedBy: SESSION_ORIGIN.MANUAL,
    });
    expect((await readSession()).endedAt).toBe(checkedOutAt);
    expect(getAttendanceStatus).toHaveBeenCalledTimes(1);
    expect(await getLastProcessedEventAt()).toBeNull();
  });

  it("characterizes current behaviour: C changing office coordinates refreshes the JS office but never re-registers the fence", async () => {
    mockIsMonitoring = false;
    await mountBootstrap();
    expect(startGeofence).toHaveBeenCalledWith({
      identifier: "office-main",
      latitude: OFFICE_A.latitude,
      longitude: OFFICE_A.longitude,
      radius: OFFICE_A.radius,
    });
    mockOffice = OFFICE_B;

    await act(async () => {
      mockStore.dispatch(requestAutoAttendanceSync());
    });
    await flushStartup();
    await emit("ENTER");

    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({ office: OFFICE_B }),
    );
  });

  it("characterizes current behaviour: C employee reassignment also trusts the old monitoring flag", async () => {
    mockIsMonitoring = false;
    await mountBootstrap();
    mockOffice = OFFICE_B;
    await provision(EMPLOYEE_B);
    await applySessionOwner(EMPLOYEE_B);

    await act(async () => {
      mockStore.dispatch(setEmployeeCode(EMPLOYEE_B));
    });
    await flushStartup();

    expect(getOfficeLocation).toHaveBeenLastCalledWith(EMPLOYEE_B);
    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(mockListeners.ENTER.size).toBe(1);
  });

  it("characterizes current behaviour: E explicit credential/reducer logout stops monitoring but retains session and processed mark", async () => {
    await mountBootstrap();
    await manualTransition("IN", Date.now() - 2 * 60 * 60 * 1000);
    const processedAt = Date.now() - 60 * 60 * 1000;
    await markEventProcessed(processedAt);
    mockNativeLastEvent = nativeResponse("ENTER", Date.now() - 60_000);
    const recordBeforeLogout = await AsyncStorage.getItem(SESSION_STATE_KEY);

    // These are the real credential/reducer functions used by Profile; its
    // FCM/cache cleanup and UI are outside this suite (queue cleanup has its own suite).
    await clearTokens();
    await act(async () => {
      clearStore();
    });
    await flushStartup();

    expect(mockStore.getState().userAuth.isLoggedIn).toBe(false);
    expect(mockStore.getState().autoAttendance.userEnabled).toBe(false);
    expect(stopGeofence).toHaveBeenCalledTimes(1);
    expect(mockListeners.ENTER.size).toBe(0);
    expect(clearLastEvent).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBe(
      recordBeforeLogout,
    );
    expect(await AsyncStorage.getItem(SESSION_OWNER_KEY)).toBe(EMPLOYEE_A);
    expect(await getLastProcessedEventAt()).toBe(processedAt);
    expect(await AsyncStorage.getItem("access_token")).toBeNull();
  });

  it("characterizes current behaviour: E terminal refresh expiry resets opt-in and retains session/processed mark through the real interceptor", async () => {
    await mountBootstrap();
    await manualTransition("IN", Date.now() - 2 * 60 * 60 * 1000);
    const processedAt = Date.now() - 60 * 60 * 1000;
    await markEventProcessed(processedAt);
    const recordBeforeExpiry = await AsyncStorage.getItem(SESSION_STATE_KEY);
    httpMock.onGet(`${TENANT_A}/api/method/m0_protected`).reply(401);
    refreshMock
      .onPost(`${TENANT_A}/api/method/employee_app.gauth.create_refresh_token`)
      .reply(401, { exc_type: "AuthenticationError" });

    await act(async () => {
      await expect(
        apiClient.get(`${TENANT_A}/api/method/m0_protected`),
      ).rejects.toThrow("Session expired");
    });
    await flushStartup();

    expect(refreshMock.history.post).toHaveLength(1);
    expect(mockStore.getState().userAuth.isLoggedIn).toBe(false);
    expect(mockStore.getState().autoAttendance.userEnabled).toBe(false);
    expect(stopGeofence).toHaveBeenCalledTimes(1);
    expect(clearLastEvent).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SESSION_STATE_KEY)).toBe(
      recordBeforeExpiry,
    );
    expect(await getLastProcessedEventAt()).toBe(processedAt);
    expect(await AsyncStorage.getItem("access_token")).toBeNull();
    expect(await AsyncStorage.getItem("refresh_token")).toBeNull();
  });

  it("characterizes current behaviour: E employee B can replay A's unattributed native response after logout and re-enabling", async () => {
    await mountBootstrap();
    const oldMark = Date.now() - 2 * 60 * 60 * 1000;
    const crossedByAAt = Date.now() - 60 * 60 * 1000;
    await markEventProcessed(oldMark);
    mockNativeLastEvent = nativeResponse("ENTER", crossedByAAt);
    await clearTokens();
    await act(async () => {
      clearStore();
    });
    await flushStartup();

    await loginThroughReducers(EMPLOYEE_B, TENANT_B);
    expect(mockStore.getState().autoAttendance.userEnabled).toBe(false);
    expect(await getLastProcessedEventAt()).toBe(oldMark);
    await act(async () => {
      mockStore.dispatch(setAutoAttendanceUserEnabled(true));
    });
    await flushStartup();

    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeCode: EMPLOYEE_B,
        type: "IN",
        occurredAt: crossedByAAt,
      }),
    );
    expect(submitAutoAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ employeeCode: EMPLOYEE_B, sourceScope: null }),
    );
    expect(await AsyncStorage.getItem(SESSION_OWNER_KEY)).toBe(EMPLOYEE_B);
    expect(await getLastProcessedEventAt()).toBe(crossedByAAt);
    expect((await readSession()).startedAt).toBe(crossedByAAt);
  });

  it("characterizes current behaviour: E applySessionOwner ignores tenant changes for an unchanged employee code", async () => {
    await manualTransition("IN", Date.now() - 2 * 60 * 60 * 1000);
    await markEventProcessed(Date.now() - 60 * 60 * 1000);
    const priorSession = await readSession();
    const priorMark = await getLastProcessedEventAt();

    // This tests the employee-only authority boundary relevant to QR-style
    // reprovisioning, NOT completeMobileSignIn, which separately clears on a
    // tenant change. Existing mobileAuthSession tests verify that handoff.
    await provision(EMPLOYEE_A, TENANT_B);
    expect(await applySessionOwner(EMPLOYEE_A)).toBe(false);

    expect(await readSession()).toEqual(priorSession);
    expect(await getLastProcessedEventAt()).toBe(priorMark);
    expect(await captureAttendanceQueueScope(EMPLOYEE_A)).toMatchObject({
      tenantKey: TENANT_B,
      employeeId: EMPLOYEE_A,
    });
  });

  it("characterizes current behaviour: E changing employees clears the session but leaves the global processed mark", async () => {
    await manualTransition("IN", Date.now() - 2 * 60 * 60 * 1000);
    const processedAt = Date.now() - 60 * 60 * 1000;
    await markEventProcessed(processedAt);

    expect(await applySessionOwner(EMPLOYEE_B)).toBe(true);

    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(await AsyncStorage.getItem("checkinStartTime")).toBeNull();
    expect(await getLastProcessedEventAt()).toBe(processedAt);
  });

  it("characterizes current behaviour: F logout/login requires a fresh opt-in despite the refreshed server policy", async () => {
    await mountBootstrap();
    await clearTokens();
    await act(async () => {
      clearStore();
    });
    await flushStartup();
    await loginThroughReducers(EMPLOYEE_A, TENANT_A);

    expect(mockStore.getState().autoAttendance.geotagging).toBe(
      GEOTAGGING.ALL_ACTIONS,
    );
    expect(mockStore.getState().autoAttendance.userEnabled).toBe(false);
    expect(selectAutoAttendanceActive(mockStore.getState())).toBe(false);
    expect(startGeofence).not.toHaveBeenCalled();
    expect(mockListeners.ENTER.size).toBe(0);

    await act(async () => {
      mockStore.dispatch(setAutoAttendanceUserEnabled(true));
    });
    await flushStartup();

    expect(selectAutoAttendanceActive(mockStore.getState())).toBe(true);
    expect(startGeofence).toHaveBeenCalledTimes(1);
    expect(mockListeners.ENTER.size).toBe(1);
  });

  it.each([
    {
      sequence: ["ENTER", "ENTER"],
      startsOpen: false,
      submitted: ["IN"],
      status: SESSION_STATUS.CHECKED_IN,
    },
    {
      sequence: ["ENTER", "EXIT"],
      startsOpen: false,
      submitted: ["IN", "OUT"],
      status: SESSION_STATUS.CHECKED_OUT,
    },
    {
      sequence: ["EXIT", "ENTER"],
      startsOpen: false,
      submitted: ["IN"],
      status: SESSION_STATUS.CHECKED_IN,
    },
    {
      sequence: ["EXIT", "EXIT"],
      startsOpen: true,
      submitted: ["OUT"],
      status: SESSION_STATUS.CHECKED_OUT,
    },
  ])(
    "characterizes current behaviour: G $sequence is governed by the real session machine",
    async ({ sequence, startsOpen, submitted, status }) => {
      if (startsOpen) await manualTransition("IN", Date.now() - 60_000);
      await mountBootstrap();
      const firstAt = Date.now();
      for (const [index, transition] of sequence.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await emit(transition, firstAt + index);
      }

      expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual(
        submitted,
      );
      expect((await readSession()).status).toBe(status);
      expect(await getLastProcessedEventAt()).toBe(firstAt + 1);
    },
  );

  it("characterizes current behaviour: G concurrent duplicate ENTERs submit once under the shared session lock", async () => {
    await mountBootstrap();
    const event = nativeResponse("ENTER", Date.now());

    await act(async () => {
      const listener = [...mockListeners.ENTER][0];
      await Promise.all([listener(event), listener(event)]);
    });

    expect(submitAutoAttendance).toHaveBeenCalledTimes(1);
    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
  });

  it("characterizes current behaviour: G a queued ENTER commits locally and the following EXIT is not force-queued", async () => {
    await mountBootstrap();
    submitAutoAttendance.mockResolvedValue({
      allowed: true,
      queued: true,
      location: null,
    });
    await emit("ENTER");
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    mockQueueCounts = { awaitingServerCount: 1, mayAffectServerCount: 1 };

    await emit("EXIT", Date.now() + 1);

    expect(
      submitAutoAttendance.mock.calls.map(([input]) => ({
        type: input.type,
        forceQueue: input.forceQueue,
      })),
    ).toEqual([
      { type: "IN", forceQueue: false },
      { type: "OUT", forceQueue: false },
    ]);
    expect(autoCheckInOut).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(presentLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Checked out offline",
        data: { type: "auto-checkout", pendingSync: true },
      }),
    );
  });

  it("characterizes current behaviour: G delayed replay uses the crossing timestamp", async () => {
    const crossedAt = Date.now() - 90 * 60 * 1000;
    mockNativeLastEvent = nativeResponse("ENTER", crossedAt);

    await mountBootstrap();

    expect(autoCheckInOut).toHaveBeenCalledWith(
      expect.objectContaining({ type: "IN", occurredAt: crossedAt }),
    );
    expect((await readSession()).startedAt).toBe(crossedAt);
  });

  it("characterizes current behaviour: G the high-water mark blocks a duplicate replay even after manual checkout makes IN legal", async () => {
    const crossedAt = Date.now() - 90 * 60 * 1000;
    mockNativeLastEvent = nativeResponse("ENTER", crossedAt);
    const initialMount = await mountBootstrap();
    await manualTransition("OUT", Date.now() - 60_000);
    await initialMount.unmountAsync();

    await mountBootstrap();

    expect(autoCheckInOut).toHaveBeenCalledTimes(1);
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(await getLastProcessedEventAt()).toBe(crossedAt);
  });

  it("characterizes current behaviour: G an older replay is suppressed by a newer global high-water mark", async () => {
    const processedAt = Date.now() - 60_000;
    await markEventProcessed(processedAt);
    mockNativeLastEvent = nativeResponse("ENTER", processedAt - 60_000);

    await mountBootstrap();

    expect(submitAutoAttendance).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    expect(await getLastProcessedEventAt()).toBe(processedAt);
  });

  it("characterizes current behaviour: G a replayed EXIT predating an open session is marked handled without closing it", async () => {
    const startedAt = Date.now() - 60_000;
    await manualTransition("IN", startedAt);
    mockNativeLastEvent = nativeResponse("EXIT", startedAt - 60_000);

    await mountBootstrap();

    expect(submitAutoAttendance).not.toHaveBeenCalled();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_IN);
    expect(await getLastProcessedEventAt()).toBe(startedAt - 60_000);
  });

  it("characterizes current behaviour: G live delivery bypasses replay timestamp guards and can close before the session started", async () => {
    await mountBootstrap();
    const enteredAt = Date.now();
    await emit("ENTER", enteredAt);
    await emit("EXIT", enteredAt - 60_000);

    expect(autoCheckInOut.mock.calls.map(([input]) => input.type)).toEqual([
      "IN",
      "OUT",
    ]);
    expect(await readSession()).toMatchObject({
      status: SESSION_STATUS.CHECKED_OUT,
      startedAt: enteredAt,
      endedAt: enteredAt - 60_000,
    });
    expect(await getLastProcessedEventAt()).toBe(enteredAt);
  });

  it.each([
    {
      label: "older than 24 hours",
      at: () => Date.now() - MAX_REPLAY_AGE_MS - 60_000,
    },
    { label: "beyond the future tolerance", at: () => Date.now() + 5 * 60_000 },
  ])(
    "characterizes current behaviour: G replay $label is marked handled without submission",
    async ({ at }) => {
      const crossedAt = at();
      mockNativeLastEvent = nativeResponse("ENTER", crossedAt);

      await mountBootstrap();

      expect(submitAutoAttendance).not.toHaveBeenCalled();
      expect(await getLastProcessedEventAt()).toBe(crossedAt);
    },
  );

  it("characterizes current behaviour: G refused replay remains unprocessed and is retried at the next mount", async () => {
    const crossedAt = Date.now() - 60_000;
    mockNativeLastEvent = nativeResponse("ENTER", crossedAt);
    autoCheckInOut.mockResolvedValueOnce({
      allowed: false,
      message: "Synthetic validation refusal",
    });
    const initialMount = await mountBootstrap();
    expect(await getLastProcessedEventAt()).toBeNull();
    expect((await readSession()).status).toBe(SESSION_STATUS.CHECKED_OUT);
    await initialMount.unmountAsync();

    await mountBootstrap();

    expect(autoCheckInOut).toHaveBeenCalledTimes(2);
    expect(await getLastProcessedEventAt()).toBe(crossedAt);
  });
});

describe("M0 desired SDK behavior specifications (unimplemented)", () => {
  test.todo(
    "SDK-A-1: replay uses capture-time tenant/employee provenance rather than today's scope",
  );
  test.todo(
    "SDK-B-1: manual checkout inside suppresses startup presence IN under an approved product rule",
  );
  test.todo(
    "SDK-C-1: changed employee/office coordinates reconcile native registrations before live attendance",
  );
  test.todo(
    "SDK-E-1: foreign-scope and unattributed legacy events are quarantined instead of replayed as another employee",
  );
  test.todo(
    "SDK-E-2: ownership includes tenant and employee while mobile handoff retains its current tenant-clear guarantee",
  );
  test.todo(
    "SDK-F-1: token-expiry opt-in behavior follows the approved distinction from explicit logout",
  );
  test.todo(
    "SDK-G-1: stable event IDs deduplicate live/replay delivery and ordering applies consistently to both paths",
  );
  test.todo(
    "SDK-H-1: Kotlin/XCTest harness proves persist-before-emit and ENTER/EXIT survival without JS; no mocked JS durability claim",
  );
});
