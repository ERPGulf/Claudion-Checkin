import React from "react";
import { Text } from "react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import Toast from "react-native-toast-message";
import AttendanceAction from "../screens/AttendanceAction";
import attendanceReducer from "../redux/Slices/AttendanceSlice";
import * as attendanceService from "../services/api/attendance.service";

jest.mock("react-native-toast-message", () => ({
  show: jest.fn(),
}));

jest.mock("../services/api/attendance.service", () => ({
  getOfficeLocation: jest.fn(),
  userCheckIn: jest.fn(),
  getAttendanceStatus: jest.fn(),
  getDailyWorkedHours: jest.fn(),
  getMonthlyWorkedHours: jest.fn(),
  getServerTime: jest.fn(),
  employeeBreak: jest.fn(),
  getTodayBreaks: jest.fn(),
}));

jest.mock("../services/api/apiClient", () => ({
  saveTokens: jest.fn(),
}));

jest.mock("../utils/TimeServices", () => ({
  updateDateTime: jest.fn(() => "25-04-2026 12:00:00"),
}));

jest.mock("../components/AttendanceAction/WelcomeCard", () => {
  const React = require("react");
  const { Text } = require("react-native");

  return () => <Text>WelcomeCardMock</Text>;
});

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    SafeAreaView: ({ children }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");

  return {
    Entypo: (props) => <Text {...props}>Entypo</Text>,
    MaterialCommunityIcons: (props) => <Text {...props}>Icon</Text>,
  };
});

let focusListener = null;

const mockNavigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn((event, cb) => {
    if (event === "focus" && typeof cb === "function") {
      focusListener = cb;
    }

    return jest.fn();
  }),
};

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
}));

const createStore = (attendanceOverrides = {}) =>
  configureStore({
    reducer: {
      attendance: attendanceReducer,
      user: (
        state = {
          userDetails: {
            employeeCode: "EMP-001",
          },
        },
      ) => state,
    },
    preloadedState: {
      attendance: {
        checkin: false,
        checkinTime: null,
        checkoutTime: null,
        location: null,
        locations: [],
        todayHours: "00:00",
        monthlyHours: "00:00",
        breakMinutes: 0,
        breakTakenToday: false,
        onBreak: false,
        breakStartTime: null,
        ...attendanceOverrides,
      },
    },
  });

const renderScreen = (attendanceOverrides = {}) => {
  const store = createStore(attendanceOverrides);

  const utils = render(
    <Provider store={store}>
      <AttendanceAction />
    </Provider>,
  );

  return {
    ...utils,
    store,
  };
};

