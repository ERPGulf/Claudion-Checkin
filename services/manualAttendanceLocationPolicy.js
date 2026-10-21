import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../redux/Store';
import { selectScopedFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope } from '../utils/featureSettings';
import {
  assertAttendanceQueueScope, assertAttendanceSessionCurrent,
  captureAttendanceQueueScope, createAttendanceScopeChangedError,
} from './offline/attendanceQueueProvenance';
import { requestField } from './api/capabilityRequests';
import { getEmployeeLocationPolicyCurrent } from './employeeAutoAttendancePolicy';

export const MANUAL_LOCATION_RESTRICTED = 'MANUAL_LOCATION_RESTRICTED';

/** Each source's checkout exception only releases that source's restriction. */
export const resolveManualAttendanceLocationPolicy = ({
  settings, employeeRestrictLocation, employeeUnrestrictedCheckout, type,
}) => {
  const tenant = settings?.attendance_action;
  // Unknown tenant fields retain the employee policy; optimistic feature
  // availability is deliberately not used to invent a location restriction.
  const tenantRestricted = tenant?.restrict_location === true;
  const tenantCheckoutException = tenantRestricted && tenant?.unrestricted_checkout_location === true;
  const employeeRestricted = Number(employeeRestrictLocation) === 1;
  const employeeCheckoutException = employeeRestricted && Number(employeeUnrestrictedCheckout) === 1;
  const checkout = type === 'OUT';
  const requiresRadius = (tenantRestricted && !(checkout && tenantCheckoutException)) ||
    (employeeRestricted && !(checkout && employeeCheckoutException));
  return {
    requiresRadius,
    // Keep the established GPS requirement for an employee's unrestricted OUT,
    // and apply it to an eligible tenant checkout exception as well.
    needsCheckoutGPS: checkout && !requiresRadius &&
      (tenantCheckoutException || Number(employeeUnrestrictedCheckout) === 1),
    tenantRestricted, employeeRestricted,
    tenantCheckoutException, employeeCheckoutException,
  };
};

const locationRefusal = (evidence) => {
  const nearest = evidence?.nearest;
  const error = new Error(nearest && !nearest.withinRadius
    ? `You are ${nearest.distance}m away from nearest location (${nearest.locationName}). Must be within ${nearest.radius}m.`
    : 'Your location policy changed or assigned location could not be verified. Please try again.');
  error.code = MANUAL_LOCATION_RESTRICTED;
  error.retryable = false;
  error.location = nearest || null;
  return error;
};

export const readManualAttendanceLocationPolicy = async (scope, type) => {
  await assertAttendanceQueueScope(scope);
  const [employeeRestrictLocation, employeeUnrestrictedCheckout, authMethod, geometryKey] = await Promise.all([
    AsyncStorage.getItem('restrict_location'),
    AsyncStorage.getItem('unrestricted_checkout_location'),
    AsyncStorage.getItem('auth_method'),
    AsyncStorage.getItem('employee_locations'),
  ]);
  if (authMethod === 'mobile' &&
      (!['0', '1'].includes(employeeRestrictLocation) || !['0', '1'].includes(employeeUnrestrictedCheckout))) {
    throw new Error('Attendance configuration is unavailable. Please sign in again or contact your administrator.');
  }
  await assertAttendanceQueueScope(scope);
  const settings = selectScopedFeatureSettings(store.getState?.() || {}, buildSettingsScope(scope.tenantKey, scope.employeeId));
  const currentEmployee = getEmployeeLocationPolicyCurrent(scope);
  const current = {
    employeeRestrictLocation: currentEmployee?.employeeRestrictLocation ?? employeeRestrictLocation,
    employeeUnrestrictedCheckout: currentEmployee?.employeeUnrestrictedCheckout ?? employeeUnrestrictedCheckout,
    geometryKey: currentEmployee?.geometryKey ?? geometryKey,
  };
  return { ...current, scope, type, storedGeometryKey: geometryKey,
    ...resolveManualAttendanceLocationPolicy({ settings, ...current, type }) };
};

/** Final synchronous tenant-policy read closes revocation during awaited reads. */
export const assertManualAttendanceLocationPolicyCurrent = (policy, evidence) => {
  assertAttendanceSessionCurrent(policy.scope);
  const settings = selectScopedFeatureSettings(store.getState?.() || {}, buildSettingsScope(policy.scope.tenantKey, policy.scope.employeeId));
  const latest = getEmployeeLocationPolicyCurrent(policy.scope);
  const employee = {
    ...policy,
    employeeRestrictLocation: latest?.employeeRestrictLocation ?? policy.employeeRestrictLocation,
    employeeUnrestrictedCheckout: latest?.employeeUnrestrictedCheckout ?? policy.employeeUnrestrictedCheckout,
    geometryKey: latest?.geometryKey ?? policy.geometryKey,
  };
  const current = resolveManualAttendanceLocationPolicy({ ...employee, settings });
  if (current.requiresRadius && !(evidence?.withinRadius === true && evidence.geometryKey === employee.geometryKey &&
      evidence.geometryKey === policy.storedGeometryKey)) {
    throw locationRefusal(evidence);
  }
  if (current.needsCheckoutGPS && !evidence?.gpsVerified) {
    throw locationRefusal(evidence);
  }
  return { ...employee, ...current };
};

export const isManualAttendanceRequest = (config) => {
  const method = String(config?.url || '').match(/(?:^|\/)method\/([^?#]+)/)?.[1];
  if (method !== 'employee_app.attendance_api.add_log_based_on_employee_field') return false;
  const automatic = requestField(config.data, 'auto');
  return !(automatic === true || automatic === 1 || automatic === 'true' || automatic === '1');
};

/** Service evidence is retained for every transport dispatch and 401 retry. */
export const assertManualAttendanceLocationRequest = async (config) => {
  if (!isManualAttendanceRequest(config)) return null;
  const employeeId = requestField(config.data, 'employee_field_value');
  const type = requestField(config.data, 'log_type');
  if (!employeeId || !['IN', 'OUT'].includes(type)) throw createAttendanceScopeChangedError();
  const metadata = config.manualAttendancePolicy || {};
  const scope = metadata.scope || config.attendanceSyncScope || await captureAttendanceQueueScope(employeeId);
  if (scope.employeeId !== employeeId || (metadata.type && metadata.type !== type)) throw createAttendanceScopeChangedError();
  const policy = await readManualAttendanceLocationPolicy(scope, type);
  const evidence = metadata.evidence;
  assertManualAttendanceLocationPolicyCurrent(policy, evidence);
  config.manualAttendancePolicy = { scope, type, evidence };
  config.attendanceSyncScope = scope;
  return { policy, evidence };
};

export const assertManualAttendanceLocationRequestCurrent = (config, guard) => {
  if (guard) return assertManualAttendanceLocationPolicyCurrent(guard.policy, guard.evidence);
  return null;
};
