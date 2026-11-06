import React from 'react';
import { Alert, AppState, Button, Linking, Text, View } from 'react-native';
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
  getRegisteredGeofences: jest.fn(() => []), hasFullAccuracy: () => true,
  isLowPowerModeEnabled: () => false, isIgnoringBatteryOptimizations: () => true,
  startGeofence: jest.fn(async () => {}), stopGeofence: jest.fn(async () => {}),
  addGeofenceEnterListener: jest.fn(() => ({ remove: jest.fn() })),
  addGeofenceExitListener: jest.fn(() => ({ remove: jest.fn() })),
  addErrorListener: jest.fn(() => ({ remove: jest.fn() })), clearLastEvent: jest.fn(),
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
  readDevicePosition: jest.fn(async () => null),
}));

import * as Location from 'expo-location';
import useAutoAttendance from '../hooks/useAutoAttendance';
import RootReducer from '../redux/RootReducer';
import { getOfficeLocation } from '../services/api/attendance.service';
import { addErrorListener, addGeofenceEnterListener, addGeofenceExitListener,
  getRegisteredGeofences, startGeofence, stopGeofence } from '../modules/expo-auto-attendance';
import { automaticAttendanceSettings, loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';
import { autoAttendanceMonitoringChanged } from '../redux/Slices/AutoAttendanceSlice';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { readDevicePosition, setLocationAccessExplainer } from '../utils/autoAttendance';
import { setCheckin, setCheckout } from '../redux/Slices/AttendanceSlice';
import { captureAttendanceQueueScope } from '../services/offline/attendanceQueueProvenance';
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from '../services/employeeAutoAttendancePolicy';

const Harness = () => {
  const policy = useAutoAttendance();
  return <View>
    <Text testID="effective-policy">{JSON.stringify({ allowed: policy.allowed, active: policy.active, fullActions: policy.fullActions })}</Text>
    <Button title="Enable" onPress={policy.handleGrantLocationAccess} />
    <Button title="Start" onPress={policy.handleStart} />
  </View>;
};
const receiveTenantGeo = value => mockStore.dispatch(settingsReceived({
  scope: buildSettingsScope(TEST_TENANT, 'EMP-001'),
  settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: value } }),
}));
const mount = () => render(<Provider store={mockStore}><Harness /></Provider>);
// Answers Continue on the explanation shown before any system prompt.
let unregisterExplainer = () => {};
const continueDisclosure = () => {
  const explain = jest.fn((_, proceed) => proceed());
  unregisterExplainer = setLocationAccessExplainer(explain);
  return explain;
};
afterEach(() => unregisterExplainer());

beforeEach(async () => {
  jest.clearAllMocks();
  getRegisteredGeofences.mockReturnValue([]);
  readDevicePosition.mockResolvedValue(null);
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
  await AsyncStorage.clear();
  await loginQueueEmployee('EMP-001');
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: 'EMP-001' } },
    featureSettings: automaticAttendanceSettings('EMP-001'),
    autoAttendance: { geotagging: 2, syncRequestId: 0 },
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
  receiveTenantGeo(true);
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  continueDisclosure();
  let releaseForeground;
  Location.requestForegroundPermissionsAsync.mockImplementationOnce(() => new Promise(resolve => { releaseForeground = resolve; }));
  const screen = mount();
  fireEvent.press(screen.getByText('Enable'));
  await waitFor(() => expect(releaseForeground).toBeDefined());
  await act(async () => { receiveTenantGeo(false); });
  await act(async () => { releaseForeground({ status: 'granted' }); });
  expect(getOfficeLocation).not.toHaveBeenCalled();
  expect(startGeofence).not.toHaveBeenCalled();
  expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
});

