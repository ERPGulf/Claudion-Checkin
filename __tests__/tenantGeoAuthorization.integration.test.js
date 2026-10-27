/** @jest-environment jsdom */
jest.mock('expo-sqlite', () => require('../test-utils/expoSqliteMock'));
jest.mock('../services/offline/NetworkListener', () => ({
  fetchShouldAttemptRequest: jest.fn(async () => true), isOnline: () => true,
}));

import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MockAdapter from 'axios-mock-adapter';
import RootReducer from '../redux/RootReducer';
import { setBaseUrl } from '../redux/Slices/UserSlice';
import {
  settingsFailed, settingsReceived, settingsRequested, selectFeatureSettings,
  makeSelectFeatureEnabled,
} from '../redux/Slices/FeatureSettingsSlice';
import { ATTENDANCE_FEATURES, buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { getAuthSessionGeneration } from '../utils/authSessionGuard';
import apiClient, { clearTokens, plainAxios, saveTokens } from '../services/api/apiClient';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import { fetchEmployeeData } from '../services/api/employee.service';
import { autoCheckInOut, userCheckIn } from '../services/api/attendance.service';
import { FEATURE_DISABLED } from '../services/capabilityPolicy';
import { EMPLOYEE_AUTO_ATTENDANCE_DISABLED } from '../services/employeeAutoAttendancePolicy';
import { enqueue, findById } from '../services/offline/AttendanceQueueRepository';
import { resetDatabaseHandle } from '../services/offline/AttendanceDatabase';
import { resetSyncService, syncPendingAttendance } from '../services/offline/AttendanceSyncService';
import { resetOfflineCapability } from '../services/offline/offlineCapability';
import { loginQueueEmployee } from '../test-utils/attendanceScope';

let mockStore;
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() || {},
  dispatch: action => mockStore?.dispatch(action),
} }));

const { __resetAll } = require('../test-utils/expoSqliteMock');
const tenant = 'https://geo-alpha.example.test';
const otherTenant = 'https://geo-beta.example.test';
const employeeId = 'EMP-GEO-SYNTHETIC';
const employeeDocname = 'EMP-DOC-GEO-SYNTHETIC';
const automaticFeature = ATTENDANCE_FEATURES.AUTO_ATTENDANCE;
const endpoint = (method, owner = tenant) => `${owner}/api/method/employee_app.${method}`;
const settingsUrl = endpoint('gauth.employee_checkin_setting');
const employeeUrl = endpoint('attendance_api.get_employee_data');
const clockUrl = endpoint('attendance_api.get_server_time');
const punchUrl = endpoint('attendance_api.add_log_based_on_employee_field');
const clock = { message: { server_time: '2026-10-21 09:00:00' } };
const employee = mode => ({ name: employeeDocname, geotagging: mode,
  restrict_location: 0, unrestricted_checkout_location: 0, photo: 0,
  employee_locations: [{ location: 'Synthetic assigned office', latitude: 25.28,
    longitude: 51.52, reporting_radius: 100 }] });
const makeStore = preloadedState => configureStore({ reducer: RootReducer, preloadedState });
let http;
let refresh;
let sequence = 0;

const receiveSettings = (attendance, owner = tenant) => mockStore.dispatch(settingsReceived({
  scope: buildSettingsScope(owner, employeeId), settings: normalizeFeatureSettings({
    attendance_action: { geo_tagging: true, offline_attendance: true, ...attendance },
  }),
}));
const receiveMode = async (mode, owner = tenant) => {
  http.onGet(endpoint('attendance_api.get_employee_data', owner)).reply(200, { message: employee(mode) });
  return fetchEmployeeData(employeeId);
};
const fetchSettings = async () => {
  const baseUrl = await AsyncStorage.getItem('baseUrl');
  const scope = buildSettingsScope(baseUrl, employeeId);
  const requestId = `geo-contract-${++sequence}`;
  mockStore.dispatch(settingsRequested({ scope, requestId }));
  const result = await getFeatureSettings({ capabilityScope: {
    scope, baseUrl, employeeCode: employeeId, generation: getAuthSessionGeneration(),
  } });
  mockStore.dispatch(result.error
    ? settingsFailed({ error: result.error, requestId })
    : settingsReceived({ scope, requestId, settings: result.message }));
  return result;
};
const receiveGeoFromBackend = async value => {
  http.onGet(settingsUrl).reply(200, { message: { attendance_action: { geo_tagging: value } } });
  await fetchSettings();
  expect(makeSelectFeatureEnabled(automaticFeature)(mockStore.getState())).toBe(value === true);
};
const automaticPosts = () => http.history.post.filter(request => {
  if (!request.url.endsWith('attendance_api.add_log_based_on_employee_field')) return false;
  return JSON.parse(request.data).auto === true;
});
const directAutomatic = () => apiClient.post(punchUrl, {
  auto: true, employee_field_value: employeeId, log_type: 'IN',
});
const automaticService = type => autoCheckInOut({ employeeCode: employeeId, type });

