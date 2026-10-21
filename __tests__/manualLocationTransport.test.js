import { configureStore } from '@reduxjs/toolkit';
import MockAdapter from 'axios-mock-adapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import RootReducer from '../redux/RootReducer';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { setBaseUrl } from '../redux/Slices/UserSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { activateAuthSession, invalidateAuthSession } from '../utils/authSessionGuard';
import apiClient, { clearTokens, plainAxios, saveTokens } from '../services/api/apiClient';
import { userCheckIn } from '../services/api/attendance.service';

let mockStore;
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() || {},
  dispatch: action => mockStore?.dispatch(action),
} }));

const tenant = 'https://manual-alpha.example.test';
const otherTenant = 'https://manual-beta.example.test';
const employee = 'EMP-MANUAL-SYNTHETIC';
const office = { location: 'Synthetic Assigned Office', latitude: 25.2, longitude: 55.3, reporting_radius: 150 };
const inside = { coords: { latitude: office.latitude, longitude: office.longitude } };
const outside = { coords: { latitude: 25.3, longitude: 55.4 } };
const endpoint = method => `${tenant}/api/method/employee_app.${method}`;
const punchUrl = endpoint('attendance_api.add_log_based_on_employee_field');
const refreshUrl = endpoint('gauth.create_refresh_token');
const employeeUrl = endpoint('attendance_api.get_employee_data');
let mock;
let refresh;

const receive = (restrict, unrestricted, owner = tenant) => mockStore.dispatch(settingsReceived({
  scope: buildSettingsScope(owner, employee),
  settings: normalizeFeatureSettings({ attendance_action: {
    restrict_location: restrict, unrestricted_checkout_location: unrestricted,
  } }),
}));
const payload = (type = 'IN', employeeId = employee) => ({
  employee_field_value: employeeId, log_type: type, auto: false,
  timestamp: '2026-10-21 08:00:00', device_id: 'MobileAPP',
});
const serverSuccess = { message: { name: 'CHECKIN-SYNTHETIC' } };
const refreshSuccess = [200, { data: {
  access_token: 'synthetic-manual-rotated', refresh_token: 'synthetic-manual-rotated-refresh',
} }];
const prepareRetry = callback => {
  mock.onPost(punchUrl).replyOnce(401);
  mock.onPost(punchUrl).reply(200, serverSuccess);
  refresh.onPost(refreshUrl).reply(async () => {
    await callback?.();
    return refreshSuccess;
  });
};
const expectOnePunchAndRefresh = () => {
  expect(mock.history.post).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(1);
};

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: tenant, userDetails: { employeeCode: employee } },
  } });
  await clearTokens();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', tenant], ['employee_code', employee], ['api_key', 'synthetic-manual-account'],
    ['auth_method', 'qr'], ['restrict_location', '0'], ['unrestricted_checkout_location', '0'],
    ['employee_locations', JSON.stringify([office])],
  ]);
  await saveTokens('synthetic-manual-access', 'synthetic-manual-refresh');
  mock = new MockAdapter(apiClient);
  refresh = new MockAdapter(plainAxios);
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getCurrentPositionAsync.mockResolvedValue(inside);
  mock.onGet(endpoint('attendance_api.get_server_time')).reply(200, { message: { server_time: '2026-10-21 08:00:00' } });
  mock.onGet(employeeUrl).reply(200, { message: {
    employee_code: employee, restrict_location: 0, unrestricted_checkout_location: 0,
    geotagging: 2, photo: 0, employee_locations: [office],
  } });
  receive(false, false);
});

afterEach(() => {
  mock.restore();
  refresh.restore();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('denies a retry when a new tenant restriction requires location evidence that the first punch did not need', async () => {
  prepareRetry(() => receive(true, false));
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'MANUAL_LOCATION_RESTRICTED' } });
  expectOnePunchAndRefresh();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});

it.each([false, null])('denies an outside checkout retry after its tenant exception becomes %p', async unrestricted => {
  receive(true, true);
  Location.getCurrentPositionAsync.mockResolvedValue(outside);
  prepareRetry(() => receive(true, unrestricted));
  const result = await userCheckIn({ employeeCode: employee, type: 'OUT' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'MANUAL_LOCATION_RESTRICTED' } });
  expectOnePunchAndRefresh();
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mock.history.post[0].data)).toMatchObject({
    log_type: 'OUT', auto: false, latitude: outside.coords.latitude, longitude: outside.coords.longitude,
  });
});

