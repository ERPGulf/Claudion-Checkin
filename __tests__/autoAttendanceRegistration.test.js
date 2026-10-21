jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: jest.fn(), getBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(),
}));
jest.mock("../modules/expo-auto-attendance", () => ({
  OFFICE_GEOFENCE_IDENTIFIER: "office-main", startGeofence: jest.fn(), stopGeofence: jest.fn(),
  getRegisteredGeofences: jest.fn(), isMonitoring: jest.fn(), hasFullAccuracy: jest.fn(),
  retryInitialPresence: jest.fn(),
}));

import * as Location from "expo-location";
import * as Native from "../modules/expo-auto-attendance";
import { createRegistrationId, nativeRadiusMatchesRequested, reconcileAutoAttendanceRegistration } from "../utils/autoAttendanceRegistration";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loginQueueEmployee } from "../test-utils/attendanceScope";
import { store } from "../redux/Store";
import { settingsReceived } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";

let scope = { tenantKey: "https://attendance.example.com", employeeId: "EMP-001" };
const office = { latitude: 25.28, longitude: 51.52, reporting_radius: 100, location: "Office" };
const config = { ...scope, rules: { geotagging: 2 }, locations: [office] };
const receiveMode = async mode => receiveEmployeeAutoAttendancePolicy({ geotagging: mode },
  beginEmployeeAutoAttendancePolicyReception(await captureAttendanceQueueScope(scope.employeeId)));
const registered = (overrides = {}) => {
  const value = { ...scope, identifier: "office-main", latitude: office.latitude, longitude: office.longitude,
    radius: 100, geotagging: 2, ...overrides };
  return { ...value, registrationId: createRegistrationId(value) };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await loginQueueEmployee(scope.employeeId, scope.tenantKey);
  scope = await captureAttendanceQueueScope(scope.employeeId);
  store.dispatch({ type: "REVERT_ALL" });
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
  Native.retryInitialPresence.mockResolvedValue(false);
  await receiveMode(2);
});

const receiveAutomaticAvailability = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(scope.tenantKey, scope.employeeId),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: value } }),
}));
const receiveGeo = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(scope.tenantKey, scope.employeeId),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: true, geo_tagging: value } }),
}));

it.each([false, 0, null])("stops tenant geo %s despite employee mode 2 and an existing registration", async value => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  receiveGeo(value);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.retryInitialPresence).not.toHaveBeenCalled();
});

it("does not register after tenant geo is revoked during office GPS selection", async () => {
  Location.getCurrentPositionAsync.mockImplementationOnce(async () => {
    receiveGeo(0);
    return { coords: { latitude: office.latitude, longitude: office.longitude } };
  });
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [office, { ...office, latitude: 26 }] });
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
});

it("removes retained monitoring when tenant geo is disabled during an initial-presence retry", async () => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  Native.retryInitialPresence.mockImplementationOnce(async () => receiveGeo(0));
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("removes monitoring when tenant geo changes during native registration", async () => {
  Native.startGeofence.mockImplementationOnce(async () => receiveGeo(0));
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(2);
});

it("stops a tenant-disabled fence even when employee mode and permissions permit monitoring", async () => {
  receiveAutomaticAvailability(false);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("checks a received denial after asynchronous office selection", async () => {
  let releasePosition;
  let requestedPosition;
  const positionRequested = new Promise(resolve => { requestedPosition = resolve; });
  Location.getCurrentPositionAsync.mockImplementation(() => {
    requestedPosition();
    return new Promise(resolve => { releasePosition = resolve; });
  });
  const registration = reconcileAutoAttendanceRegistration(scope, {
    ...config, locations: [office, { ...office, latitude: 26 }],
  });
  await positionRequested;
  receiveAutomaticAvailability(false);
  releasePosition({ coords: { latitude: office.latitude, longitude: office.longitude } });
  await registration;
  expect(Native.startGeofence).not.toHaveBeenCalled();
  expect(Native.stopGeofence).toHaveBeenCalled();
});

it("stops a registration if capability changes while native registration is pending", async () => {
  Native.startGeofence.mockImplementation(async () => receiveAutomaticAvailability(false));
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(2);
});

it("registers a single configured office without GPS or an inside snapshot", async () => {
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ tenantKey: scope.tenantKey,
    employeeId: scope.employeeId, radius: 100, geotagging: 2 }), scope);
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

it.each([100, 100.1, 100.3])("retains a scoped older Android registration rounded from %s meters", async radius => {
  const desired = registered({ radius });
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([{ ...desired, radius: Math.fround(radius) }]);
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [{ ...office, reporting_radius: radius }] });
  expect(Native.stopGeofence).not.toHaveBeenCalled();
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("retains the requested fractional radius alongside the actual Android radius", async () => {
  const desired = registered({ radius: 100.3 });
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([{ ...desired, radius: Math.fround(100.3), requestedRadius: 100.3 }]);
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [{ ...office, reporting_radius: 100.3 }] });
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("replaces an actual native radius inconsistent with its requested fingerprint", async () => {
  const desired = registered({ radius: 100.3 });
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([{ ...desired, radius: 100.4, requestedRadius: 100.3 }]);
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [{ ...office, reporting_radius: 100.3 }] });
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("does not infer an old fractional requested radius from a different configuration fingerprint", async () => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered({ radius: Math.fround(100.3) })]);
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [{ ...office, reporting_radius: 100.3 }] });
  expect(Native.startGeofence).toHaveBeenCalledTimes(1);
});