beforeEach(async () => {
  __resetAll(); resetDatabaseHandle(); resetSyncService(); resetOfflineCapability();
  await clearTokens(); await AsyncStorage.clear();
  mockStore = makeStore({ userAuth: { isLoggedIn: true }, user: {
    baseUrl: tenant, userDetails: { employeeCode: employeeId },
  } });
  await loginQueueEmployee(employeeId, tenant);
  await saveTokens('synthetic-geo-access', 'synthetic-geo-refresh');
  receiveSettings({ geo_tagging: true });
  http = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  http.onGet(clockUrl).reply(200, clock);
  http.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-GEO-SYNTHETIC' } });
  await receiveMode(2);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  http.restore(); refresh.restore(); resetSyncService(); jest.restoreAllMocks();
});

it.each([false, 0, null])('denies tenant geo=%s with employee mode 2 at service and direct Axios boundaries', async geo => {
  await receiveGeoFromBackend(geo);
  expect(makeSelectFeatureEnabled(automaticFeature)(mockStore.getState())).toBe(false);
  for (const type of ['IN', 'OUT']) {
    expect(await automaticService(type)).toMatchObject({ allowed: false,
      error: { code: FEATURE_DISABLED, feature: automaticFeature } });
  }
  await expect(directAutomatic()).rejects.toMatchObject({ code: FEATURE_DISABLED, feature: automaticFeature });
  expect(automaticPosts()).toHaveLength(0);
  expect(http.history.get.filter(request => request.url === clockUrl)).toHaveLength(0);
});