it('removes a dev registration completed after a tenant geo-only revocation', async () => {
  receiveTenantGeo(true);
  let releaseStart;
  startGeofence.mockImplementationOnce(() => new Promise(resolve => { releaseStart = resolve; }));
  const screen = mount();
  fireEvent.press(screen.getByText('Start'));
  await waitFor(() => expect(releaseStart).toBeDefined());
  await act(async () => { receiveTenantGeo(false); });
  await act(async () => { releaseStart(); });
  await waitFor(() => expect(stopGeofence).toHaveBeenCalled());
  expect(JSON.parse(screen.getByTestId('effective-policy').props.children).active).toBe(false);
});

it('keeps employee, office geometry and raw native errors out of release diagnostics', async () => {
  const previousDev = global.__DEV__;
  global.__DEV__ = false;
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const privateEvent = { employeeId: 'SYNTHETIC-PRIVATE-EMPLOYEE',
    tenantKey: 'https://private-office.example.com', latitude: 25.1234567,
    longitude: 51.9876543, radius: 4321, timestamp: 123456789 };
  try {
    mount();
    await act(async () => {
      addGeofenceEnterListener.mock.calls[0][0]({ ...privateEvent, transition: 'ENTER' });
      addGeofenceExitListener.mock.calls[0][0]({ ...privateEvent, transition: 'EXIT' });
      addErrorListener.mock.calls[0][0]({ ...privateEvent, code: 1000, message: 'SYNTHETIC-PRIVATE-ERROR' });
    });

    expect(log).toHaveBeenCalledWith('[AutoAttendance] ENTER detected');
    expect(log).toHaveBeenCalledWith('[AutoAttendance] EXIT detected');
    expect(log).toHaveBeenCalledWith('[AutoAttendance] Geofence error', { code: 1000 });
    const diagnostics = JSON.stringify(log.mock.calls);
    for (const value of [...Object.values(privateEvent), 'SYNTHETIC-PRIVATE-ERROR']) {
      expect(diagnostics).not.toContain(String(value));
    }
  } finally {
    log.mockRestore();
    global.__DEV__ = previousDev;
  }
});

describe('location permission recovery', () => {
  const PermissionHarness = () => {
    const policy = useAutoAttendance();
    return <View>
      <Text testID="permission">{String(policy.permissionGranted)}</Text>
      <Text testID="status">{policy.status.label}</Text>
      <Button title="Grant" onPress={policy.handleGrantLocationAccess} />
    </View>;
  };
  const mountPermission = () => render(<Provider store={mockStore}><PermissionHarness /></Provider>);
  const DENIED = { status: 'denied', canAskAgain: false };

  it('offers Settings when the system will no longer show the prompt', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    Location.getBackgroundPermissionsAsync.mockResolvedValue(DENIED);
    Location.requestBackgroundPermissionsAsync.mockResolvedValue(DENIED);
    const screen = mountPermission();

    await act(async () => { fireEvent.press(screen.getByText('Grant')); });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Location permission required', expect.any(String), expect.any(Array)));
    const buttons = alert.mock.calls.find(([title]) => title === 'Location permission required')[2];
    buttons.find(button => button.text === 'Open Settings').onPress();
    expect(openSettings).toHaveBeenCalled();
  });

  it('does not send the employee to Settings straight after they decline the prompt', async () => {
    const explain = continueDisclosure();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue(DENIED);
    const screen = mountPermission();

    await act(async () => { fireEvent.press(screen.getByText('Grant')); });

    await waitFor(() => expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled());
    expect(explain).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    // Recorded, so sign-in onboarding does not explain it again.
    await waitFor(() => expect(mockStore.getState().autoAttendance
      .locationOnboarding[buildSettingsScope(TEST_TENANT, 'EMP-001')]).toBe(true));
  });

  it('re-reads permission when the app returns from Settings', async () => {
    Location.getBackgroundPermissionsAsync.mockResolvedValue(DENIED);
    const screen = mountPermission();
    await waitFor(() => expect(screen.getByTestId('permission').props.children).toBe('false'));

    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    const onChange = AppState.addEventListener.mock.calls.filter(([type]) => type === 'change').pop()[1];
    await act(async () => { onChange('active'); });

    await waitFor(() => expect(screen.getByTestId('permission').props.children).toBe('true'));
  });

  it('keeps a failed access read unknown instead of claiming permission was revoked', async () => {
    Location.getForegroundPermissionsAsync.mockRejectedValue(new Error('Synthetic OS read failure'));
    const screen = mountPermission();
    await waitFor(() => expect(Location.getForegroundPermissionsAsync).toHaveBeenCalled());
    expect(screen.getByTestId('permission').props.children).toBe('null');
    expect(screen.getByTestId('status').props.children).not.toBe('Location permission required');
  });
});

