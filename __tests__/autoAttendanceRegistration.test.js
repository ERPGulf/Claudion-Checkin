jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: jest.fn(), getBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(),
}));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main", startGeofence: jest.fn(), stopGeofence: jest.fn(),
  getRegisteredGeofences: jest.fn(), isMonitoring: jest.fn(), hasFullAccuracy: jest.fn(),
}));
jest.mock("../services/offline/attendanceQueueProvenance", () => ({ assertAttendanceQueueScope: jest.fn() }));

import * as Location from "expo-location";
import * as Native from "../modules/expo-auto-attendance";
import { createRegistrationId, reconcileAutoAttendanceRegistration } from "../utils/autoAttendanceRegistration";

const scope = { tenantKey: "https://attendance.example.com", employeeId: "EMP-001" };
const office = { latitude: 25.28, longitude: 51.52, reporting_radius: 100, location: "Office" };
const config = { ...scope, rules: { geotagging: 2 }, locations: [office] };
const registered = (overrides = {}) => {
  const value = { ...scope, identifier: "office-main", latitude: office.latitude, longitude: office.longitude,
    radius: 100, geotagging: 2, ...overrides };
  return { ...value, registrationId: createRegistrationId(value) };
};

beforeEach(() => {
  jest.clearAllMocks();
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 25.28, longitude: 51.52 } });
  Location.getLastKnownPositionAsync.mockResolvedValue(null);
  Native.getRegisteredGeofences.mockReturnValue([]);
  Native.isMonitoring.mockReturnValue(false);
  Native.hasFullAccuracy.mockReturnValue(true);
  Native.stopGeofence.mockResolvedValue(undefined);
  Native.startGeofence.mockResolvedValue(undefined);
});

it("registers a single configured office without GPS or an inside snapshot", async () => {
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ ...scope, radius: 100, geotagging: 2 }));
});

it.each([
  { latitude: 26 }, { radius: 200 }, { tenantKey: "https://other.example.com" }, { employeeId: "EMP-OTHER" }, { geotagging: 1 },
])("replaces a stale active registration: %p", async overrides => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered(overrides)]);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
  expect(Native.stopGeofence.mock.invocationCallOrder[0]).toBeLessThan(Native.startGeofence.mock.invocationCallOrder[0]);
});

it("retains an exact current registration", async () => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.stopGeofence).not.toHaveBeenCalled();
});

it("does not churn an iOS radius clamped by Core Location", async () => {
  const desired = registered({ radius: 2000 });
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([{ ...desired, radius: 1000, requestedRadius: 2000 }]);
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [{ ...office, reporting_radius: 2000 }] });
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("permission denial stops monitoring without requesting permission", async () => {
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: "denied" });
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("reduced precision stops registration until permission is restored", async () => {
  Native.hasFullAccuracy.mockReturnValue(false);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  Native.hasFullAccuracy.mockReturnValue(true);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("removes stale radius when multiple offices cannot be selected without GPS", async () => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered({ radius: 200 })]);
  Location.getCurrentPositionAsync.mockRejectedValue(new Error("GPS off"));
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [office, { ...office, latitude: 26 }] });
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("repairs unavailable native monitoring even when saved geometry matches", async () => {
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("preserves warnings-only registration and stops disabled policy", async () => {
  await reconcileAutoAttendanceRegistration(scope, { ...config, rules: { geotagging: 1 } });
  expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ geotagging: 1 }));
  Native.startGeofence.mockClear();
  await reconcileAutoAttendanceRegistration(scope, { ...config, rules: { geotagging: 0 } });
  expect(Native.startGeofence).not.toHaveBeenCalled();
});
