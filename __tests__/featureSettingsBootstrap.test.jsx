/**
 * A launch whose settings request failed offline must not wait for the next
 * foreground: automatic attendance and its onboarding wait on a fresh answer.
 */
let mockReconnect;
const mockRefresh = jest.fn();
jest.mock("../hooks/useFeatureSettings", () => ({ __esModule: true, default: () => ({ refresh: mockRefresh }) }));
jest.mock("../services/offline/NetworkListener", () => ({
  addReconnectListener: listener => { mockReconnect = listener; return () => { mockReconnect = null; }; },
}));

import React from "react";
import { render } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import FeatureSettingsBootstrap from "../components/FeatureSettingsBootstrap";
import RootReducer from "../redux/RootReducer";
import { automaticAttendanceSettings, TEST_TENANT } from "../test-utils/attendanceScope";

const mount = featureSettings => render(
  <Provider store={configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true },
    user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: "EMP-SYNTHETIC" } },
    featureSettings,
  } })}>
    <FeatureSettingsBootstrap />
  </Provider>,
);

beforeEach(() => { mockRefresh.mockClear(); mockReconnect = null; });

it("refreshes on reconnect when the last answer failed", () => {
  mount({ ...automaticAttendanceSettings("EMP-SYNTHETIC"), status: "error" });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockReconnect();
  expect(mockRefresh).toHaveBeenCalledTimes(2);
});

it("does not spend a request on reconnect when the last answer is fresh", () => {
  mount(automaticAttendanceSettings("EMP-SYNTHETIC"));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  mockReconnect();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
