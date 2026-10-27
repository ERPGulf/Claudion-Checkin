import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateAuthSession, invalidateAuthSession } from "../utils/authSessionGuard";
import { buildSettingsScope, normalizeFeatureSettings } from "../utils/featureSettings";

export const TEST_TENANT = "https://attendance.example.com";
export const loginQueueEmployee = async (employeeId, tenantKey = TEST_TENANT, token = "synthetic-access") => {
  const generation = invalidateAuthSession();
  await AsyncStorage.multiSet([
    ["employee_code", employeeId], ["baseUrl", tenantKey],
    ["access_token", token], ["api_key", `account-${employeeId}`],
  ]);
  activateAuthSession(generation);
};

/**
 * The fetched `featureSettings` slice of an employer that has enabled
 * automatic attendance for this account — the tenant `geo_tagging: true`
 * monitoring requires.
 */
export const automaticAttendanceSettings = (employeeId, tenantKey = TEST_TENANT, attendanceAction = {}) => ({
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true, ...attendanceAction } }),
  scope: buildSettingsScope(tenantKey, employeeId),
  status: "success",
  error: null,
  lastFetchedAt: Date.now(),
});

/** The employer enables automatic attendance for an account, in the app's store. */
export const enableAutomaticAttendance = (employeeId, tenantKey = TEST_TENANT) => {
  // Required here so a suite's own mock of the store is the one dispatched to.
  const { store } = require("../redux/Store");
  const { settingsReceived } = require("../redux/Slices/FeatureSettingsSlice");
  store.dispatch(settingsReceived(automaticAttendanceSettings(employeeId, tenantKey)));
};
