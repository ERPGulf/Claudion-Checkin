/** Employee automatic policy reception/evaluation using the existing Redux slice. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../redux/Store';
import {
  employeePolicyRequested, employeePolicyReceived, employeePolicyRestored,
} from '../redux/Slices/AutoAttendanceSlice';
import { buildSettingsScope } from '../utils/featureSettings';
import {
  assertAttendanceQueueScope, assertAttendanceSessionCurrent,
} from './offline/attendanceQueueProvenance';

export const EMPLOYEE_AUTO_ATTENDANCE_DISABLED = 'EMPLOYEE_AUTO_ATTENDANCE_DISABLED';
export const EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE = 'EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE';
let sequence = 0;

export const parseEmployeeGeotagging = value => {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 2 ? value : null;
  return typeof value === 'string' && /^[012]$/.test(value.trim()) ? Number(value.trim()) : null;
};
const policyScope = owner => buildSettingsScope(owner?.tenantKey, owner?.employeeId);
const matchingPolicy = owner => {
  const policy = store.getState?.()?.autoAttendance?.employeePolicy;
  return policy?.scope === policyScope(owner) && policy.accountId === (owner.accountId ?? null) ? policy : null;
};

const parseEmployeeLocationFlag = value => {
  if (typeof value === 'string') value = value.trim();
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
};

const receivedLocationPolicy = employee => {
  const locationPolicy = {};
  const restrictLocation = parseEmployeeLocationFlag(employee?.restrict_location);
  const unrestrictedCheckoutLocation = parseEmployeeLocationFlag(employee?.unrestricted_checkout_location);
  if (restrictLocation !== null) locationPolicy.employeeRestrictLocation = restrictLocation;
  if (unrestrictedCheckoutLocation !== null) locationPolicy.employeeUnrestrictedCheckout = unrestrictedCheckoutLocation;
  if (Array.isArray(employee?.employee_locations)) {
    locationPolicy.geometryKey = JSON.stringify(employee.employee_locations);
  }
  return locationPolicy;
};

/** Current response facts, independent of delayed/older legacy storage mirrors. */
export const getEmployeeLocationPolicyCurrent = owner => {
  assertAttendanceSessionCurrent(owner);
  const policy = store.getState?.()?.autoAttendance?.employeeLocationPolicy;
  return policy?.scope === policyScope(owner) && policy.accountId === (owner.accountId ?? null) ? policy : null;
};

/** Allocate before HTTP, so an older response cannot overwrite a newer request. */
export const beginEmployeeAutoAttendancePolicyReception = owner => {
  assertAttendanceSessionCurrent(owner);
  sequence = Math.max(sequence, store.getState?.()?.autoAttendance?.policySequence || 0) + 1;
  const ticket = { ...owner, scope: policyScope(owner), revision: sequence };
  store.dispatch(employeePolicyRequested({
    scope: ticket.scope, generation: owner.generation, revision: sequence,
  }));
  return ticket;
};

/** Publish only an owned live response; cache reads never enter this path. */
export const receiveEmployeeAutoAttendancePolicy = async (employee, ticket) => {
  const authMethod = await AsyncStorage.getItem('auth_method');
  await assertAttendanceQueueScope(ticket);
  assertAttendanceSessionCurrent(ticket);
  const mode = parseEmployeeGeotagging(employee?.geotagging);
  let locationPolicy = receivedLocationPolicy(employee);
  if (authMethod === 'mobile') {
    try {
      // R4 mode revocations still arrive even if the remainder is incomplete.
      // Incomplete mobile data may tighten, but cannot release a mandatory
      // location rule before the existing complete-policy validator accepts it.
      require('./offline/attendanceConfigCache').assertCompleteAttendancePolicy(employee);
    } catch {
      locationPolicy = {
        ...(locationPolicy.employeeRestrictLocation === 1 ? { employeeRestrictLocation: 1 } : {}),
        ...(locationPolicy.employeeUnrestrictedCheckout === 0 ? { employeeUnrestrictedCheckout: 0 } : {}),
      };
    }
  }
  store.dispatch(employeePolicyReceived({
    scope: policyScope(ticket), accountId: ticket.accountId ?? null,
    generation: ticket.generation, revision: ticket.revision, mode,
    locationPolicy,
    receivedAt: Date.now(), source: 'response', explicit: mode !== null,
  }));
  return matchingPolicy(ticket);
};

/** Cold boot compatibility for the existing scoped cache, never a live override. */
export const restoreEmployeeAutoAttendancePolicy = async (owner, config) => {
  await assertAttendanceQueueScope(owner);
  assertAttendanceSessionCurrent(owner);
  if (matchingPolicy(owner)) return matchingPolicy(owner);
  const mode = parseEmployeeGeotagging(config?.rules?.geotagging);
  if (config?.tenantKey !== owner.tenantKey || config?.employeeId !== owner.employeeId || mode === null ||
      config.employeePolicyExplicit === false) return null;
  store.dispatch(employeePolicyRestored({
    scope: policyScope(owner), accountId: owner.accountId ?? null,
    mode, revision: 0, receivedAt: config.lastUpdated ?? null,
    source: 'cache', explicit: config.employeePolicyExplicit ?? (mode !== 0),
  }));
  return matchingPolicy(owner);
};

export const getEmployeeAutoAttendancePolicy = async owner => {
  await assertAttendanceQueueScope(owner);
  if (!matchingPolicy(owner)) {
    // Lazy access avoids an apiClient -> config -> employee API import cycle.
    const config = await require('./offline/attendanceConfigCache').readAttendanceConfig();
    await restoreEmployeeAutoAttendancePolicy(owner, config);
  }
  assertAttendanceSessionCurrent(owner);
  return matchingPolicy(owner);
};

/** Final synchronous check after an awaited boundary, from the current slice. */
export const assertEmployeeAutoAttendancePolicyCurrent = (owner, { action = 'punch' } = {}) => {
  assertAttendanceSessionCurrent(owner);
  const policy = matchingPolicy(owner);
  const allowed = policy && (action === 'monitor' ? policy.mode === 1 || policy.mode === 2 : policy.mode === 2);
  if (!allowed) {
    const error = new Error(policy
      ? 'Automatic attendance is disabled by your employee policy.'
      : 'Employee automatic attendance policy is unavailable. Refresh your employee settings.');
    error.code = policy ? EMPLOYEE_AUTO_ATTENDANCE_DISABLED : EMPLOYEE_AUTO_ATTENDANCE_POLICY_UNAVAILABLE;
    error.retryable = false;
    error.mode = policy?.mode ?? null;
    throw error;
  }
  return { ...policy, ...owner, mode: policy.mode, revision: policy.revision, policyScope: policy.scope };
};

export const assertEmployeeAutoAttendancePolicy = async (owner, options) => {
  await getEmployeeAutoAttendancePolicy(owner);
  return assertEmployeeAutoAttendancePolicyCurrent(owner, options);
};
