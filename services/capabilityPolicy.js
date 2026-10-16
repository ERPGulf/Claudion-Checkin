/** Execution policy backed by the existing persisted feature-settings slice. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../redux/Store';
import { selectScopedFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';
import {
  buildSettingsScope,
  featureSettingsHealth,
  isFeatureEnabled,
} from '../utils/featureSettings';
import { getAuthSessionGeneration, isAuthSessionSuspended } from '../utils/authSessionGuard';
import { capabilityForRequest } from './api/capabilityRequests';

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

export const assertCapability = async (path, expected) => {
  const snapshot = await getCapabilitySnapshot(expected);
  if (snapshot.generation !== getAuthSessionGeneration() || isAuthSessionSuspended()) throw scopeChanged();
  // The snapshot promise itself yields. Read the latest policy in this final
  // continuation so raw fetch/native/queue callers cannot use an older allow.
  const root = store.getState?.() || {};
  const settings = selectScopedFeatureSettings(root, snapshot.scope);
  if (!evaluateCapability(settings, path).allowed) {
    const error = new Error('Your administrator has turned this feature off.');
    error.code = FEATURE_DISABLED;
    error.feature = path;
    error.retryable = false;
    throw error;
  }
  return { ...snapshot, settings, state: featureSettingsHealth({ ...root.featureSettings, settings }) };
};

/** Runs immediately before transport, including every axios 401 retry. */
export const assertCapabilityRequest = async (config) => {
  const path = capabilityForRequest(config);
  if (!path && !config.capabilityScope) return;
  const snapshot = path
    ? await assertCapability(path, config.capabilityScope)
    : await getCapabilitySnapshot(config.capabilityScope);
  if (snapshot.generation !== getAuthSessionGeneration() || isAuthSessionSuspended()) throw scopeChanged();
  if (config.url?.startsWith('http') && snapshot.baseUrl) {
    if (!requestBelongsToTenant(config.url, snapshot.baseUrl)) throw scopeChanged();
  }
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
  config.capabilityScope = {
    scope: snapshot.scope,
    generation: snapshot.generation,
    baseUrl: snapshot.baseUrl,
    employeeCode: snapshot.employeeCode,
  };
};