it.each([false, 0, null])('hydrates received tenant geo=%s denial through JSON persistence before a settings refresh', async geo => {
  await receiveGeoFromBackend(geo);
  mockStore = makeStore(JSON.parse(JSON.stringify(mockStore.getState())));
  http.onGet(settingsUrl).networkError();
  expect(await fetchSettings()).toHaveProperty('error');
  expect(makeSelectFeatureEnabled(automaticFeature)(mockStore.getState())).toBe(false);
  expect(await automaticService('IN')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  await expect(directAutomatic()).rejects.toMatchObject({ code: FEATURE_DISABLED });
  expect(automaticPosts()).toHaveLength(0);
});

it.each([false, 0, null])('stays denied after geo=%s when a partial refresh omits geo_tagging', async geo => {
  await receiveGeoFromBackend(geo);
  http.onGet(settingsUrl).reply(200, { message: { attendance_action: { photo_upload: true } } });
  const response = await fetchSettings();
  expect(response.message.attendance_action.geo_tagging).toBeNull();
  expect(mockStore.getState().featureSettings.settings.attendance_action.geo_tagging).toBeNull();
  expect(await automaticService('IN')).toMatchObject({ allowed: false });
  expect(automaticPosts()).toHaveLength(0);
});

it('does not carry a cached geo_tagging true into a partial refresh that omits it', async () => {
  http.onGet(settingsUrl).reply(200, { message: { attendance_action: { photo_upload: true } } });
  await fetchSettings();
  expect(makeSelectFeatureEnabled(automaticFeature)(mockStore.getState())).toBe(false);
  expect(await automaticService('IN')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it('treats a first response without geo_tagging as disabled', () => {
  mockStore = makeStore({ userAuth: { isLoggedIn: true }, user: {
    baseUrl: tenant, userDetails: { employeeCode: employeeId },
  } });
  mockStore.dispatch(settingsReceived({ scope: buildSettingsScope(tenant, employeeId),
    settings: normalizeFeatureSettings({ attendance_action: { offline_attendance: true } }) }));
  expect(selectFeatureSettings(mockStore.getState()).attendance_action.geo_tagging).toBeNull();
  expect(makeSelectFeatureEnabled(automaticFeature)(mockStore.getState())).toBe(false);
});

it.each(['invalid', {}, 9, 2, 'true'])('does not enable from a malformed geo=%p after a denial', async geo => {
  await receiveGeoFromBackend(false);
  http.onGet(settingsUrl).reply(200, { message: { attendance_action: { geo_tagging: geo } } });
  expect((await fetchSettings()).message.attendance_action.geo_tagging).toBe(false);
  expect(await automaticService('IN')).toMatchObject({ allowed: false });
  expect(automaticPosts()).toHaveLength(0);
});

it.each([false, 0, null])('rechecks tenant geo=%s received while automatic server-clock work is pending', async geo => {
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(clockUrl).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const result = automaticService('OUT');
  await sent;
  await receiveGeoFromBackend(geo);
  release([200, clock]);
  expect(await result).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it.each([false, 0, null])('does not retry a direct automatic 401 after receiving tenant geo=%s during refresh', async geo => {
  http.resetHandlers();
  http.onPost(punchUrl).replyOnce(401);
  http.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-GEO-SYNTHETIC' } });
  refresh.onPost(endpoint('gauth.create_refresh_token')).reply(async () => {
    await receiveGeoFromBackend(geo);
    return [200, { data: { access_token: 'synthetic-geo-rotated', refresh_token: 'synthetic-geo-refresh-rotated' } }];
  });
  await expect(directAutomatic()).rejects.toMatchObject({ code: FEATURE_DISABLED, feature: automaticFeature });
  expect(automaticPosts()).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it.each([false, 0, null])('returns a local denial from the automatic service when tenant geo=%s is revoked during a 401 refresh', async geo => {
  http.resetHandlers();
  http.onGet(clockUrl).reply(200, clock);
  http.onPost(punchUrl).replyOnce(401);
  http.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-GEO-SYNTHETIC' } });
  refresh.onPost(endpoint('gauth.create_refresh_token')).reply(async () => {
    await receiveGeoFromBackend(geo);
    return [200, { data: { access_token: 'synthetic-geo-rotated', refresh_token: 'synthetic-geo-refresh-rotated' } }];
  });
  expect(await automaticService('OUT')).toMatchObject({ allowed: false,
    error: { code: FEATURE_DISABLED, feature: automaticFeature } });
  expect(automaticPosts()).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
});

it('ignores an older same-owner geo_tagging true response finishing after a newer explicit-null denial', async () => {
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(settingsUrl).replyOnce(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const old = fetchSettings();
  await sent;
  await receiveGeoFromBackend(null);
  release([200, { message: { attendance_action: { geo_tagging: true } } }]);
  await old;
  expect(mockStore.getState().featureSettings.settings.attendance_action.geo_tagging).toBe(false);
  expect(await automaticService('IN')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it('reenables automatic attendance when a fresh geo_tagging true replaces false', async () => {
  await receiveGeoFromBackend(false);
  expect(await automaticService('IN')).toMatchObject({ allowed: false });
  http.onGet(settingsUrl).reply(200, { message: { attendance_action: { geo_tagging: true } } });
  expect((await fetchSettings()).message.attendance_action.geo_tagging).toBe(true);
  expect(await automaticService('IN')).toMatchObject({ allowed: true });
  expect(automaticPosts()).toHaveLength(1);
});

it.each([[0, false], [1, false], [2, true]])('preserves employee mode %s when tenant geo_tagging true permits automatic functionality', async (mode, allowed) => {
  await receiveMode(mode);
  expect(await automaticService('IN')).toMatchObject({ allowed });
  if (!allowed) {
    await expect(directAutomatic()).rejects.toMatchObject({ code: EMPLOYEE_AUTO_ATTENDANCE_DISABLED, mode });
  }
  expect(automaticPosts()).toHaveLength(allowed ? 1 : 0);
});

it.each(['IN', 'OUT'])('allows manual %s with tenant geo_tagging false while retaining the manual request contract', async type => {
  await receiveGeoFromBackend(false);
  // No employee location restriction applies in this fixture. Tenant geo does
  // not create one or disable the manual execution path.
  await AsyncStorage.multiSet([['restrict_location', '0'], ['unrestricted_checkout_location', '0']]);
  expect(await userCheckIn({ employeeCode: employeeId, type })).toMatchObject({ allowed: true });
  expect(http.history.get.some(request => request.url === clockUrl)).toBe(true);
  expect(http.history.post).toHaveLength(1);
  expect(JSON.parse(http.history.post[0].data)).toMatchObject({ auto: false, log_type: type,
    employee_field_value: employeeId, timestamp: clock.message.server_time });
});

it('does not reuse a foreign tenant denial or employee grant after switching tenants', async () => {
  await receiveGeoFromBackend(false);
  await loginQueueEmployee(employeeId, otherTenant);
  await saveTokens('synthetic-geo-other', 'synthetic-geo-other-refresh');
  mockStore.dispatch(setBaseUrl(otherTenant));
  expect(selectFeatureSettings(mockStore.getState())).toBeNull();
  // The foreign tenant's employee mode 2 is also insufficient for this owner.
  expect(await automaticService('IN')).toMatchObject({ allowed: false });
  receiveSettings({ geo_tagging: false }, otherTenant);
  await receiveMode(2, otherTenant);
  expect(await automaticService('IN')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it('does not resume an old automatic clock continuation after switching to a tenant with geo_tagging false', async () => {
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(clockUrl).reply(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const result = automaticService('IN');
  await sent;
  await loginQueueEmployee(employeeId, otherTenant);
  await saveTokens('synthetic-geo-other', 'synthetic-geo-other-refresh');
  mockStore.dispatch(setBaseUrl(otherTenant));
  receiveSettings({ geo_tagging: false }, otherTenant);
  await receiveMode(2, otherTenant);
  release([200, clock]);
  expect(await result).toMatchObject({ allowed: false });
  expect(await automaticService('OUT')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it('does not let a late older tenant settings grant replace the new tenant geo_tagging false policy', async () => {
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  http.onGet(settingsUrl).replyOnce(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const result = fetchSettings();
  await sent;
  await loginQueueEmployee(employeeId, otherTenant);
  await saveTokens('synthetic-geo-other', 'synthetic-geo-other-refresh');
  mockStore.dispatch(setBaseUrl(otherTenant));
  http.onGet(endpoint('gauth.employee_checkin_setting', otherTenant)).reply(200, {
    message: { attendance_action: { geo_tagging: false } },
  });
  await fetchSettings();
  await receiveMode(2, otherTenant);
  release([200, { message: { attendance_action: { geo_tagging: true } } }]);
  expect(await result).toHaveProperty('error');
  expect(mockStore.getState().featureSettings.scope).toBe(buildSettingsScope(otherTenant, employeeId));
  expect(await automaticService('IN')).toMatchObject({ allowed: false, error: { code: FEATURE_DISABLED } });
  expect(automaticPosts()).toHaveLength(0);
});

it.each([false, 0, null])('delivers previously accepted automatic queue rows after tenant geo=%s disables new work', async geo => {
  const row = (await enqueue({ tenantKey: tenant, employeeId, employeeDocname,
    attendanceType: 'auto', timestamp: '2026-10-20 09:00:00', action: 'checkin' })).row;
  await receiveGeoFromBackend(geo);
  receiveSettings({ geo_tagging: false, offline_attendance: false });
  http.onPost(endpoint('attendance_api.add_offline_employee_checkins')).reply(200, {
    message: { status: 'success', inserted: ['CHECKIN-GEO-SYNTHETIC'], failed: [] },
  });
  expect(await syncPendingAttendance({ employeeId })).toMatchObject({ synced: 1 });
  expect(await findById(row.id)).toMatchObject({ status: 'synced', acceptanceConfirmed: 1 });
  expect(automaticPosts()).toHaveLength(0);
});
