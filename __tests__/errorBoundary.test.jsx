import React from "react";
import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("@expo/vector-icons", () => {
  const { Text: MockText } = require("react-native");
  return { Ionicons: ({ name }) => <MockText>{`icon:${name}`}</MockText> };
});

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
  };
});

jest.mock("../services/crashlytics.service", () => ({
  recordNonFatalError: jest.fn(),
}));

/* eslint-disable import/first */
import ErrorBoundary from "../components/common/ErrorBoundary";
import { recordNonFatalError } from "../services/crashlytics.service";
/* eslint-enable import/first */

let shouldThrow = false;

function Screen() {
  if (shouldThrow) throw new TypeError("Cannot read property 'name' of undefined");
  return <Text>Home</Text>;
}

it("replaces a crashed screen with a retry and reports the error", () => {
  // React logs the caught error itself; the assertion below covers it.
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  shouldThrow = true;

  const { getByText, queryByText } = render(
    <ErrorBoundary>
      <Screen />
    </ErrorBoundary>,
  );

  expect(getByText("Something went wrong")).toBeTruthy();
  expect(queryByText(/Cannot read property/)).toBeNull();
  expect(recordNonFatalError).toHaveBeenCalledWith(expect.any(TypeError), {
    feature: "ui",
    action: "render",
  });

  shouldThrow = false;
  fireEvent.press(getByText("Try again"));

  expect(getByText("Home")).toBeTruthy();
  consoleError.mockRestore();
});
