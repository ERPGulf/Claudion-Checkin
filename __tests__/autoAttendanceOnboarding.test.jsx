import React from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockStore;
let mockPrecise = true;
jest.mock('../redux/Store', () => ({ store: {
  getState: () => mockStore?.getState() ?? {}, dispatch: action => mockStore?.dispatch(action),
} }));
jest.mock('../modules/expo-auto-attendance', () => ({
  isAvailable: () => true, hasFullAccuracy: () => mockPrecise, isMonitoring: () => false,
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));

import * as Location from 'expo-location';
import AutoAttendanceOnboarding from '../components/AutoAttendanceOnboarding';
import RootReducer from '../redux/RootReducer';
import { setSignIn } from '../redux/Slices/AuthSlice';
import { setBaseUrl, setEmployeeCode } from '../redux/Slices/UserSlice';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { selectAutoAttendanceDeclinedLocationAccess } from '../redux/Slices/AutoAttendanceSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';
import { captureAttendanceQueueScope } from '../services/offline/attendanceQueueProvenance';
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from '../services/employeeAutoAttendancePolicy';

const EMPLOYEE = 'EMP-001';
const UNASKED = { status: 'undetermined', canAskAgain: true };
const GRANTED = { status: 'granted', canAskAgain: true };
const DENIED = { status: 'denied', canAskAgain: true };
const BLOCKED = { status: 'denied', canAskAgain: false };

/** What the OS reports; a request moves it to the given result. */
let os;
const permissions = (foreground, background) => { os = { foreground, background }; };
const onRequest = ({ foreground, background } = {}) => {
  Location.requestForegroundPermissionsAsync.mockImplementation(async () => {
    if (foreground) os.foreground = foreground;
    return os.foreground;
  });
  Location.requestBackgroundPermissionsAsync.mockImplementation(async () => {
    if (background) os.background = background;
    return os.background;
  });
};
const answer = text => jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) =>
  buttons.find(button => button.text === text).onPress());

/** The tenant's settings and the employee's policy, as the server sends them. */
const receive = async ({ attendance = { geo_tagging: true }, geotagging = 2, employee = EMPLOYEE } = {}) => {
  await act(async () => {
    mockStore.dispatch(settingsReceived({
      scope: buildSettingsScope(TEST_TENANT, employee),
      settings: normalizeFeatureSettings({ attendance_action: attendance }),
    }));
    const owner = await captureAttendanceQueueScope(employee);
    await receiveEmployeeAutoAttendancePolicy({ geotagging }, beginEmployeeAutoAttendancePolicyReception(owner));
  });
};
const mount = () => render(<Provider store={mockStore}><AutoAttendanceOnboarding /></Provider>);
const declined = () => selectAutoAttendanceDeclinedLocationAccess(mockStore.getState());
const signIn = async (employee) => {
  await loginQueueEmployee(employee);
  await act(async () => {
    mockStore.dispatch({ type: 'REVERT_ALL' });
    mockStore.dispatch(setSignIn({ isLoggedIn: true }));
    mockStore.dispatch(setBaseUrl(TEST_TENANT));
    mockStore.dispatch(setEmployeeCode(employee));
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  AppState.currentState = 'active';
  mockPrecise = true;
  await loginQueueEmployee(EMPLOYEE);
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: EMPLOYEE } },
  } });
  permissions(UNASKED, UNASKED);
  Location.getForegroundPermissionsAsync.mockImplementation(async () => os.foreground);
  Location.getBackgroundPermissionsAsync.mockImplementation(async () => os.background);
  onRequest({ foreground: GRANTED, background: GRANTED });
});

