/** @jest-environment jsdom */
jest.mock('expo-sqlite', () => require('../test-utils/expoSqliteMock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import MockAdapter from 'axios-mock-adapter';
import apiClient, { clearTokens, saveTokens } from '../services/api/apiClient';
import { userCheckIn } from '../services/api/attendance.service';
import { store } from '../redux/Store';
import { revertAll } from '../redux/CommonActions';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { resolveManualAttendanceLocationPolicy } from '../services/manualAttendanceLocationPolicy';
import { loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';

const employeeId = 'EMP-SYNTHETIC-LOCATION';
const endpoint = method => `${TEST_TENANT}/api/method/employee_app.attendance_api.${method}`;
const employeeUrl = endpoint('get_employee_data');
const clockUrl = endpoint('get_server_time');
const punchUrl = endpoint('add_log_based_on_employee_field');
const office = { location: 'Synthetic assigned office', latitude: 25.28, longitude: 51.52, reporting_radius: 100 };
const outside = { coords: { latitude: 25.35, longitude: 51.6 } };
const inside = { coords: { latitude: 25.28005, longitude: 51.52005 } };
const clock = { message: { server_time: '2026-10-21 09:00:00' } };
let http;
const receiveSettings = (restrict, checkout) => store.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, employeeId),
  settings: normalizeFeatureSettings({ attendance_action: { restrict_location: restrict, unrestricted_checkout_location: checkout } }),
}));
const employeePolicy = async (restrict = 0, checkout = 0) => {
  await AsyncStorage.multiSet([['restrict_location', String(restrict)], ['unrestricted_checkout_location', String(checkout)],
    ['employee_locations', JSON.stringify([office])]]);
  http.onGet(employeeUrl).reply(200, { message: { restrict_location: restrict,
    unrestricted_checkout_location: checkout, photo: 0, geotagging: 2, employee_locations: [office] } });
};
const post = type => userCheckIn({ employeeCode: employeeId, type });