describe('weak GPS presentation', () => {
  const WeakGpsHarness = () => {
    const policy = useAutoAttendance();
    return <Text testID="verification">{policy.verificationNotice?.message ?? ''}</Text>;
  };

  it.each(['missing', 'inaccurate'])('keeps an AUTO check-in active with %s indoor GPS', async quality => {
    getRegisteredGeofences.mockReturnValue([{ latitude: 25.28, longitude: 51.52, radius: 100 }]);
    if (quality === 'inaccurate') readDevicePosition.mockImplementation(async () => ({
      coords: { latitude: 25.28, longitude: 51.52, accuracy: 500 }, timestamp: Date.now(),
    }));
    mockStore.dispatch(setCheckin({ checkinTime: 1000, sessionOrigin: 'AUTO' }));
    const screen = render(<Provider store={mockStore}><WeakGpsHarness /></Provider>);
    await waitFor(() => expect(screen.getByTestId('verification').props.children)
      .toBe('Location signal is weak. Your check-in remains active.'));
    expect(mockStore.getState().attendance).toMatchObject({ checkin: true, checkinTime: 1000, sessionOrigin: 'AUTO' });

    await act(async () => { mockStore.dispatch(setCheckout({ checkoutTime: 2000 })); });
    expect(screen.getByTestId('verification').props.children).toBe('');
  });
});

describe('operational status', () => {
  const SCOPE = buildSettingsScope(TEST_TENANT, 'EMP-001');
  const StatusHarness = () => <Text testID="status">{useAutoAttendance().status.label}</Text>;
  const mountStatus = () => render(<Provider store={mockStore}><StatusHarness /></Provider>);
  const label = screen => screen.getByTestId('status').props.children;
  const report = state => act(() => { mockStore.dispatch(autoAttendanceMonitoringChanged({ scope: SCOPE, state })); });

  it('says the administrator disabled it and never asks for location', async () => {
    mockStore.dispatch(settingsReceived({
      scope: SCOPE, settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: false } }),
    }));
    const screen = mountStatus();
    await waitFor(() => expect(label(screen)).toBe('Disabled by administrator'));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never asks a warnings-only employee for location', async () => {
    await receiveEmployeeAutoAttendancePolicy({ geotagging: 1 },
      beginEmployeeAutoAttendancePolicyReception(await captureAttendanceQueueScope('EMP-001')));
    const screen = mountStatus();
    await waitFor(() => expect(label(screen)).toBe('Disabled by administrator'));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(startGeofence).not.toHaveBeenCalled();
  });

  it('is not Active merely because the employer enabled it', async () => {
    const screen = mountStatus();
    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    expect(label(screen)).toBe('Initializing monitoring');
    await report('active');
    expect(label(screen)).toBe('Active');
  });

  it('reports a registration that could not be established', async () => {
    const screen = mountStatus();
    await report('unavailable');
    await waitFor(() => expect(label(screen)).toBe('Monitoring unavailable'));
  });

  it('shows permission required once access is revoked, even while the registration stands', async () => {
    const screen = mountStatus();
    await report('active');
    await waitFor(() => expect(label(screen)).toBe('Active'));

    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const onChange = AppState.addEventListener.mock.calls.filter(([type]) => type === 'change').pop()[1];
    await act(async () => { onChange('active'); });

    await waitFor(() => expect(label(screen)).toBe('Location permission required'));
  });
});
