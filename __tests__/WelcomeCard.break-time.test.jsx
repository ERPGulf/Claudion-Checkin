import React from "react";
import { Text } from "react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, waitFor, act } from "@testing-library/react-native";
import attendanceReducer from "../redux/Slices/AttendanceSlice";
import WelcomeCard from "../components/AttendanceAction/WelcomeCard";

jest.mock("expo-image", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    Image: (props) => <View {...props} />,
  };
});

jest.mock("../assets/images/checkin.png", () => "checkin.png");
jest.mock("../assets/images/checkout.png", () => "checkout.png");

const createStore = (attendanceOverrides = {}) =>
  configureStore({
    reducer: {
      attendance: attendanceReducer,
    },
    preloadedState: {
      attendance: {
        checkin: true,
        checkinTime: Date.now() - 10 * 60 * 1000,
        checkoutTime: null,
        location: { locationName: "HQ" },
        locations: [],
        todayHours: "06:10",
        monthlyHours: "110:00",
        breakMinutes: 0,
        breakTakenToday: false,
        onBreak: false,
        breakStartTime: null,
        ...attendanceOverrides,
      },
    },
  });

describe("WelcomeCard break time display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("shows total break time taken today", async () => {
    const store = createStore({ breakMinutes: 75 });

    const screen = render(
      <Provider store={store}>
        <WelcomeCard />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Break time: 01:15")).toBeTruthy();
    });
  });

  it("includes ongoing live break in displayed total", async () => {
    jest.useFakeTimers();

    const now = new Date("2026-04-25T12:00:00.000Z");
    jest.setSystemTime(now);

    const store = createStore({
      breakMinutes: 45,
      onBreak: true,
      breakStartTime: now.getTime() - 30 * 60 * 1000,
    });

    const screen = render(
      <Provider store={store}>
        <WelcomeCard />
      </Provider>,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("Break time: 01:15")).toBeTruthy();
    });
  });
});