beforeEach(async () => {
  await clearTokens(); await AsyncStorage.clear(); store.dispatch(revertAll());
  await loginQueueEmployee(employeeId); await saveTokens('synthetic-access', 'synthetic-refresh');
  http = new MockAdapter(apiClient);
  http.onGet(clockUrl).reply(200, clock);
  http.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-SYNTHETIC' } });
  await employeePolicy();
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getCurrentPositionAsync.mockResolvedValue(outside);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { http.restore(); jest.restoreAllMocks(); });

it.each([
  [false, false, 'IN', true], [false, false, 'OUT', true],
  [false, true, 'IN', true], [false, true, 'OUT', true],
  [true, false, 'IN', false], [true, false, 'OUT', false],
  [true, true, 'IN', false], [true, true, 'OUT', true],
])('enforces tenant restrict=%s checkout=%s for manual %s outside assigned radius', async (restrict, checkout, type, allowed) => {
  receiveSettings(restrict, checkout);
  expect(await post(type)).toMatchObject({ allowed });
  expect(http.history.post).toHaveLength(allowed ? 1 : 0);
  if (allowed && restrict && checkout && type === 'OUT') {
    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    expect(JSON.parse(http.history.post[0].data)).toMatchObject({ auto: false, log_type: 'OUT',
      latitude: outside.coords.latitude, longitude: outside.coords.longitude });
    expect(http.history.get.some(request => request.url === clockUrl)).toBe(true);
  }
});

it.each([[false, false], [false, true], [true, false], [true, true]])(
  'permits both manual directions inside assigned radius with restrict=%s checkout=%s', async (restrict, checkout) => {
    receiveSettings(restrict, checkout);
    Location.getCurrentPositionAsync.mockResolvedValue(inside);
    expect(await post('IN')).toMatchObject({ allowed: true });
    expect(await post('OUT')).toMatchObject({ allowed: true });
    expect(http.history.post).toHaveLength(2);
    if (restrict) expect(JSON.parse(http.history.post[0].data)).toMatchObject({ location: office.location, radius: 100 });
  },
);

it('ignores tenant unrestricted checkout when tenant restriction is false', async () => {
  receiveSettings(false, true);
  const callsBefore = Location.getCurrentPositionAsync.mock.calls.length;
  expect(await post('OUT')).toMatchObject({ allowed: true });
  expect(Location.getCurrentPositionAsync.mock.calls.length).toBe(callsBefore);
  expect(JSON.parse(http.history.post[0].data).latitude).toBeUndefined();
});

it.each([
  [false, false, 1, 0], [false, true, 1, 0], [true, true, 1, 0], [true, false, 1, 1],
])('retains mandatory radius for conflicting tenant %s/%s and employee %s/%s OUT', async (restrict, checkout, employeeRestrict, employeeCheckout) => {
  receiveSettings(restrict, checkout);
  await employeePolicy(employeeRestrict, employeeCheckout);
  expect(await post('OUT')).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it('preserves the employee checkout exception when the tenant adds no restriction', async () => {
  receiveSettings(false, false); await employeePolicy(1, 1);
  expect(await post('IN')).toMatchObject({ allowed: false });
  expect(await post('OUT')).toMatchObject({ allowed: true });
});

it('keeps permission and GPS failures blocking an otherwise permitted outside checkout', async () => {
  receiveSettings(true, true);
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
  expect(await post('OUT')).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it('keeps server-clock failure blocking an otherwise permitted outside checkout', async () => {
  receiveSettings(true, true); http.onGet(clockUrl).networkError();
  expect(await post('OUT')).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it('uses a newly received tenant restriction after pending server-clock work', async () => {
  receiveSettings(false, false);
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  http.onGet(clockUrl).reply(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const result = post('IN'); await entered;
  receiveSettings(true, false); release([200, clock]);
  expect(await result).toMatchObject({ allowed: false });
  expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
  expect(http.history.post).toHaveLength(0);
});

it('rechecks checkout exception revoked while GPS is pending', async () => {
  receiveSettings(true, true);
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  Location.getCurrentPositionAsync.mockImplementationOnce(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const result = post('OUT'); await entered;
  receiveSettings(true, false); release(outside);
  expect(await result).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it('does not relabel an old inside-radius GPS proof with geometry refreshed during that GPS read', async () => {
  receiveSettings(true, false);
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  Location.getCurrentPositionAsync.mockImplementationOnce(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const result = post('IN'); await entered;
  const updatedOffice = { ...office, latitude: 26.28, longitude: 52.52 };
  await AsyncStorage.setItem('employee_locations', JSON.stringify([updatedOffice]));
  http.onGet(employeeUrl).reply(200, { message: { restrict_location: 0, unrestricted_checkout_location: 0,
    photo: 0, geotagging: 2, employee_locations: [updatedOffice] } });
  release(inside);
  expect(await result).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it.each(['tenant switch', 'reauthentication'])('keeps direct manual service ownership across pending clock and %s', async scenario => {
  receiveSettings(false, false);
  let release, start;
  const entered = new Promise(resolve => { start = resolve; });
  http.onGet(clockUrl).reply(() => { start(); return new Promise(resolve => { release = resolve; }); });
  const result = post('IN'); await entered;
  await loginQueueEmployee(employeeId, scenario === 'tenant switch' ? 'https://other-synthetic.example.test' : TEST_TENANT);
  release([200, clock]);
  expect(await result).toMatchObject({ allowed: false });
  expect(http.history.post).toHaveLength(0);
});

it('does not use optimistic unknown tenant values as a mandatory location restriction', () => {
  expect(resolveManualAttendanceLocationPolicy({ settings: null, employeeRestrictLocation: '0',
    employeeUnrestrictedCheckout: '0', type: 'IN' })).toMatchObject({ requiresRadius: false });
});
