import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which screen an unauthenticated app opens on.
 *
 * The bug: `initialRouteName` was hardcoded to `welcome`, and Welcome's only
 * action is the QR scanner. Nothing in the logout path removes `baseUrl`,
 * `api_key` or `app_key`, so an employee whose token expired was sent to
 * re-provision a device that was still provisioned — to reach a password field
 * that had been ready the whole time. A client reported exactly this.
 *
 * Both directions matter, so both are pinned: first-time onboarding must still
 * reach the QR scanner.
 */

const screens = {
  login: "LOGIN SCREEN",
  Qrscan: "QR SCAN SCREEN",
  welcome: "WELCOME SCREEN",
};

// The real screens drag in the whole app (redux, camera, theming). This suite is
// about the routing decision, so each one is reduced to its name.
jest.mock("../screens", () => {
  const { Text } = require("react-native");
  return {
    Login: () => <Text>LOGIN SCREEN</Text>,
    QrScan: () => <Text>QR SCAN SCREEN</Text>,
    WelcomeScreen: () => <Text>WELCOME SCREEN</Text>,
  };
});

/* eslint-disable import/first */
import { NavigationContainer } from "@react-navigation/native";
import AuthNavigator from "../navigation/auth-navigator";
import { readProvisioning } from "../utils/provisioning";
/* eslint-enable import/first */

const provision = async (overrides = {}) => {
  const values = {
    baseUrl: "https://aysha.erpgulf.com",
    api_key: "key-123",
    app_key: "app-456",
    ...overrides,
  };

  await Promise.all(
    Object.entries(values)
      .filter(([, value]) => value != null)
      .map(([key, value]) => AsyncStorage.setItem(key, value)),
  );
};

const renderAuthNavigator = () =>
  render(
    <NavigationContainer>
      <AuthNavigator />
    </NavigationContainer>,
  );

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("readProvisioning", () => {
  it("reports a fully provisioned device", async () => {
    await provision();

    await expect(readProvisioning()).resolves.toMatchObject({
      baseUrl: "https://aysha.erpgulf.com",
      api_key: "key-123",
      app_key: "app-456",
      provisioned: true,
    });
  });

  it("is not provisioned when nothing has been scanned", async () => {
    await expect(readProvisioning()).resolves.toMatchObject({
      provisioned: false,
    });
  });

  // All three or nothing — a half-written scan cannot log anybody in, and
  // treating it as provisioned would strand the user on a login screen that
  // rejects every password.
  it.each(["baseUrl", "api_key", "app_key"])(
    "is not provisioned when %s is missing",
    async (missing) => {
      await provision({ [missing]: null });

      await expect(readProvisioning()).resolves.toMatchObject({
        provisioned: false,
      });
    },
  );
});

describe("AuthNavigator's first screen", () => {
  it("goes straight to Login when the device is already provisioned", async () => {
    // The state a session expiry leaves behind: tenant keys intact, no token.
    await provision();

    const { findByText, queryByText } = renderAuthNavigator();

    expect(await findByText(screens.login)).toBeTruthy();
    expect(queryByText(screens.Qrscan)).toBeNull();
    expect(queryByText(screens.welcome)).toBeNull();
  });

  it("shows Welcome for a device that has never been provisioned", async () => {
    const { findByText, queryByText } = renderAuthNavigator();

    expect(await findByText(screens.welcome)).toBeTruthy();
    expect(queryByText(screens.login)).toBeNull();
  });

  it("shows Welcome when provisioning is incomplete", async () => {
    await provision({ app_key: null });

    const { findByText } = renderAuthNavigator();

    expect(await findByText(screens.welcome)).toBeTruthy();
  });

  // Rendering before the decision resolves would bake in whichever route the
  // navigator defaulted to, which is the whole bug in a different costume.
  it("renders nothing until it knows which screen it is opening on", async () => {
    await provision();

    const { queryByText } = renderAuthNavigator();

    expect(queryByText(screens.login)).toBeNull();
    expect(queryByText(screens.welcome)).toBeNull();

    await waitFor(() => expect(queryByText(screens.login)).toBeTruthy());
  });
});
