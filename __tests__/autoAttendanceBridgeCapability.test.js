jest.mock("expo", () => {
  const native = {
    startGeofence: jest.fn(async () => {}), stopGeofence: jest.fn(async () => {}),
    getPendingEvents: jest.fn(() => []), acknowledgeEvent: jest.fn(),
  };
  return { requireOptionalNativeModule: () => native };
});

import { requireOptionalNativeModule } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startGeofence } from "../modules/expo-auto-attendance";
import { store } from "../redux/Store";
import { settingsReceived, settingsInvalidated } from "../redux/Slices/FeatureSettingsSlice";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";

const native = requireOptionalNativeModule();
const employeeCode = "EMP-SYNTHETIC";
const office = { identifier: "office-main", latitude: 25.28, longitude: 51.52, radius: 100,
  tenantKey: TEST_TENANT, employeeId: employeeCode, geotagging: 2, registrationId: "synthetic-registration" };
const receive = value => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeCode),
  settings: normalizeFeatureSettings({ attendance_action: { auto_attendance: value } }),
}));

beforeEach(async () => {
  await AsyncStorage.clear(); await loginQueueEmployee(employeeCode);
  store.dispatch(settingsInvalidated());
  jest.clearAllMocks();
  native.startGeofence.mockResolvedValue(undefined);
  native.stopGeofence.mockResolvedValue(undefined);
});

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

it("removes an old tenant registration if provisioning changes while native is pending", async () => {
  native.startGeofence.mockImplementation(async () => loginQueueEmployee(employeeCode, "https://other.example.test"));
  await expect(startGeofence(office)).rejects.toMatchObject({ code: "CAPABILITY_SCOPE_CHANGED" });
  expect(native.stopGeofence).toHaveBeenCalledTimes(1);
});