describe("AttendanceAction break rules", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    focusListener = null;
    await AsyncStorage.clear();

    await AsyncStorage.setItem("restrict_location", "0");
    await AsyncStorage.setItem("photo", "0");

    attendanceService.getAttendanceStatus.mockResolvedValue({ custom_in: 1 });
    attendanceService.getServerTime.mockResolvedValue("2026-04-25 12:00:00");
    attendanceService.getDailyWorkedHours.mockResolvedValue("04:00");
    attendanceService.getMonthlyWorkedHours.mockResolvedValue("90:00");
    attendanceService.getOfficeLocation.mockResolvedValue({
      withinRadius: true,
      distance: 0,
      radius: 100,
    });
    attendanceService.userCheckIn.mockResolvedValue({ allowed: true });
    attendanceService.employeeBreak.mockResolvedValue({
      allowed: true,
      message: "Break started",
    });
    attendanceService.getTodayBreaks.mockResolvedValue({
      total_break_minutes: 0,
      breaks: [],
    });
  });

  it("keeps checkin start time stable after focus refresh", async () => {
    const stableCheckinTime = new Date("2026-04-25T08:30:00.000Z").getTime();

    await AsyncStorage.setItem("checkinStartTime", String(stableCheckinTime));

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: String(stableCheckinTime),
    });

    const screen = renderScreen({
      checkin: true,
      checkinTime: stableCheckinTime,
    });

    await waitFor(() => {
      expect(focusListener).toEqual(expect.any(Function));
    });

    await act(async () => {
      await focusListener();
    });

    await waitFor(() => {
      expect(screen.store.getState().attendance.checkinTime).toBe(
        stableCheckinTime,
      );
    });
  });

  it("keeps newer local checkin start when backend timestamp is stale", async () => {
    const staleBackendCheckinTime = new Date(
      "2026-04-25T08:30:00.000Z",
    ).getTime();
    const freshLocalCheckinTime = new Date(
      "2026-04-25T10:00:00.000Z",
    ).getTime();

    await AsyncStorage.setItem(
      "checkinStartTime",
      String(freshLocalCheckinTime),
    );

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: String(staleBackendCheckinTime),
    });

    const screen = renderScreen({
      checkin: true,
      checkinTime: freshLocalCheckinTime,
    });

    await waitFor(() => {
      expect(focusListener).toEqual(expect.any(Function));
    });

    await act(async () => {
      await focusListener();
    });

    await waitFor(() => {
      expect(screen.store.getState().attendance.checkinTime).toBe(
        freshLocalCheckinTime,
      );
    });
  });

  it("ignores status checkin time older than last local checkout", async () => {
    jest.useFakeTimers();

    const now = new Date("2026-04-25T10:00:00.000Z");
    jest.setSystemTime(now);

    const staleBackendCheckinTime = new Date(
      "2026-04-25T08:30:00.000Z",
    ).getTime();
    const lastCheckoutTime = new Date("2026-04-25T09:45:00.000Z").getTime();

    await AsyncStorage.removeItem("checkinStartTime");
    await AsyncStorage.setItem("lastCheckoutTime", String(lastCheckoutTime));

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: String(staleBackendCheckinTime),
    });

    const screen = renderScreen({
      checkin: false,
      checkinTime: null,
    });

    await waitFor(() => {
      expect(focusListener).toEqual(expect.any(Function));
    });

    await act(async () => {
      await focusListener();
    });

    await waitFor(() => {
      expect(screen.store.getState().attendance.checkinTime).toBe(
        now.getTime(),
      );
    });
  });

  it("disables break after a completed break for the day", async () => {
    attendanceService.getTodayBreaks.mockResolvedValue({
      total_break_minutes: 25,
      breaks: [
        {
          start: "2026-04-25 10:00:00",
          end: "2026-04-25 10:25:00",
        },
      ],
    });

    const screen = renderScreen({ checkin: true });

    await waitFor(() => {
      expect(screen.getByText("BREAK NOT ALLOWED")).toBeTruthy();
    });
  });

  it("disables break button at 2-hour daily cap", async () => {
    const screen = renderScreen({
      checkin: true,
      breakMinutes: 120,
    });

    await waitFor(() => {
      expect(screen.getByText("BREAK NOT ALLOWED")).toBeTruthy();
    });
  });

  it("shows monthly-limit notification and disables break button", async () => {
    attendanceService.getTodayBreaks.mockResolvedValue({
      total_break_minutes: 45,
      breaks: [],
    });

    attendanceService.employeeBreak.mockResolvedValue({
      allowed: false,
      message: "Monthly break limit reached (8h)",
    });

    const screen = renderScreen({ checkin: true, breakMinutes: 45 });

    await waitFor(() => {
      expect(screen.getByText("TAKE BREAK")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("TAKE BREAK"));

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          text1: "Monthly break limit reached (8h)",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("BREAK NOT ALLOWED")).toBeTruthy();
    });
  });

  it("continues break timer after screen remount using saved breakStartTime", async () => {
    jest.useFakeTimers();

    const now = new Date("2026-04-25T12:00:00.000Z");
    jest.setSystemTime(now);

    await AsyncStorage.setItem(
      "breakStartTime",
      String(now.getTime() - 65 * 1000),
    );

    attendanceService.getTodayBreaks.mockResolvedValue({
      total_break_minutes: 0,
      breaks: [
        {
          start: "2026-04-25 11:58:55",
          end: null,
        },
      ],
    });

    const screen = renderScreen({ checkin: true });

    await waitFor(() => {
      expect(screen.getByText("BREAK IN PROGRESS")).toBeTruthy();
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(/00:01:/)).toBeTruthy();
  });
});
