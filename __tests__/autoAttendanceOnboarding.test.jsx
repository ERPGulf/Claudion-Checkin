import React from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockStore;
let mockPrecise = true;
let mockScheme = 'light';
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
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true, default: () => mockScheme,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockChannel = 'preview';
jest.mock('expo-updates', () => ({ get channel() { return mockChannel; } }));

import * as Location from 'expo-location';
import AutoAttendanceOnboarding from '../components/AutoAttendanceOnboarding';
import LocationOnboardingTestSetting from '../components/settings/LocationOnboardingTestSetting';
import { COLORS, DARK_COLORS } from '../constants';
import RootReducer from '../redux/RootReducer';
import { setSignIn } from '../redux/Slices/AuthSlice';
import { setBaseUrl, setEmployeeCode } from '../redux/Slices/UserSlice';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { selectLocationOnboardingAnswered } from '../redux/Slices/AutoAttendanceSlice';
import { askForLocationAccess, describeLocationAccessSteps, previewLocationAccessExplanation } from '../utils/autoAttendance';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';
import { captureAttendanceQueueScope } from '../services/offline/attendanceQueueProvenance';
import { beginEmployeeAutoAttendancePolicyReception, receiveEmployeeAutoAttendancePolicy } from '../services/employeeAutoAttendancePolicy';

const EMPLOYEE = 'EMP-001';
const OTHER_TENANT = 'https://branch.example.com';
const TITLE = 'Make attendance easier';
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

/** The tenant's settings and the employee's policy, as the server sends them. */
const receive = async ({
  attendance = { geo_tagging: true }, geotagging = 2, employee = EMPLOYEE, tenant = TEST_TENANT,
} = {}) => {
  await act(async () => {
    mockStore.dispatch(settingsReceived({
      scope: buildSettingsScope(tenant, employee),
      settings: normalizeFeatureSettings({ attendance_action: attendance }),
    }));
    const owner = await captureAttendanceQueueScope(employee);
    await receiveEmployeeAutoAttendancePolicy({ geotagging }, beginEmployeeAutoAttendancePolicyReception(owner));
  });
};
const mount = () => render(<Provider store={mockStore}><AutoAttendanceOnboarding /></Provider>);
const answered = () => selectLocationOnboardingAnswered(mockStore.getState());
const press = async (screen, label) => {
  await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByText(label)); });
};
const appState = async (next) => {
  const listeners = AppState.addEventListener.mock.calls.filter(([type]) => type === 'change');
  await act(async () => { listeners.forEach(([, listener]) => listener(next)); });
};
const signIn = async (employee, tenant = TEST_TENANT) => {
  await loginQueueEmployee(employee, tenant);
  await act(async () => {
    mockStore.dispatch({ type: 'REVERT_ALL' });
    mockStore.dispatch(setSignIn({ isLoggedIn: true }));
    mockStore.dispatch(setBaseUrl(tenant));
    mockStore.dispatch(setEmployeeCode(employee));
  });
};
let restorePlatform = () => {};
const onAndroid = (version) => {
  const original = Object.getOwnPropertyDescriptor(Platform, 'Version');
  Platform.OS = 'android';
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
  restorePlatform = () => {
    Platform.OS = 'ios';
    Object.defineProperty(Platform, 'Version', original);
  };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  AppState.currentState = 'active';
  mockPrecise = true;
  mockScheme = 'light';
  await loginQueueEmployee(EMPLOYEE);
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode: EMPLOYEE } },
  } });
  permissions(UNASKED, UNASKED);
  Location.getForegroundPermissionsAsync.mockImplementation(async () => os.foreground);
  Location.getBackgroundPermissionsAsync.mockImplementation(async () => os.background);
  onRequest({ foreground: GRANTED, background: GRANTED });
});

afterEach(() => {
  restorePlatform();
  restorePlatform = () => {};
  jest.useRealTimers();
});

