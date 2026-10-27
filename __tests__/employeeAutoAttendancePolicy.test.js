import AsyncStorage from "@react-native-async-storage/async-storage";
import { store } from "../redux/Store";
import { revertAll } from "../redux/CommonActions";
import { loginQueueEmployee, TEST_TENANT } from "../test-utils/attendanceScope";
import { captureAttendanceQueueScope } from "../services/offline/attendanceQueueProvenance";
import {
  parseEmployeeGeotagging,
  beginEmployeeAutoAttendancePolicyReception,
  receiveEmployeeAutoAttendancePolicy,
  restoreEmployeeAutoAttendancePolicy,
  assertEmployeeAutoAttendancePolicy,
  getEmployeeLocationPolicyCurrent,
} from "../services/employeeAutoAttendancePolicy";

const employeeId = "EMP-SYNTHETIC-POLICY";
let owner;
const receive = async mode => {
  const ticket = beginEmployeeAutoAttendancePolicyReception(owner);
  return receiveEmployeeAutoAttendancePolicy({ geotagging: mode }, ticket);
};
const cached = (mode, overrides = {}) => ({
  tenantKey: TEST_TENANT, employeeId, rules: { geotagging: mode },
  locations: [], lastUpdated: Date.now() + 60000, ...overrides,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  store.dispatch(revertAll());
  await loginQueueEmployee(employeeId);
  owner = await captureAttendanceQueueScope(employeeId);
});

it.each([0, 1, 2, "0", " 1 ", "2"])("accepts only an explicit enum: %j", value => {
  expect(parseEmployeeGeotagging(value)).toBe(Number(value));
});
it.each([undefined, null, false, true, "", "  ", "2.0", 3, -1, 1.5, {}, []])(
  "does not invent an employee mode from %j", value => {
    expect(parseEmployeeGeotagging(value)).toBeNull();
  },
);

it.each([0, 1, 2])("keeps a received mode %s when a later response omits or corrupts it", async mode => {
  await receive(mode);
  await receive(undefined);
  await receive("invalid");
  expect(store.getState().autoAttendance.employeePolicy).toMatchObject({ mode, source: "response" });
  if (mode === 2) await expect(assertEmployeeAutoAttendancePolicy(owner)).resolves.toMatchObject({ mode });
  else await expect(assertEmployeeAutoAttendancePolicy(owner)).rejects.toMatchObject({ mode });
});

it("does not infer disabled policy from an absent mode or grant actions from the legacy UI setter", async () => {
  await receive(undefined);
  store.dispatch({ type: "autoAttendance/setAutoAttendanceGeotagging", payload: 2 });
  expect(store.getState().autoAttendance.employeePolicy).toBeNull();
  await expect(assertEmployeeAutoAttendancePolicy(owner)).rejects.toMatchObject({
    code: "EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE",
  });
});

it("uses request order when revocation and re-enable responses arrive out of order", async () => {
  const old = beginEmployeeAutoAttendancePolicyReception(owner);
  const latest = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, latest);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 0 }, old);
  await expect(assertEmployeeAutoAttendancePolicy(owner)).resolves.toMatchObject({ mode: 2, revision: latest.revision });
});

it.each([[0, 2], [2, 0]])("a received mode %s wins over cached mode %s even with a later cache timestamp", async (mode, oldMode) => {
  await receive(mode);
  const result = await restoreEmployeeAutoAttendancePolicy(owner, cached(oldMode));
  expect(result).toMatchObject({ mode, source: "response" });
});

it("seeds an owned cache at cold boot and replaces it with an explicit live response", async () => {
  await restoreEmployeeAutoAttendancePolicy(owner, cached(1));
  await expect(assertEmployeeAutoAttendancePolicy(owner)).rejects.toMatchObject({ mode: 1 });
  await receive(2);
  await expect(assertEmployeeAutoAttendancePolicy(owner)).resolves.toMatchObject({ mode: 2, source: "response" });
});

it("does not authorize a coerced cache mode marked as non-explicit", async () => {
  expect(await restoreEmployeeAutoAttendancePolicy(owner, cached(2, { employeePolicyExplicit: false }))).toBeNull();
  await expect(assertEmployeeAutoAttendancePolicy(owner)).rejects.toMatchObject({
    code: "EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE",
  });
});

it.each([
  { tenantKey: "https://other-synthetic.example.test" },
  { employeeId: "EMP-OTHER-SYNTHETIC" },
])("refuses a foreign cache: %j", async overrides => {
  expect(await restoreEmployeeAutoAttendancePolicy(owner, cached(2, overrides))).toBeNull();
  expect(store.getState().autoAttendance.employeePolicy).toBeNull();
});

it.each([TEST_TENANT, "https://other-synthetic.example.test"])("does not receive a response after auth generation/tenant changes to %s", async tenant => {
  const ticket = beginEmployeeAutoAttendancePolicyReception(owner);
  await loginQueueEmployee(employeeId, tenant);
  await expect(receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, ticket)).rejects.toBeDefined();
  expect(store.getState().autoAttendance.employeePolicy).toBeNull();
});

it("receives mandatory location facts without an automatic mode and retains them for partial/malformed responses", async () => {
  const locations = [{ location: "Synthetic office", latitude: 25.2, longitude: 55.3, reporting_radius: 150 }];
  let ticket = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ restrict_location: true, unrestricted_checkout_location: false,
    employee_locations: locations }, ticket);
  expect(store.getState().autoAttendance.employeePolicy).toBeNull();
  expect(getEmployeeLocationPolicyCurrent(owner)).toMatchObject({ employeeRestrictLocation: 1,
    employeeUnrestrictedCheckout: 0, geometryKey: JSON.stringify(locations) });
  ticket = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2, restrict_location: null,
    unrestricted_checkout_location: "malformed", employee_locations: null }, ticket);
  expect(getEmployeeLocationPolicyCurrent(owner)).toMatchObject({ employeeRestrictLocation: 1,
    employeeUnrestrictedCheckout: 0, geometryKey: JSON.stringify(locations) });
  await expect(assertEmployeeAutoAttendancePolicy(owner)).resolves.toMatchObject({ mode: 2 });
});

it("ignores older location responses, restores no location authority from auto cache, and permits a newer explicit release", async () => {
  const older = beginEmployeeAutoAttendancePolicyReception(owner);
  const latest = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ restrict_location: 1, unrestricted_checkout_location: 0 }, latest);
  await receiveEmployeeAutoAttendancePolicy({ restrict_location: 0, unrestricted_checkout_location: 1 }, older);
  await restoreEmployeeAutoAttendancePolicy(owner, cached(2));
  expect(getEmployeeLocationPolicyCurrent(owner)).toMatchObject({ employeeRestrictLocation: 1, employeeUnrestrictedCheckout: 0 });
  const release = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ restrict_location: "0", unrestricted_checkout_location: "1" }, release);
  expect(getEmployeeLocationPolicyCurrent(owner)).toMatchObject({ employeeRestrictLocation: 0, employeeUnrestrictedCheckout: 1 });
});

it("does not return another tenant or account's mandatory location metadata", async () => {
  const ticket = beginEmployeeAutoAttendancePolicyReception(owner);
  await receiveEmployeeAutoAttendancePolicy({ restrict_location: 1 }, ticket);
  expect(getEmployeeLocationPolicyCurrent({ ...owner, tenantKey: "https://foreign-synthetic.example.test" })).toBeNull();
  expect(getEmployeeLocationPolicyCurrent({ ...owner, accountId: "foreign-synthetic-account" })).toBeNull();
});