it('denies a restricted retry when assigned-location geometry changed after the original inside-radius proof', async () => {
  receive(true, false);
  prepareRetry(() => AsyncStorage.setItem('employee_locations', JSON.stringify([
    { ...office, longitude: 55.5, reporting_radius: 75 },
  ])));
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'MANUAL_LOCATION_RESTRICTED' } });
  expectOnePunchAndRefresh();
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
});

it('does not label old assigned-location proof with geometry received while GPS was pending', async () => {
  receive(true, false);
  Location.getCurrentPositionAsync.mockImplementationOnce(async () => {
    await AsyncStorage.setItem('employee_locations', JSON.stringify([
      { ...office, longitude: 55.5, reporting_radius: 75 },
    ]));
    return inside;
  });
  mock.onPost(punchUrl).reply(200, serverSuccess);
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'MANUAL_LOCATION_RESTRICTED' } });
  expect(mock.history.post).toHaveLength(0);
});

it('permits a restricted inside-radius retry with unchanged location policy and geometry', async () => {
  receive(true, false);
  prepareRetry();
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: true, name: 'CHECKIN-SYNTHETIC' });
  expect(mock.history.post).toHaveLength(2);
  expect(refresh.history.post).toHaveLength(1);
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mock.history.post[1].data)).toMatchObject({
    location: office.location, latitude: office.latitude, longitude: office.longitude,
    distance: 0, radius: office.reporting_radius, auto: false,
  });
});

it.each(['IN', 'OUT'])('denies a direct restricted %s Axios request with no service location evidence', async type => {
  receive(true, false);
  mock.onPost(punchUrl).reply(200, serverSuccess);
  await expect(apiClient.post(punchUrl, payload(type))).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mock.history.post).toHaveLength(0);
});

it.each(['IN', 'OUT'])('permits a direct unrestricted %s Axios request without inventing a radius requirement', async type => {
  receive(false, false);
  mock.onPost(punchUrl).reply(200, serverSuccess);
  await expect(apiClient.post(punchUrl, payload(type))).resolves.toMatchObject({ status: 200 });
  expect(mock.history.post).toHaveLength(1);
});

it('denies an employee-restricted direct Axios request even when tenant location restriction is false', async () => {
  await AsyncStorage.setItem('restrict_location', '1');
  mock.onPost(punchUrl).reply(200, serverSuccess);
  await expect(apiClient.post(punchUrl, payload())).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mock.history.post).toHaveLength(0);
});

it('denies direct manual Axios submission for a different employee', async () => {
  mock.onPost(punchUrl).reply(200, serverSuccess);
  await expect(apiClient.post(punchUrl, payload('IN', 'EMP-OTHER-SYNTHETIC')))
    .rejects.toMatchObject({ code: 'ATTENDANCE_SYNC_SCOPE_CHANGED' });
  expect(mock.history.post).toHaveLength(0);
});

it('retains the original tenant when a 401 refresh completes after a tenant switch', async () => {
  prepareRetry(async () => {
    await AsyncStorage.setItem('baseUrl', otherTenant);
    mockStore.dispatch(setBaseUrl(otherTenant));
    receive(false, false, otherTenant);
  });
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'ATTENDANCE_SYNC_SCOPE_CHANGED' } });
  expectOnePunchAndRefresh();
});

it('rejects a retry after reauthentication to the same tenant and employee', async () => {
  prepareRetry(() => {
    const generation = invalidateAuthSession();
    activateAuthSession(generation);
  });
  const result = await userCheckIn({ employeeCode: employee, type: 'IN' });
  expect(result).toMatchObject({ allowed: false, error: { code: 'ATTENDANCE_SYNC_SCOPE_CHANGED' } });
  expectOnePunchAndRefresh();
});

it('preserves an already-dispatched manual success when the same owner receives a stricter tenant policy', async () => {
  mock.onPost(punchUrl).reply(() => {
    receive(true, false);
    return [200, serverSuccess];
  });
  expect(await userCheckIn({ employeeCode: employee, type: 'IN' }))
    .toMatchObject({ allowed: true, name: 'CHECKIN-SYNTHETIC' });
  expect(mock.history.post).toHaveLength(1);
  expect(refresh.history.post).toHaveLength(0);
});
