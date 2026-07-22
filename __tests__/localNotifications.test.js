// The factory must not reference outer variables: localNotifications.js calls
// setNotificationHandler at import time, which runs this factory before any
// top-level `const` in the test has initialized. Create the jest.fn()s inside
// the factory and reach them through the imported module instead.
jest.mock("expo-notifications", () => ({
  __esModule: true,
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("notif-id")),
  AndroidImportance: { HIGH: 4 },
}));

import * as Notifications from "expo-notifications";
import {
  ensureNotificationSetup,
  presentLocalNotification,
} from "../services/notifications/localNotifications";

describe("localNotifications", () => {
  beforeEach(() => {
    Notifications.getPermissionsAsync.mockReset();
    Notifications.requestPermissionsAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockReset();
    Notifications.scheduleNotificationAsync.mockResolvedValue("notif-id");
  });

  it("presents a notification with the given title/body when permission is granted", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true });

    await presentLocalNotification({
      title: "Checked out",
      body: "You left the office, so you've been checked out automatically.",
      data: { type: "auto-checkout" },
    });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const request = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(request.content).toMatchObject({
      title: "Checked out",
      body: "You left the office, so you've been checked out automatically.",
      data: { type: "auto-checkout" },
    });
  });

  it("requests permission when not yet granted but still allowed to ask", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });

    await presentLocalNotification({ title: "t", body: "b" });

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("does not present (and never throws) when permission is permanently denied", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });

    await expect(
      presentLocalNotification({ title: "t", body: "b" }),
    ).resolves.toBeUndefined();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("swallows native-layer errors so a failed alert can't break check-out", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    Notifications.scheduleNotificationAsync.mockRejectedValueOnce(
      new Error("native module missing"),
    );

    await expect(
      presentLocalNotification({ title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });

  it("ensureNotificationSetup returns true when permission is already granted", async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    await expect(ensureNotificationSetup()).resolves.toBe(true);
  });
});
