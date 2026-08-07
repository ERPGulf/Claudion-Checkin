jest.mock("../services/api/attendance.service", () => ({
  __esModule: true,
  getOfficeLocation: jest.fn(),
}));

jest.mock("../services/offline/NetworkListener", () => ({
  __esModule: true,
  fetchIsOnline: jest.fn(() => Promise.resolve(true)),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { CONFIG_KEY } from "../services/offline/attendanceConfigCache";
import { resolveNearestOffice } from "../services/offline/offlineAttendanceGate";
import { getOfficeLocation } from "../services/api/attendance.service";
import { fetchIsOnline } from "../services/offline/NetworkListener";

/**
 * The question "am I at the office?" is asked *before* a check-in, to decide
 * whether the button is even enabled. Offline that used to throw, leaving
 * `inTarget` false and the button disabled — offline attendance unreachable from
 * the UI on precisely the location-restricted tenants that need it.
 */
const cachedConfig = {
  employeeId: "TDI0167",
  locations: [
    {
      location: "Doha HQ",
      latitude: 25.28,
      longitude: 51.52,
      reporting_radius: 200,
    },
  ],
  rules: { restrictLocation: 1 },
  lastUpdated: Date.now(),
};

const atTheOffice = {
  coords: { latitude: 25.2801, longitude: 51.5201, accuracy: 10 },
  timestamp: Date.now(),
};

const networkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  fetchIsOnline.mockResolvedValue(true);
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getCurrentPositionAsync.mockResolvedValue(atTheOffice);
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
});

describe("when online", () => {
  it("uses the server's answer unchanged", async () => {
    getOfficeLocation.mockResolvedValue({
      locationName: "Doha HQ",
      distance: 12,
      radius: 200,
      withinRadius: true,
    });

    const nearest = await resolveNearestOffice("TDI0167");

    expect(nearest).toMatchObject({ locationName: "Doha HQ", fromCache: false });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("reports no office when the server says none are configured", async () => {
    getOfficeLocation.mockResolvedValue(null);
    expect(await resolveNearestOffice("TDI0167")).toBeNull();
  });

  // A denial is a real refusal, not a connectivity problem — answering it from a
  // cached location would report a position the app is no longer allowed to know.
  it("propagates a permission denial rather than falling back", async () => {
    getOfficeLocation.mockRejectedValue(new Error("Location permission denied"));
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));

    await expect(resolveNearestOffice("TDI0167")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("when the request fails on the network", () => {
  it("falls back to the cached configuration", async () => {
    getOfficeLocation.mockRejectedValue(networkError());
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));

    const nearest = await resolveNearestOffice("TDI0167");

    expect(nearest).toMatchObject({
      locationName: "Doha HQ",
      withinRadius: true,
      fromCache: true,
    });
  });
});

describe("when offline", () => {
  beforeEach(() => fetchIsOnline.mockResolvedValue(false));

  it("does not attempt the request at all", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));

    await resolveNearestOffice("TDI0167");

    expect(getOfficeLocation).not.toHaveBeenCalled();
  });

  // The whole point: `inTarget` stays true, so the button stays enabled.
  it("reports being inside the radius from cached locations", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));

    expect((await resolveNearestOffice("TDI0167")).withinRadius).toBe(true);
  });

  it("reports being outside it, so the gate still bites", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    Location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 25.35, longitude: 51.6, accuracy: 10 },
      timestamp: Date.now(),
    });

    const nearest = await resolveNearestOffice("TDI0167");

    expect(nearest.withinRadius).toBe(false);
    expect(nearest.distance).toBeGreaterThan(200);
  });

  it("returns null with no cached configuration", async () => {
    expect(await resolveNearestOffice("TDI0167")).toBeNull();
  });

  it("returns null when no position can be obtained", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));

    expect(await resolveNearestOffice("TDI0167")).toBeNull();
  });

  it("returns null when location permission is not granted", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });

    expect(await resolveNearestOffice("TDI0167")).toBeNull();
  });

  it("accepts a recent last-known fix when the live one does not arrive", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));
    Location.getLastKnownPositionAsync.mockResolvedValue({
      ...atTheOffice,
      timestamp: Date.now() - 30 * 1000,
    });

    expect((await resolveNearestOffice("TDI0167")).withinRadius).toBe(true);
  });

  // An hour-old fix is not evidence of where you are standing now.
  it("rejects a stale last-known fix", async () => {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cachedConfig));
    Location.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));
    Location.getLastKnownPositionAsync.mockResolvedValue({
      ...atTheOffice,
      timestamp: Date.now() - 60 * 60 * 1000,
    });

    expect(await resolveNearestOffice("TDI0167")).toBeNull();
  });
});