describe('who is offered the explanation', () => {
  it.each([
    ['the tenant turns geotagging off', { attendance: { geo_tagging: false } }],
    ['the tenant sends geo_tagging 0', { attendance: { geo_tagging: 0 } }],
    ['the tenant sends geo_tagging null', { attendance: { geo_tagging: null } }],
    ['the tenant sends the string "true"', { attendance: { geo_tagging: 'true' } }],
    ['the tenant does not send the setting', { attendance: { photo_upload: true } }],
    ['the employee has geotagging 0', { geotagging: 0 }],
    // Warnings-only is never monitored, so it needs no location access at all.
    ['the employee is warnings-only (geotagging 1)', { geotagging: 1 }],
    ['the employee policy is malformed', { geotagging: 'abc' }],
    ['the employee policy is missing', { geotagging: null }],
  ])('never explains, checks or asks when %s', async (_, server) => {
    const screen = mount();
    await receive(server);
    await act(async () => {});

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('explains automatic attendance to an eligible employee before any system prompt', async () => {
    const screen = mount();
    await receive();

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(screen.getByText(/uses your location to record your attendance at your assigned workplace, even when the app is closed or not in use/)).toBeTruthy();
    expect(screen.getByText('Checked in as you arrive')).toBeTruthy();
    expect(screen.getByText('Checked out as you leave')).toBeTruthy();
    expect(screen.getByText('Precise location')).toBeTruthy();
    expect(screen.getByText('Choose "Allow While Using App" with Precise on.')).toBeTruthy();
    expect(screen.getByText('Background location')).toBeTruthy();
    expect(screen.getByText('Choose "Change to Always Allow".')).toBeTruthy();
    // iOS: Continue is the only way on; the system alert has its own "Don't Allow".
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('waits until both answers for this account have arrived', async () => {
    const screen = mount();
    await act(async () => {
      mockStore.dispatch(settingsReceived({
        scope: buildSettingsScope(TEST_TENANT, EMPLOYEE),
        settings: normalizeFeatureSettings({ attendance_action: { geo_tagging: true } }),
      }));
    });
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();

    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
  });

  it('does not act on answers persisted before this launch', async () => {
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
    const screen = mount();
    await act(async () => {});

    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['mentions offline saving while the employer allows it', {}, true],
    ['leaves offline saving out once the employer turns it off', { offline_attendance: false }, false],
  ])('%s', async (_, attendance, mentioned) => {
    const screen = mount();
    await receive({ attendance: { geo_tagging: true, ...attendance } });

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(!!screen.queryByText("Kept when you're offline")).toBe(mentioned);
  });
});

describe('the permission flow', () => {
  it('starts the existing sequence once on Continue, foreground before background, behind the explanation', async () => {
    let grantForeground;
    Location.requestForegroundPermissionsAsync.mockImplementation(() => new Promise((resolve) => {
      grantForeground = () => { os.foreground = GRANTED; resolve(GRANTED); };
    }));
    const screen = mount();
    await receive();
    await press(screen, 'Continue');

    // The system prompt is up; the explanation stays behind it until the flow ends.
    await waitFor(() => expect(grantForeground).toBeDefined());
    expect(screen.getByText(TITLE)).toBeTruthy();
    await act(async () => { grantForeground(); });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
    const [foreground] = Location.requestForegroundPermissionsAsync.mock.invocationCallOrder;
    const [background] = Location.requestBackgroundPermissionsAsync.mock.invocationCallOrder;
    expect(foreground).toBeLessThan(background);
    // Granted: the bootstraps checked before permission existed and must register now.
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(1);
    expect(answered()).toBe(true);
  });

  it('lists and asks for only what is missing', async () => {
    permissions(GRANTED, UNASKED);
    const screen = mount();
    await receive();

    await waitFor(() => expect(screen.getByText('Background location')).toBeTruthy());
    expect(screen.queryByText('Precise location')).toBeNull();
    await press(screen, 'Continue');
    await waitFor(() => expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1));
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('shows nothing and asks nothing when everything is already granted', async () => {
    permissions(GRANTED, GRANTED);
    const screen = mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
    expect(answered()).toBe(false);
  });

  it('verifies the OS state afterwards instead of trusting the request result', async () => {
    // "Always" was asked for, but the OS still reports only foreground access.
    onRequest({ foreground: GRANTED });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue(GRANTED);
    const screen = mount();
    await receive();
    await press(screen, 'Continue');

    await waitFor(() => expect(answered()).toBe(true));
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);
  });

  it('degrades gracefully after a declined system prompt: recorded, never prompted again', async () => {
    onRequest({ foreground: DENIED });
    const screen = mount();
    await receive();
    await press(screen, 'Continue');

    await waitFor(() => expect(answered()).toBe(true));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockStore.getState().autoAttendance.syncRequestId).toBe(0);

    await receive();
    await appState('background');
    await appState('active');
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never explains once the system will no longer ask', async () => {
    permissions(BLOCKED, UNASKED);
    const screen = mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('treats approximate location as missing, which iOS offers only in Settings', async () => {
    permissions(GRANTED, GRANTED);
    mockPrecise = false;
    const screen = mount();
    await receive();

    await waitFor(() => expect(Location.getBackgroundPermissionsAsync).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('on Android', () => {
  it('offers Not now, which is kept as the answer with no system prompt', async () => {
    onAndroid(34);
    const screen = mount();
    await receive();
    await press(screen, 'Not now');

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(answered()).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();

    await receive();
    await appState('background');
    await appState('active');
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('treats Back as Not now, never as consent', async () => {
    onAndroid(34);
    const screen = mount();
    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    await act(async () => { fireEvent(screen.getByTestId('location-access-explainer'), 'requestClose'); });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(answered()).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks again for precise location when only approximate was granted', async () => {
    onAndroid(34);
    permissions(GRANTED, GRANTED);
    mockPrecise = false;
    const screen = mount();
    await receive();

    await waitFor(() => expect(screen.getByText('Precise location')).toBeTruthy());
    expect(screen.queryByText('Background location')).toBeNull();
    await press(screen, 'Continue');
    await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1));
  });

  it.each([
    [34, 'Android opens this app\'s location settings. Choose "Allow all the time".'],
    [30, 'Android opens this app\'s location settings. Choose "Allow all the time".'],
    [29, 'Choose "Allow all the time".'],
  ])('describes the background step for API %i', (version, hint) => {
    onAndroid(version);
    const steps = describeLocationAccessSteps({ foreground: 'undetermined', background: 'undetermined', precise: false });

    expect(steps.map(step => step.key)).toEqual(['precise', 'background']);
    expect(steps[0].hint).toBe('Choose "Precise" and "While using the app".');
    expect(steps[1].hint).toBe(hint);
  });

  it('has no separate background step on Android 9, which grants it with foreground', () => {
    onAndroid(28);
    const steps = describeLocationAccessSteps({ foreground: 'undetermined', background: 'undetermined', precise: false });

    expect(steps.map(step => step.key)).toEqual(['precise']);
  });
});

describe('once per account', () => {
  it('stays answered across a relaunch', async () => {
    onRequest({ foreground: DENIED });
    const first = mount();
    await receive();
    await press(first, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));
    first.unmount();

    const relaunched = mount();
    await receive();
    await act(async () => {});

    expect(relaunched.queryByText(TITLE)).toBeNull();
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('leaves access revoked later to the Automatic attendance screen', async () => {
    const screen = mount();
    await receive();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));

    // Revoked in Settings, in a state the system could ask about again.
    permissions(DENIED, DENIED);
    await appState('background');
    await appState('active');
    await receive();
    expect(screen.queryByText(TITLE)).toBeNull();

    // The screen's "Grant location access" still explains before asking.
    let flow;
    await act(async () => { flow = askForLocationAccess({ fromTap: true }); });
    await press(screen, 'Continue');
    await act(async () => { await flow; });
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  it('shows one explanation through duplicate mounts, refreshes and foreground changes', async () => {
    const screens = [mount(), mount()];
    const count = () => screens.reduce((total, screen) => total + screen.queryAllByText(TITLE).length, 0);
    await receive();
    await receive();
    await waitFor(() => expect(count()).toBe(1));

    await appState('background');
    await appState('active');
    await receive();
    expect(count()).toBe(1);

    await press(screens.find(screen => screen.queryByText(TITLE)), 'Continue');
    await waitFor(() => expect(count()).toBe(0));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('evaluates each employee on their own', async () => {
    onRequest({ foreground: DENIED });
    const screen = mount();
    await receive();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));

    // Another employee on the same device: A's answer is not theirs.
    permissions(UNASKED, UNASKED);
    await signIn('EMP-002');
    expect(answered()).toBe(false);
    await receive({ employee: 'EMP-002' });

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
  });

  it('keeps tenants apart, even for the same employee ID', async () => {
    onRequest({ foreground: DENIED });
    const screen = mount();
    await receive();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));

    permissions(UNASKED, UNASKED);
    await signIn(EMPLOYEE, OTHER_TENANT);
    expect(answered()).toBe(false);
    await receive({ tenant: OTHER_TENANT });

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
  });

  it.each([
    ['the employee policy', { geotagging: 0 }],
    ['the tenant switch', { attendance: { geo_tagging: false } }],
  ])('explains again once the employee becomes eligible again through %s', async (_, off) => {
    onRequest({ foreground: DENIED });
    const screen = mount();
    await receive();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));

    await receive(off);
    await waitFor(() => expect(answered()).toBe(false));
    expect(screen.queryByText(TITLE)).toBeNull();
    await receive();

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
  });
});

describe('when the session or configuration changes', () => {
  it('closes without recording or asking when the employee signs out while it is open', async () => {
    const screen = mount();
    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    await act(async () => {
      mockStore.dispatch({ type: 'REVERT_ALL' });
      mockStore.dispatch(setSignIn({ isLoggedIn: false }));
    });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(mockStore.getState().autoAttendance.locationOnboarding).toEqual({});
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('closes without asking when the employer turns it off while it is open', async () => {
    const screen = mount();
    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    await receive({ attendance: { geo_tagging: false } });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(answered()).toBe(false);
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('waits for the foreground instead of explaining during a background launch', async () => {
    AppState.currentState = 'background';
    const screen = mount();
    await receive();
    await act(async () => {});
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();

    await appState('active');

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
  });
});

describe('presentation', () => {
  it('does not hold up the permission flow when iOS cannot present the explanation', async () => {
    jest.useFakeTimers();
    const screen = mount();
    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    // Never shown (another modal was up): closed unanswered, nothing recorded.
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(answered()).toBe(false);

    // The flow is free again: the screen's button explains, and once shown it stays.
    await act(async () => { askForLocationAccess({ fromTap: true }); });
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    await act(async () => { fireEvent(screen.getByTestId('location-access-explainer'), 'show'); });
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it.each([['light', COLORS], ['dark', DARK_COLORS]])('takes its colours from the %s palette', async (scheme, palette) => {
    mockScheme = scheme;
    const screen = mount();
    await receive();

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(StyleSheet.flatten(screen.getByText(TITLE).props.style).color).toBe(palette.textPrimary);
    expect(StyleSheet.flatten(screen.getByText('Checked in as you arrive').props.style).color).toBe(palette.textPrimary);
  });

  it('reads as a titled page with one screen-reader stop per row', async () => {
    const screen = mount();
    await receive();

    await waitFor(() => expect(screen.getByRole('header', { name: TITLE })).toBeTruthy());
    expect(screen.getByLabelText(
      'Background location. So attendance works while the app is closed. Choose "Change to Always Allow".',
    )).toBeTruthy();
  });
});

describe('development preview', () => {
  const WARNINGS_TITLE = 'Enable location-based attendance';
  const mountWithPanel = () => render(
    <Provider store={mockStore}><AutoAttendanceOnboarding /><LocationOnboardingTestSetting /></Provider>,
  );

  it('shows the automatic explanation whatever the configuration, asking and recording nothing', async () => {
    // Nothing received: this account is not eligible.
    const screen = mountWithPanel();
    await press(screen, 'Automatic attendance (mode 2)');

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(screen.getByText('Precise location')).toBeTruthy();
    expect(screen.getByText('Background location')).toBeTruthy();
    await press(screen, 'Continue');

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(answered()).toBe(false);
  });

  it('shows the warnings-only explanation without promising automatic attendance', async () => {
    const screen = mountWithPanel();
    await press(screen, 'Warnings only (mode 1)');

    await waitFor(() => expect(screen.getByText(WARNINGS_TITLE)).toBeTruthy());
    expect(screen.getByText(/warn you when you're near or outside your assigned workplace\. It never checks you in or out\./)).toBeTruthy();
    expect(screen.getByText('Warnings and reminders')).toBeTruthy();
    expect(screen.getByText('Precise location')).toBeTruthy();
    expect(screen.queryByText('Background location')).toBeNull();
    expect(screen.queryByText('Checked in as you arrive')).toBeNull();
    expect(screen.queryByText("Kept when you're offline")).toBeNull();
    await press(screen, 'Continue');

    await waitFor(() => expect(screen.queryByText(WARNINGS_TITLE)).toBeNull());
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('closes on Android Not now, recording nothing', async () => {
    onAndroid(34);
    const screen = mountWithPanel();
    await press(screen, 'Warnings only (mode 1)');
    await press(screen, 'Not now');

    await waitFor(() => expect(screen.queryByText(WARNINGS_TITLE)).toBeNull());
    expect(answered()).toBe(false);
  });

  it('never takes over a real explanation waiting for an answer', async () => {
    const screen = mountWithPanel();
    await receive();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    let preview;
    await act(async () => { preview = await previewLocationAccessExplanation(1); });

    expect(preview).toBeNull();
    expect(screen.queryByText(WARNINGS_TITLE)).toBeNull();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('gives way to a real explanation that becomes due', async () => {
    const screen = mountWithPanel();
    await press(screen, 'Warnings only (mode 1)');
    await waitFor(() => expect(screen.getByText(WARNINGS_TITLE)).toBeTruthy());

    await receive();

    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(screen.queryByText(WARNINGS_TITLE)).toBeNull();
    await press(screen, 'Continue');
    await waitFor(() => expect(answered()).toBe(true));
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('is not offered in production builds', () => {
    const originalDev = global.__DEV__;
    global.__DEV__ = false;
    mockChannel = 'production';
    try {
      const screen = render(<Provider store={mockStore}><LocationOnboardingTestSetting /></Provider>);
      expect(screen.queryByText('Location explanation test')).toBeNull();
    } finally {
      global.__DEV__ = originalDev;
      mockChannel = 'preview';
    }
  });
});