it("retains a fingerprint-proven fractional office when multi-office GPS is unavailable", async () => {
  const desired = registered({ radius: 100.3 });
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([{ ...desired, radius: Math.fround(100.3) }]);
  Location.getCurrentPositionAsync.mockRejectedValue(new Error("GPS off"));
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [
    { ...office, reporting_radius: 100.3 }, { ...office, latitude: 26 },
  ] });
  expect(Native.stopGeofence).not.toHaveBeenCalled();
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it.each([
  [{ radius: Math.fround(100.3), requestedRadius: 100.3 }, 100.3, true],
  [{ radius: Math.fround(100.1) }, 100.1, true],
  [{ radius: Math.fround(100.3) }, 100.3, true],
  [{ radius: 1000, requestedRadius: 2000 }, 2000, true],
  [{ radius: 100.4, requestedRadius: 100.3 }, 100.3, false],
  [{ radius: 100, requestedRadius: 200 }, 100, false],
  [{ radius: 0 }, 100, false],
  [{ radius: Infinity }, 100, false],
  [{ radius: 100 }, NaN, false],
])("validates native radius representation %p against %s", (native, requested, matches) => {
  expect(nativeRadiusMatchesRequested(native, requested)).toBe(matches);
});

it("requests a bounded pending initial-state retry only for the current matching registration", async () => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.retryInitialPresence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
  Native.retryInitialPresence.mockClear();
  Native.getRegisteredGeofences.mockReturnValue([registered({ radius: 200 })]);
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.retryInitialPresence).not.toHaveBeenCalled();
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
  await receiveMode(1);
  await reconcileAutoAttendanceRegistration(scope, { ...config, rules: { geotagging: 1 } });
  expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ geotagging: 1 }), scope);
  Native.startGeofence.mockClear();
  await receiveMode(0);
  await reconcileAutoAttendanceRegistration(scope, { ...config, rules: { geotagging: 0 } });
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it.each([0, 1])("uses employee mode %s received during office GPS selection", async mode => {
  Location.getCurrentPositionAsync.mockImplementation(async () => {
    await receiveMode(mode);
    return { coords: { latitude: office.latitude, longitude: office.longitude } };
  });
  await reconcileAutoAttendanceRegistration(scope, { ...config, locations: [office, { ...office, latitude: 26 }] });
  if (mode === 0) expect(Native.startGeofence).not.toHaveBeenCalled();
  else expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ geotagging: 1 }), scope);
});

it.each([0, 1])("stops a retained registration when employee mode changes to %s during native initial-presence retry", async mode => {
  Native.isMonitoring.mockReturnValue(true);
  Native.getRegisteredGeofences.mockReturnValue([registered()]);
  Native.retryInitialPresence.mockImplementationOnce(async () => receiveMode(mode));
  await reconcileAutoAttendanceRegistration(scope, config);
  expect(Native.stopGeofence).toHaveBeenCalledTimes(1);
  expect(Native.startGeofence).not.toHaveBeenCalled();
});

it("uses a received employee re-enable over an older config denial", async () => {
  await receiveMode(0);
  await receiveMode(2);
  await reconcileAutoAttendanceRegistration(scope, { ...config, rules: { geotagging: 0 } });
  expect(Native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ geotagging: 2 }), scope);
});
