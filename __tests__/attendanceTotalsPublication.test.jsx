import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Toast from "react-native-toast-message";
import MockAdapter from "axios-mock-adapter";
import apiClient from "../services/api/apiClient";
import useAttendanceAction from "../hooks/useAttendanceAction";
import RootReducer from "../redux/RootReducer";
import { getDailyWorkedHours, getMonthlyWorkedHours, getTodayBreaks } from "../services/api/attendance.service";
import { performManualAttendanceTransition } from "../services/offline/ManualAttendanceService";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { SESSION_STATE_KEY, readSession } from "../utils/attendanceSessionState";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { setTodayHours, setMonthlyHours, setBreakMinutes } from "../redux/Slices/AttendanceSlice";

jest.mock("react-native-toast-message", () => ({ show: jest.fn() }));
jest.mock("../utils/HapticsMessage", () => ({ hapticsMessage: jest.fn() }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ addListener: () => jest.fn(), navigate: jest.fn() }) }));
jest.mock("../services/api/attendance.service", () => ({
  userCheckIn: jest.fn(), getAttendanceStatus: jest.fn(async () => ({ custom_in: 0, unavailable: true })),
  getDailyWorkedHours: jest.fn(), getMonthlyWorkedHours: jest.fn(), getTodayBreaks: jest.fn(),
  getServerTime: jest.fn(async () => "2026-10-14 09:00:00"), employeeBreak: jest.fn(),
}));
jest.mock("../services/offline/ManualAttendanceService", () => ({
  ...jest.requireActual("../services/offline/ManualAttendanceService"), performManualAttendanceTransition: jest.fn(),
}));
jest.mock("../services/offline/AttendanceQueueService", () => ({ getQueueCounts: jest.fn(async () => ({ awaitingServerCount: 0 })) }));
jest.mock("../services/offline/offlineAttendanceGate", () => ({ resolveNearestOffice: jest.fn(async () => ({ withinRadius: true })) }));

const employeeId = "EMP-001";
let hook, store, scope;
function Harness() { hook = useAttendanceAction(); return null; }
const mount = () => render(<Provider store={store}><Harness /></Provider>);

beforeEach(async () => {
  await AsyncStorage.clear(); await loginQueueEmployee(employeeId);
  scope = await captureAttendanceQueueScope(employeeId);
  await AsyncStorage.multiSet([["restrict_location", "0"], ["unrestricted_checkout_location", "0"], ["photo", "0"]]);
  jest.clearAllMocks();
  getDailyWorkedHours.mockResolvedValue("08:00");
  getMonthlyWorkedHours.mockResolvedValue("80:00");
  getTodayBreaks.mockResolvedValue({ total_break_minutes: 30, breaks: [] });
  performManualAttendanceTransition.mockImplementation(async () => {
    const session = { status: "CHECKED_IN", startedAt: Date.now(), origin: "MANUAL", endedAt: null, closedBy: null };
    await AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify(session));
    return { status: "COMPLETED", session, previousSession: { status: "CHECKED_OUT" },
      response: { allowed: true }, scope, occurredAt: session.startedAt };
  });
  store = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: employeeId } },
    autoAttendance: { geotagging: 2, userEnabled: true, syncRequestId: 0 },
  } });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it("does not publish old totals after the account changes while all three reads are in flight", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  getDailyWorkedHours.mockImplementation(async () => { await held; return "08:00"; });
  getMonthlyWorkedHours.mockImplementation(async () => { await held; return "80:00"; });
  getTodayBreaks.mockImplementation(async () => { await held; return { total_break_minutes: 30, breaks: [] }; });
  mount(); await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  let pending;
  act(() => { pending = hook.handlePrimaryAction(); });
  await waitFor(() => expect(getDailyWorkedHours).toHaveBeenCalled());
  await loginQueueEmployee(employeeId, "https://other.example.com", "synthetic-other");
  act(() => {
    store.dispatch(setTodayHours("01:00")); store.dispatch(setMonthlyHours("10:00")); store.dispatch(setBreakMinutes(5));
  });
  await act(async () => { release(); await pending; });
  expect(store.getState().attendance).toMatchObject({ todayHours: "01:00", monthlyHours: "10:00", breakMinutes: 5 });
});

it("passes scope to all totals reads and publishes their current-account values", async () => {
  mount(); await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  await act(async () => { await hook.handlePrimaryAction(); });
  expect(getDailyWorkedHours.mock.calls[0].at(-1)).toEqual({ syncScope: scope });
  expect(getMonthlyWorkedHours.mock.calls[0].at(-1)).toEqual({ syncScope: scope });
  expect(getTodayBreaks.mock.calls.some(args => args.at(-1)?.syncScope === scope)).toBe(true);
  expect(store.getState().attendance).toMatchObject({ todayHours: "08:00", monthlyHours: "80:00", breakMinutes: 30 });
});

it("keeps a successful manual IN message and session when actual scoped totals requests fail", async () => {
  const real = jest.requireActual("../services/api/attendance.service");
  getDailyWorkedHours.mockImplementation(real.getDailyWorkedHours);
  getMonthlyWorkedHours.mockImplementation(real.getMonthlyWorkedHours);
  getTodayBreaks.mockImplementation(real.getTodayBreaks);
  const http = new MockAdapter(apiClient);
  http.onGet().reply(500);
  try {
    mount(); await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
    Toast.show.mockClear();
    await act(async () => { await hook.handlePrimaryAction(); });
    expect(http.history.get.some(request => request.url.includes("get_total_hours"))).toBe(true);
    expect(await readSession()).toMatchObject({ status: "CHECKED_IN", origin: "MANUAL" });
    expect(store.getState().attendance.checkin).toBe(true);
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: "success", text1: "Checked in!" }));
    expect(Toast.show.mock.calls.some(([message]) => message.text1 === "Failed")).toBe(false);
  } finally { http.restore(); }
});