describe('the employer decides whether to ask at all', () => {
  it.each([
    ['the employer disables automatic attendance', { attendance: { geo_tagging: false } }],
    ['the tenant does not send the setting', { attendance: { photo_upload: true } }],
    ['the tenant sends geo_tagging null', { attendance: { geo_tagging: null } }],
    ['the employee is warnings-only (geotagging 1)', { geotagging: 1 }],
    ['the employee policy disables it', { geotagging: 0 }],
  ])('never checks or asks when %s', async (_, server) => {
    const alert = answer('Continue');
    mount();
    await receive(server);

    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('begins with a permission check once the employer enables it for an eligible employee', async () => {
    answer('Not now');
    mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
  });
});

describe('staged permission flow', () => {
  it('explains first, then asks for foreground before background location', async () => {
    const alert = answer('Continue');
    mount();
    await receive();

    // The bootstraps checked before permission existed; they must register now.
    await waitFor(() => expect(mockStore.getState().autoAttendance.syncRequestId).toBe(1));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Automatic attendance');
    expect(alert.mock.calls[0][1]).toMatch(/arrive at or leave your assigned work locations, including when the app is not open/);
    const [foreground] = Location.requestForegroundPermissionsAsync.mock.invocationCallOrder;
    const [background] = Location.requestBackgroundPermissionsAsync.mock.invocationCallOrder;
    expect(foreground).toBeLessThan(background);
  });

  it('asks only for background location when foreground is already granted', async () => {
    permissions(GRANTED, UNASKED);
    const alert = answer('Continue');
    mount();
    await receive();

    await waitFor(() => expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('shows nothing and asks nothing when everything is already granted', async () => {
    permissions(GRANTED, GRANTED);
    const alert = answer('Continue');
    mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
  });

  it('verifies the OS state after asking instead of trusting the request result', async () => {
    answer('Continue');
    // "Always" was asked for, but the OS still reports only foreground access.
    onRequest({ foreground: GRANTED });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue(GRANTED);
    mount();
    await receive();

    await waitFor(() => expect(declined()).toBe('granted/undetermined/true'));
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
  });

  it('treats approximate location as missing: Android asks for precise again', async () => {
    permissions(GRANTED, GRANTED);
    mockPrecise = false;
    const alert = answer('Continue');
    Platform.OS = 'android';
    try {
      mount();
      await receive();
      await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1));
      expect(alert).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = 'ios';
    }
  });

  it('treats approximate location as missing: iOS offers Precise Location only in Settings', async () => {
    permissions(GRANTED, GRANTED);
    mockPrecise = false;
    const alert = answer('Continue');
    mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('declines are respected', () => {
  it('does not ask again in the state the employee declined in, including after sign-out', async () => {
    const alert = answer('Not now');
    mount();
    await receive();
    await waitFor(() => expect(declined()).toBe('undetermined/undetermined/false'));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

    await receive();
    await signIn(EMPLOYEE);
    await receive();

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('records a system-level denial and keeps automatic attendance unrequested afterwards', async () => {
    const alert = answer('Continue');
    onRequest({ foreground: DENIED });
    mount();
    await receive();

    await waitFor(() => expect(declined()).toBe('denied/undetermined/false'));
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    await receive();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never prompts once the system will no longer ask', async () => {
    permissions(BLOCKED, UNASKED);
    const alert = answer('Continue');
    mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks again once the OS state changes from the declined one', async () => {
    const alert = answer('Not now');
    mount();
    await receive();
    await waitFor(() => expect(declined()).not.toBeNull());

    // Foreground granted elsewhere (manual check-in); background still missing.
    permissions(GRANTED, UNASKED);
    const onChange = AppState.addEventListener.mock.calls.filter(([type]) => type === 'change').pop()[1];
    await act(async () => { onChange('background'); });
    await act(async () => { onChange('active'); });

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  });
});

describe('when onboarding may appear', () => {
  it('does not act on answers persisted before this launch', async () => {
    const alert = answer('Continue');
    const earlier = Date.now() - 60_000;
    const scope = buildSettingsScope(TEST_TENANT, EMPLOYEE);
    mockStore = configureStore({ reducer: RootReducer, preloadedState: {
      userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: EMPLOYEE } },
      featureSettings: {
        settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true } }),
        scope, status: 'success', error: null, lastFetchedAt: earlier,
      },
      autoAttendance: { geotagging: 2, employeePolicy: { scope, mode: 2, source: 'response', receivedAt: earlier } },
    } });
    mount();
    await act(async () => {});

    expect(alert).not.toHaveBeenCalled();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('waits for the foreground instead of prompting during a background launch', async () => {
    const alert = answer('Not now');
    AppState.currentState = 'background';
    mount();
    await receive();
    expect(alert).not.toHaveBeenCalled();

    const onChange = AppState.addEventListener.mock.calls.find(([type]) => type === 'change')[1];
    await act(async () => { onChange('active'); });

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  });

  it('shows one dialog for duplicate mounts and repeated refreshes', async () => {
    let answerLater;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      answerLater = () => buttons.find(button => button.text === 'Not now').onPress();
    });
    mount();
    mount();
    await receive();
    await receive();
    await waitFor(() => expect(answerLater).toBeDefined());
    await act(async () => { answerLater(); });
    await receive();

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('evaluates each account on its own', async () => {
    const alert = answer('Not now');
    mount();
    await receive();
    await waitFor(() => expect(declined()).not.toBeNull());

    // Another employee on the same device: A's answer is not theirs.
    await signIn('EMP-002');
    expect(declined()).toBeNull();
    await receive({ employee: 'EMP-002' });

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  });
});
