jest.mock("expo", () => {
  const native = {
    startGeofence: jest.fn(async () => {}), stopGeofence: jest.fn(async () => {}),
    retryInitialPresence: jest.fn(async () => false),
    getPendingEvents: jest.fn(() => []), acknowledgeEvent: jest.fn(),
  };
  return { requireOptionalNativeModule: () => native };
});

import { requireOptionalNativeModule } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startGeofence, retryInitialPresence } from "../modules/expo-auto-attendance";
import { store } from "../redux/Store";
import { settingsReceived, settingsInvalidated } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import * as provenance from "../services/offline/attendanceQueueProvenance";
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from "../services/employeeAutoAttendancePolicy";
import * as employeePolicy from "../services/employeeAutoAttendancePolicy";

const native = requireOptionalNativeModule();
const employeeCode = "EMP-SYNTHETIC";
const office = { identifier: "office-main", latitude: 25.28, longitude: 51.52, radius: 100,
  tenantKey: TEST_TENANT, employeeId: employeeCode, geotagging: 2, registrationId: "synthetic-registration" };
const receive = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeCode),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: value } }),
}));
const receiveMode = async mode => receiveEmployeeAutoAttendancePolicy({ geotagging: mode },
  beginEmployeeAutoAttendancePolicyReception(await captureAttendanceQueueScope(employeeCode)));
const receiveGeo = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeCode),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: true, geo_tagging: value } }),
}));

beforeEach(async () => {
  await AsyncStorage.clear(); await loginQueueEmployee(employeeCode);
  store.dispatch(settingsInvalidated());
  jest.clearAllMocks();
  native.startGeofence.mockResolvedValue(undefined);
  native.stopGeofence.mockResolvedValue(undefined);
  native.retryInitialPresence.mockResolvedValue(false);
  await receiveMode(2);
});
afterEach(() => jest.restoreAllMocks());

it("refuses direct bridge registration when the automatic feature is disabled", async () => {
  receive(false);
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.startGeofence).not.toHaveBeenCalled();
});

it("preserves existing native options when the feature is enabled", async () => {
  receive(true);
  native.startGeofence.mockResolvedValueOnce("synthetic-native-result");
  await expect(startGeofence(office)).resolves.toBe("synthetic-native-result");
  expect(native.startGeofence).toHaveBeenCalledWith(office);
  expect(native.stopGeofence).not.toHaveBeenCalled();
});

it("removes monitoring if a denial arrives while the native operation is pending", async () => {
  native.startGeofence.mockImplementation(async () => receive(false));
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it.each([false, 0, null])("refuses direct monitoring with tenant geo %s and employee mode 2", async value => {
  receiveGeo(value);
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.startGeofence).not.toHaveBeenCalled();
});

it("rechecks tenant geo after the awaited employee authorization before native dispatch", async () => {
  const authorize = employeePolicy.assertEmployeeAutoAttendancePolicy;
  jest.spyOn(employeePolicy, "assertEmployeeAutoAttendancePolicy").mockImplementationOnce(async (...args) => {
    const policy = await authorize(...args);
    receiveGeo(0);
    return policy;
  });
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.startGeofence).not.toHaveBeenCalled();
});

it("removes a pending native registration when tenant geo is disabled", async () => {
  native.startGeofence.mockImplementationOnce(async () => receiveGeo(0));
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it("stops an initial-presence retry after tenant geo is disabled", async () => {
  native.retryInitialPresence.mockImplementationOnce(async () => receiveGeo(0));
  await expect(retryInitialPresence()).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it("removes an old tenant registration if provisioning changes while native is pending", async () => {
  native.startGeofence.mockImplementation(async () => loginQueueEmployee(employeeCode, "https://other.example.test"));
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "CAPABILITY_SCOPE_CHANGED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it("rejects direct monitoring under employee mode 0", async () => {
  await receiveMode(0);
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "EMPLOYEE_AUTO_ATTENDANCE_DISABLED" });
  expect(native.startGeofence).not.toHaveBeenCalled();
});

it("allows warnings-only monitoring under independently received employee mode 1", async () => {
  await receiveMode(1);
  await startGeofence({ ...office, geotagging: 1 });
  expect(native.startGeofence).toHaveBeenCalledWith(expect.objectContaining({ geotagging: 1 }));
});

it.each([0, 1])("removes a pending mode 2 native registration after employee mode changes to %s", async mode => {
  native.startGeofence.mockImplementationOnce(async () => receiveMode(mode));
  await expect(startGeofence(office)).rejects.toMatchObject({ code: mode === 0
    ? "EMPLOYEE_AUTO_ATTENDANCE_DISABLED" : "EMPLOYEE_AUTO_ATTENDANCE_POLICY_CHANGED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it("does not retry initial presence under employee mode 0", async () => {
  await receiveMode(0);
  await expect(retryInitialPresence()).rejects.toMatchObject({ code: "EMPLOYEE_AUTO_ATTENDANCE_DISABLED" });
  expect(native.retryInitialPresence).not.toHaveBeenCalled();
});

it("stops native monitoring when mode is revoked during initial-presence retry", async () => {
  native.retryInitialPresence.mockImplementationOnce(async () => receiveMode(0));
  await expect(retryInitialPresence()).rejects.toMatchObject({ code: "EMPLOYEE_AUTO_ATTENDANCE_DISABLED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});

it.each(["start", "initial presence"])("keeps the first observed owner for an unscoped direct %s call", async operation => {
  const originalRead = provenance.readAttendanceQueueScope;
  jest.spyOn(provenance, "readAttendanceQueueScope").mockImplementationOnce(async () => {
    const originalOwner = await originalRead();
    await loginQueueEmployee(employeeCode, "https://other-synthetic.example.test");
    await receiveMode(2);
    return originalOwner;
  });
  const result = operation === "start"
    ? startGeofence({ identifier: "office-main", latitude: 25, longitude: 51, radius: 100 })
    : retryInitialPresence();
  await expect(result).rejects.toMatchObject({ code: "CAPABILITY_SCOPE_CHANGED" });
  expect(native.startGeofence).not.toHaveBeenCalled();
  expect(native.retryInitialPresence).not.toHaveBeenCalled();
});
