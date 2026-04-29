import React from "react";
import { Text } from "react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
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
  updateDateTime: jest.fn(() => "29-04-2026 10:00:00"),
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
    if (event === "focus") {
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
  const screen = render(
    <Provider store={store}>
      <AttendanceAction />
    </Provider>,
  );

  return {
    ...screen,
    store,
  };
};

describe("AttendanceAction session timer behavior", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    focusListener = null;

    await AsyncStorage.clear();
    await AsyncStorage.setItem("restrict_location", "0");
    await AsyncStorage.setItem("photo", "0");

    attendanceService.getAttendanceStatus.mockResolvedValue({ custom_in: 0 });
    attendanceService.getServerTime.mockResolvedValue("2026-04-29 10:00:00");
    attendanceService.getDailyWorkedHours.mockResolvedValue("03:00");
    attendanceService.getMonthlyWorkedHours.mockResolvedValue("70:00");
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

  it("continues existing timer after focus and remount while checked in", async () => {
    const persistedStart = new Date("2026-04-29T09:45:00.000Z").getTime();

    await AsyncStorage.setItem("checkinStartTime", String(persistedStart));

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: persistedStart,
    });

    const first = renderScreen();

    await waitFor(() => {
      const attendance = first.store.getState().attendance;
      expect(attendance.checkin).toBe(true);
      expect(attendance.checkinTime).toBe(persistedStart);
    });

    await act(async () => {
      if (focusListener) {
        await focusListener();
      }
    });

    await waitFor(() => {
      const attendance = first.store.getState().attendance;
      expect(attendance.checkinTime).toBe(persistedStart);
    });

    first.unmount();

    const second = renderScreen();

    await waitFor(() => {
      const attendance = second.store.getState().attendance;
      expect(attendance.checkin).toBe(true);
      expect(attendance.checkinTime).toBe(persistedStart);
    });
  });

  it("resets timer session on checkout", async () => {
    const checkinStart = new Date("2026-04-29T09:55:00.000Z").getTime();

    await AsyncStorage.setItem("checkinStartTime", String(checkinStart));

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: checkinStart,
    });

    const screen = renderScreen({
      checkin: true,
      checkinTime: checkinStart,
    });

    await waitFor(() => {
      expect(screen.getByText("CHECK-OUT")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("CHECK-OUT"));

    await waitFor(() => {
      const attendance = screen.store.getState().attendance;
      expect(attendance.checkin).toBe(false);
      expect(attendance.checkinTime).toBeNull();
    });

    const storedStart = await AsyncStorage.getItem("checkinStartTime");
    const lastCheckout = await AsyncStorage.getItem("lastCheckoutTime");

    expect(storedStart).toBeNull();
    expect(lastCheckout).toBeTruthy();
  });

  it("ignores stale backend checkin older than last checkout", async () => {
    const staleCheckin = new Date("2026-04-29T09:00:00.000Z").getTime();
    const lastCheckout = new Date("2026-04-29T09:30:00.000Z").getTime();

    await AsyncStorage.setItem("checkinStartTime", String(staleCheckin));
    await AsyncStorage.setItem("lastCheckoutTime", String(lastCheckout));

    attendanceService.getAttendanceStatus.mockResolvedValue({
      custom_in: 1,
      checkin_time: staleCheckin,
    });

    const screen = renderScreen();

    await waitFor(() => {
      const attendance = screen.store.getState().attendance;
      expect(attendance.checkin).toBe(false);
      expect(attendance.checkinTime).toBeNull();
      expect(screen.getByText("CHECK-IN")).toBeTruthy();
    });

    const storedStart = await AsyncStorage.getItem("checkinStartTime");
    expect(storedStart).toBeNull();
  });
});
