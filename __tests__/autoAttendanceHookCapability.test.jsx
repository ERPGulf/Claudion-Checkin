import React from 'react';
import { Button, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockStore;
const mockNavigation = { addListener: jest.fn(() => () => {}) };
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() ?? {}, dispatch: action => mockStore?.dispatch(action),
} }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../modules/expo-auto-attendance', () => ({
  OFFICE_GEOFENCE_IDENTIFIER: 'office-main', isAvailable: () => true,
  isMonitoring: jest.fn(() => false), getLastEvent: () => null,
  getRegisteredGeofences: () => [], hasFullAccuracy: () => true,
  isLowPowerModeEnabled: () => false, isIgnoringBatteryOptimizations: () => true,
  startGeofence: jest.fn(async () => {}), stopGeofence: jest.fn(async () => {}),
  addGeofenceEnterListener: () => ({ remove: jest.fn() }),
  addGeofenceExitListener: () => ({ remove: jest.fn() }),
  addErrorListener: () => ({ remove: jest.fn() }), clearLastEvent: jest.fn(),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('../services/api/attendance.service', () => ({
  getOfficeLocation: jest.fn(async () => ({ latitude: 25.28, longitude: 51.52, radius: 100 })),
}));
jest.mock('../services/api/employee.service', () => ({ fetchEmployeeData: jest.fn(async () => ({ geotagging: 2 })) }));
jest.mock('../services/notifications/localNotifications', () => ({ ensureNotificationSetup: jest.fn(async () => {}) }));
jest.mock('../utils/autoAttendance', () => ({
  ...jest.requireActual('../utils/autoAttendance'), waitForMonitoring: jest.fn(async () => true),
}));

import * as Location from 'expo-location';
import useAutoAttendance from '../hooks/useAutoAttendance';
import RootReducer from '../redux/RootReducer';
import { getOfficeLocation } from '../services/api/attendance.service';
import { startGeofence, stopGeofence } from '../modules/expo-auto-attendance';
import { loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { captureAttendanceQueueScope } from '../services/offline/attendanceQueueProvenance';
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from '../services/employeeAutoAttendancePolicy';

const Harness = () => {
  const policy = useAutoAttendance();
  return <View>
    <Text testID="effective-policy">{JSON.stringify({ allowed: policy.allowed, active: policy.active, fullActions: policy.fullActions })}</Text>
    <Button title="Enable" onPress={() => policy.handleToggleEnabled(true)} />
    <Button title="Start" onPress={policy.handleStart} />
  </View>;
};
const receiveTenantGeo = value => mockStore.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, 'EMP-001'),
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: value, auto_attendance: true } }),
}));
const mount = () => render(<Provider store={mockStore}><Harness /></Provider>);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await loginQueueEmployee('EMP-001');
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: 'EMP-001' } },
    autoAttendance: { geotagging: 2, userEnabled: true, syncRequestId: 0 },
  } });
  const scope = await captureAttendanceQueueScope('EMP-001');
  await receiveEmployeeAutoAttendancePolicy({ geotagging: 2 }, beginEmployeeAutoAttendancePolicyReception(scope));
});

it.each([false, 0, null])('screen effective policy honors tenant geo %s without changing employee mode 2', async value => {
  receiveTenantGeo(value);
  const screen = mount();
  expect(JSON.parse(screen.getByTestId('effective-policy').props.children)).toEqual({ allowed: false, active: false, fullActions: false });
  await act(async () => { fireEvent.press(screen.getByText('Start')); });
  expect(startGeofence).not.toHaveBeenCalled();
  expect(mockStore.getState().autoAttendance.employeePolicy.mode).toBe(2);
});

it('tenant geo revocation during permission acquisition prevents the later enable continuation', async () => {
  receiveTenantGeo(2);
  let releaseForeground;
  Location.requestForegroundPermissionsAsync.mockImplementationOnce(() => new Promise(resolve => { releaseForeground = resolve; }));
  const screen = mount();
  fireEvent.press(screen.getByText('Enable'));
  await waitFor(() => expect(releaseForeground).toBeDefined());
  await act(async () => { receiveTenantGeo(0); });
  await act(async () => { releaseForeground({ status: 'granted' }); });
  expect(getOfficeLocation).not.toHaveBeenCalled();
  expect(startGeofence).not.toHaveBeenCalled();
  expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
});

it('removes a dev registration completed after a tenant geo-only revocation', async () => {
  receiveTenantGeo(2);
  let releaseStart;
  startGeofence.mockImplementationOnce(() => new Promise(resolve => { releaseStart = resolve; }));
  const screen = mount();
  fireEvent.press(screen.getByText('Start'));
  await waitFor(() => expect(releaseStart).toBeDefined());
  await act(async () => { receiveTenantGeo(0); });
  await act(async () => { releaseStart(); });
  await waitFor(() => expect(stopGeofence).toHaveBeenCalled());
  expect(JSON.parse(screen.getByTestId('effective-policy').props.children).active).toBe(false);
});
