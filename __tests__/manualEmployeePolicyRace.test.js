import { configureStore } from '@reduxjs/toolkit';
import MockAdapter from 'axios-mock-adapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import RootReducer from '../redux/RootReducer';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import apiClient, { clearTokens, saveTokens } from '../services/api/apiClient';
import { fetchEmployeeData } from '../services/api/employee.service';
import { getOfficeLocation } from '../services/api/attendance.service';

let mockStore;
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() || {},
  dispatch: action => mockStore?.dispatch(action),
} }));

const tenant = 'https://manual-employee-race.example.test';
const employee = 'EMP-LOCATION-RACE-SYNTHETIC';
const office = { location: 'Synthetic Office', latitude: 25.2, longitude: 55.3, reporting_radius: 150 };
const endpoint = method => `${tenant}/api/method/employee_app.attendance_api.${method}`;
const employeeUrl = endpoint('get_employee_data');
const punchUrl = endpoint('add_log_based_on_employee_field');
const employeeData = (restrict, extras = {}) => ({
  employee_code: employee, restrict_location: restrict, unrestricted_checkout_location: 0,
  geotagging: 2, photo: 0, employee_locations: [office], ...extras,
});
const punch = () => apiClient.post(punchUrl, {
  employee_field_value: employee, log_type: 'IN', auto: false,
  device_id: 'MobileAPP', timestamp: '2026-10-21 08:00:00',
});
let mock;
let originalRead;

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: tenant, userDetails: { employeeCode: employee } },
  } });
  await clearTokens();
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', tenant], ['employee_code', employee], ['api_key', 'synthetic-race-account'],
    ['auth_method', 'qr'], ['restrict_location', '0'], ['unrestricted_checkout_location', '0'],
    ['employee_locations', JSON.stringify([office])],
  ]);
  await saveTokens('synthetic-race-access', 'synthetic-race-refresh');
  mockStore.dispatch(settingsReceived({ scope: buildSettingsScope(tenant, employee),
    settings: normalizeFeatureSettings({ attendance_action: { restrict_location: false, unrestricted_checkout_location: false } }),
  }));
  mock = new MockAdapter(apiClient);
  mock.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-SYNTHETIC' } });
  mock.onGet(employeeUrl).reply(200, { message: employeeData(0) });
  Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: office.latitude, longitude: office.longitude } });
  originalRead = AsyncStorage.getItem.getMockImplementation();
});

afterEach(() => {
  AsyncStorage.getItem.mockImplementation(originalRead);
  mock.restore();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('denies a mandatory employee restriction received while the final ownership read is pending', async () => {
  await fetchEmployeeData(employee);
  mock.onGet(employeeUrl).reply(200, { message: employeeData(1) });
  let capturedFlags = false;
  let refreshed = false;
  AsyncStorage.getItem.mockImplementation(async key => {
    const value = await originalRead(key);
    if (key === 'restrict_location') capturedFlags = true;
    if (capturedFlags && key === 'access_token' && !refreshed) {
      refreshed = true;
      await fetchEmployeeData(employee);
      await AsyncStorage.setItem('restrict_location', '1');
    }
    return value;
  });
  await expect(punch()).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(refreshed).toBe(true);
  expect(await AsyncStorage.getItem('restrict_location')).toBe('1');
  expect(mock.history.post).toHaveLength(0);
});

it('does not let a late older employee response mirror away a newer mandatory restriction', async () => {
  mock.resetHandlers();
  mock.onPost(punchUrl).reply(200, { message: { name: 'CHECKIN-SYNTHETIC' } });
  let releaseOld;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  mock.onGet(employeeUrl).replyOnce(() => {
    markStarted();
    return new Promise(resolve => { releaseOld = resolve; });
  });
  const older = getOfficeLocation(employee);
  await started;
  mock.onGet(employeeUrl).reply(200, { message: employeeData(1) });
  await fetchEmployeeData(employee);
  releaseOld([200, { message: employeeData(0) }]);
  await older;
  await expect(punch()).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mock.history.post).toHaveLength(0);
});

it('receives a location-only employee restriction without requiring an automatic attendance mode', async () => {
  await fetchEmployeeData(employee);
  const next = employeeData(1);
  delete next.geotagging;
  mock.onGet(employeeUrl).reply(200, { message: next });
  await fetchEmployeeData(employee);
  await expect(punch()).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mock.history.post).toHaveLength(0);
  expect(mockStore.getState().autoAttendance.employeePolicy.mode).toBe(2);
});

it('allows a later authoritative employee response to release its own restriction', async () => {
  mock.onGet(employeeUrl).reply(200, { message: employeeData(1) });
  await fetchEmployeeData(employee);
  await AsyncStorage.setItem('restrict_location', '1');
  mock.onGet(employeeUrl).reply(200, { message: employeeData(0) });
  await fetchEmployeeData(employee);
  // Receipt is current even while its legacy storage mirror still says 1.
  await expect(punch()).resolves.toMatchObject({ status: 200 });
  expect(mock.history.post).toHaveLength(1);
});

it('does not release a mandatory mobile employee restriction from an incomplete response', async () => {
  await AsyncStorage.setItem('auth_method', 'mobile');
  await AsyncStorage.setItem('restrict_location', '1');
  mock.onGet(employeeUrl).reply(200, { message: employeeData(1) });
  await fetchEmployeeData(employee);
  mock.onGet(employeeUrl).reply(200, { message: { restrict_location: 0, geotagging: 1 } });
  await fetchEmployeeData(employee);
  await expect(punch()).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mockStore.getState().autoAttendance.employeePolicy.mode).toBe(1);
  expect(mock.history.post).toHaveLength(0);
});

it('keeps received mandatory employee location facts after persisted-state hydration', async () => {
  mock.onGet(employeeUrl).reply(200, { message: employeeData(1) });
  await fetchEmployeeData(employee);
  mockStore = configureStore({ reducer: RootReducer, preloadedState: JSON.parse(JSON.stringify(mockStore.getState())) });
  await expect(punch()).rejects.toMatchObject({ code: 'MANUAL_LOCATION_RESTRICTED' });
  expect(mock.history.post).toHaveLength(0);
});
