/** Execution policy backed by the existing persisted feature-settings slice. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { store } from '../redux/Store';
import { selectScopedFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';
import {
  ATTENDANCE_FEATURES,
  buildSettingsScope,
  featureSettingsHealth,
  isFeatureEnabled,
} from '../utils/featureSettings';
import { getAuthSessionGeneration, isAuthSessionSuspended } from '../utils/authSessionGuard';
import { capabilityForRequest, requestField } from './api/capabilityRequests';
import { captureAttendanceQueueScope } from './offline/attendanceQueueProvenance';
import {
  assertEmployeeAutoAttendancePolicy, assertEmployeeAutoAttendancePolicyCurrent,
} from './employeeAutoAttendancePolicy';
import {
  isManualAttendanceRequest, assertManualAttendanceLocationRequest,
  assertManualAttendanceLocationRequestCurrent,
} from './manualAttendanceLocationPolicy';

export const FEATURE_DISABLED = 'FEATURE_DISABLED';
export const CAPABILITY_SCOPE_CHANGED = 'CAPABILITY_SCOPE_CHANGED';

const scopeChanged = () => {
  const error = new Error('The account changed. Please try again.');
  error.code = CAPABILITY_SCOPE_CHANGED;
  return error;
};

/** Pure evaluation; unknown fields retain the documented legacy compatibility. */
export const evaluateCapability = (settings, path) => ({
  allowed: isFeatureEnabled(settings, path),
  reason: isFeatureEnabled(settings, path) ? null : FEATURE_DISABLED,
});

const requestBelongsToTenant = (requestUrl, baseUrl) => {
  try {
    const tenant = new URL(String(baseUrl).trim().replace(/[\u0000-\u001F\u200B]+/g, '').replace(/\/+$/, ''));
    const request = new URL(requestUrl);
    const prefix = `${tenant.pathname.replace(/\/+$/, '')}/api/`;
    return request.protocol === tenant.protocol && request.host === tenant.host && request.pathname.startsWith(prefix);
  } catch {
    return false;
  }
};

/**
 * Storage is authoritative at execution time. Redux supplies only an answer
 * belonging to that storage scope; no second settings cache is maintained.
 * The returned context contains no credentials and can bind a retry to its owner.
 */
export const getCapabilitySnapshot = async (expected = {}) => {
  const generation = getAuthSessionGeneration();
  if (isAuthSessionSuspended()) throw scopeChanged();
  const [baseUrl, employeeCode] = await Promise.all([
    AsyncStorage.getItem('baseUrl'),
    AsyncStorage.getItem('employee_code'),
  ]);
  if (generation !== getAuthSessionGeneration() || isAuthSessionSuspended()) throw scopeChanged();
  const scope = buildSettingsScope(baseUrl, employeeCode);
  if ((expected.generation !== undefined && expected.generation !== generation) ||
      (expected.scope && expected.scope !== scope) ||
      (expected.baseUrl && buildSettingsScope(expected.baseUrl, employeeCode) !== scope) ||
      (expected.employeeCode && expected.employeeCode !== employeeCode)) throw scopeChanged();

  const root = store.getState?.() || {};
  const settings = selectScopedFeatureSettings(root, scope);
  return {
    settings,
    scope,
    baseUrl,
    employeeCode,
    generation,
    state: featureSettingsHealth({ ...root.featureSettings, settings }),
  };
};

/** Final synchronous policy check after the caller's awaited ownership work. */
export const assertCapabilityCurrent = (path, expected = {}) => {
  const scope = expected.scope || buildSettingsScope(
    expected.baseUrl ?? expected.tenantKey, expected.employeeCode ?? expected.employeeId,
  );
  if (expected.generation !== getAuthSessionGeneration() || isAuthSessionSuspended() ||
      expected.isCancelled?.()) throw scopeChanged();
  const root = store.getState?.() || {};
  const settings = selectScopedFeatureSettings(root, scope);
  if (!evaluateCapability(settings, path).allowed) {
    const error = new Error('Your administrator has turned this feature off.');
    error.code = FEATURE_DISABLED;
    error.feature = path;
    error.retryable = false;
    throw error;
  }
  return { ...expected, scope, settings };
};

export const assertCapability = async (path, expected) => {
  const snapshot = await getCapabilitySnapshot(expected);
  // The snapshot promise itself yields. Read the latest policy in this final
  // continuation so raw fetch/native/queue callers cannot use an older allow.
  const current = assertCapabilityCurrent(path, snapshot);
  const root = store.getState?.() || {};
  return { ...current, state: featureSettingsHealth({ ...root.featureSettings, settings: current.settings }) };
};

/** Runs immediately before transport, including every axios 401 retry. */
export const assertCapabilityRequest = async (config) => {
  const path = capabilityForRequest(config);
  const manualAttendance = isManualAttendanceRequest(config);
  if (!path && !config.capabilityScope && !manualAttendance) return;
  const snapshot = path
    ? await assertCapability(path, config.capabilityScope)
    : await getCapabilitySnapshot(config.capabilityScope);
  let employeeScope;
  if (path === ATTENDANCE_FEATURES.AUTO_ATTENDANCE) {
    // Bind direct Axios callers as well as the service wrapper. Retain this
    // owner on retries; a new login cannot supply authority for an old punch.
    const employeeId = requestField(config.data, 'employee_field_value');
    if (!employeeId || employeeId !== snapshot.employeeCode) throw scopeChanged();
    employeeScope = config.employeeAutoAttendanceScope || config.attendanceSyncScope ||
      await captureAttendanceQueueScope(employeeId);
    if (employeeScope.employeeId !== employeeId || employeeScope.generation !== snapshot.generation ||
        buildSettingsScope(employeeScope.tenantKey, employeeId) !== snapshot.scope) throw scopeChanged();
    config.employeeAutoAttendanceScope = employeeScope;
    await assertEmployeeAutoAttendancePolicy(employeeScope);
  }
  const manualGuard = manualAttendance ? await assertManualAttendanceLocationRequest(config) : null;
  if (snapshot.generation !== getAuthSessionGeneration() || isAuthSessionSuspended()) throw scopeChanged();
  // Validate the destination Axios will actually use. Relative URLs can retain
  // an earlier tenant's baseURL while authentication awaits a tenant switch;
  // an explicit baseURL can also redirect an otherwise current absolute URL
  // when allowAbsoluteUrls is false. Do not serialize query parameters here.
  const requestUrl = axios.getUri({
    url: config.url,
    baseURL: config.baseURL,
    allowAbsoluteUrls: config.allowAbsoluteUrls,
  });
  if (!requestBelongsToTenant(requestUrl, snapshot.baseUrl)) throw scopeChanged();
  // Read policy once more after the asynchronous ownership read, so a received
  // revocation while that read was pending is effective for this request.
  const root = store.getState?.() || {};
  if (path && !evaluateCapability(selectScopedFeatureSettings(root, snapshot.scope), path).allowed) {
    const error = new Error('Your administrator has turned this feature off.');
    error.code = FEATURE_DISABLED;
    error.feature = path;
    error.retryable = false;
    throw error;
  }
  if (employeeScope) assertEmployeeAutoAttendancePolicyCurrent(employeeScope);
  if (manualGuard) assertManualAttendanceLocationRequestCurrent(config, manualGuard);
  config.capabilityScope = {
    scope: snapshot.scope,
    generation: snapshot.generation,
    baseUrl: snapshot.baseUrl,
    employeeCode: snapshot.employeeCode,
  };
};
