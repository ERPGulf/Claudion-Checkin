import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthClient } from '@erpgulf/auth-sdk';
import MobileLogin from '../screens/MobileLogin';
import { getMobileAuthClient, completeMobileSignIn } from '../services/api/mobileAuth.service';
import { getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockStepScreens = jest.fn();
const mockPreventRemove = jest.fn();
const mockBlurListeners = new Set();
let mockAuthenticated = false;
const mockStore = { getState: () => ({ userAuth: { isLoggedIn: mockAuthenticated } }) };
const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  canGoBack: () => true,
  addListener: jest.fn((event, callback) => {
    if (event === 'blur') mockBlurListeners.add(callback);
    return () => mockBlurListeners.delete(callback);
  }),
};

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useStore: () => mockStore }));
jest.mock('../services/api/mobileAuth.service', () => ({
  getMobileAuthClient: jest.fn(),
  completeMobileSignIn: jest.fn(),
}));
jest.mock('../utils/mobileAuthCrypto', () => ({ isMobileAuthAvailable: () => true }));
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: require('../constants').DARK_COLORS, isDark: true }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  usePreventRemove: (prevent, callback) => mockPreventRemove(prevent, callback),
  useFocusEffect: effect => require('react').useEffect(effect, [effect]),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: ({ name, component: Component, initialParams }) => {
      mockStepScreens({ name, initialParams });
      return <Component />;
    },
  }),
}));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: props => <View {...props} /> };
});
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const icon = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: icon, MaterialCommunityIcons: icon, AntDesign: icon, Octicons: icon };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: ({ children, style }) => <View style={style}>{children}</View> };
});

const BACKEND = 'https://navigation.example.test';
const MOBILE = '+5550001';
const OTP = '314159';
const PASSWORD = 'chosen password bytes';
const MODES = {
  Optional: ['Optional', 'Optional', 'Optional'],
  Password: ['Mandatory', 'Mandatory', 'No'],
  Both: ['Mandatory', 'Mandatory', 'Mandatory'],
  OTP: ['No', 'No', 'Mandatory'],
};
const TOKEN = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'all openid' };
const EMPLOYEE = { id: 'HR-EMP-NAVIGATION', employee_name: 'Synthetic Employee', phone: MOBILE, email: null };
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let client;
let transport;
let policy;
let signupError;
let signinError;

function connect(mode = 'Optional', { signedUp = false, hasPassword = false } = {}) {
  const [signUpPassword, signInPassword, signInOtp] = MODES[mode];
  policy = {
    status: 'success', employee_id: EMPLOYEE.id,
    sign_up_policy: { password_policy: signUpPassword, otp_policy: 'Mandatory' },
    sign_in_policy: { password_policy: signInPassword, otp_policy: signInOtp },
    cold_boot_policy: { password_policy: signInPassword, otp_policy: signInOtp },
    employee_has_existing_password: hasPassword, employee_has_signed_up: signedUp,
  };
  transport = {
    request: jest.fn(async ({ url }) => {
      let body;
      if (url.endsWith('master_token')) body = { data: TOKEN };
      else if (url.endsWith('get_employee_login_policy')) body = policy;
      else if (url.endsWith('generate_and_send_otp')) body = { status: 'success', message: 'Sent', otp_expires_in: 30 };
      else if (url.endsWith('create_new_password')) body = { status: 'success' };
      else if (url.endsWith('sign_up_api') && signupError) body = { status: 'error', message: signupError };
      else if (url.endsWith('sign_in_api') && signinError) body = { status: 'error', message: signinError };
      else body = {
        status: 'success',
        data: {
          token: TOKEN, employee: EMPLOYEE, time: '2026-01-01 00:00:00',
          ...(url.endsWith('sign_in_api') && { password_policy: signInPassword, otp_policy: signInOtp }),
        },
      };
      return { status: 200, body };
    }),
  };
  client = createAuthClient({ baseUrl: BACKEND, transport });
  for (const method of ['begin', 'sendOtp', 'complete', 'setPasswordWithOtp']) jest.spyOn(client, method);
  getMobileAuthClient.mockReturnValue(client);
}

const mount = async () => {
  await AsyncStorage.setItem('backendUrl', BACKEND);
  const screen = render(<MobileLogin />);
  await screen.findByLabelText('Mobile number');
  return screen;
};
const press = async (screen, label) => {
  await act(async () => { fireEvent.press(screen.getByLabelText(label)); });
};
const expectStep = step => expect(mockStepScreens.mock.calls.at(-1)[0].name).toBe(step);
const routes = () => mockStepScreens.mock.calls.map(([route]) => route.name)
  .filter((name, index, names) => index === 0 || name !== names[index - 1]);
const start = async screen => {
  fireEvent.changeText(screen.getByLabelText('Mobile number'), MOBILE);
  await press(screen, 'Continue');
};
const enterOtp = async (screen, code = OTP) => {
  fireEvent.changeText(screen.getByLabelText('Verification code'), code);
  await press(screen, 'Verify code');
};
const enterNewPassword = (screen, value = PASSWORD, confirmation = value) => {
  fireEvent.changeText(screen.getByLabelText('New password'), value);
  fireEvent.changeText(screen.getByLabelText('Confirm password'), confirmation);
};
const submittedCredentials = () => completeMobileSignIn.mock.calls.at(-1)[0].credentials;
const blur = () => act(() => { for (const callback of mockBlurListeners) callback(); });
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const expectOnlyInputs = (screen, visible) => {
  for (const label of ['Mobile number', 'Verification code', 'Password', 'New password', 'Confirm password']) {
    expect(!!screen.queryByLabelText(label)).toBe(visible.includes(label));
  }
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: require('node:crypto').webcrypto });
});
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else delete globalThis.crypto;
});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuthenticated = false;
  mockBlurListeners.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  signupError = '';
  signinError = '';
  completeMobileSignIn.mockImplementation(options => options.auth.complete(options.flow, options.credentials));
  connect();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['Create password', 'Skip for now'])('takes optional signup through focused native screens to %s', async action => {
  const screen = await mount();
  expectStep('MOBILE');
  expectOnlyInputs(screen, ['Mobile number']);
  expect(screen.getByText('Company selected')).toBeTruthy();
  await start(screen);
  expectStep('OTP');
  expectOnlyInputs(screen, ['Verification code']);
  expect(screen.getByText(`We sent a verification code to ${MOBILE}.`)).toBeTruthy();
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(screen);
  expectStep('PASSWORD_OPTION');
  expectOnlyInputs(screen, ['New password', 'Confirm password']);
  expect(screen.getByText('Secure your account')).toBeTruthy();
  expect(screen.getByLabelText('Skip for now').props.accessibilityState.disabled).toBe(false);
  expect(client.complete).not.toHaveBeenCalled();
  if (action === 'Create password') enterNewPassword(screen);
  else enterNewPassword(screen, 'short', 'mismatch');
  await press(screen, action);
  expectStep('COMPLETE');
  expect(submittedCredentials()).toEqual(action === 'Create password' ? { otp: OTP, password: PASSWORD } : { otp: OTP });
  expect(routes()).toEqual(['MOBILE', 'OTP', 'PASSWORD_OPTION', 'COMPLETE']);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
});

it('never offers Skip on mandatory signup and keeps password creation separate from OTP', async () => {
  connect('Both');
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  expectStep('PASSWORD_CREATE');
  expectOnlyInputs(screen, ['New password', 'Confirm password']);
  expect(screen.queryByLabelText('Skip for now')).toBeNull();
  expect(screen.getByLabelText('Create password').props.accessibilityState.disabled).toBe(true);
  enterNewPassword(screen);
  await press(screen, 'Create password');
  expectStep('COMPLETE');
  expect(submittedCredentials()).toEqual({ otp: OTP, password: PASSWORD });
});

it('completes no-password signup from OTP without mounting a password screen', async () => {
  connect('OTP');
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  expectStep('COMPLETE');
  expect(routes()).toEqual(['MOBILE', 'OTP', 'COMPLETE']);
  expect(submittedCredentials()).toEqual({ otp: OTP });
});

it.each([true, false])('offers only the SDK-valid Optional sign-in credential when existing password is %s', async hasPassword => {
  connect('Optional', { signedUp: true, hasPassword });
  const screen = await mount();
  await start(screen);
  if (hasPassword) {
    expectStep('PASSWORD_SIGN_IN');
    expectOnlyInputs(screen, ['Password']);
    expect(screen.queryByLabelText('Send verification code')).toBeNull();
    expect(screen.queryByLabelText('Use verification code instead')).toBeNull();
    expect(screen.getByLabelText('Forgot password?')).toBeTruthy();
    expect(client.sendOtp).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Password'), PASSWORD);
    await press(screen, 'Sign in');
    expect(submittedCredentials()).toEqual({ password: PASSWORD });
  } else {
    expectStep('OTP');
    expectOnlyInputs(screen, ['Verification code']);
    expect(screen.queryByLabelText('Continue with password')).toBeNull();
    expect(client.sendOtp).toHaveBeenCalledTimes(1);
    await enterOtp(screen);
    expect(submittedCredentials()).toEqual({ otp: OTP });
  }
  expectStep('COMPLETE');
});

it('collects BOTH sign-in password before OTP and never sends again on rerender or Back', async () => {
  connect('Both', { signedUp: true, hasPassword: true });
  const screen = await mount();
  await start(screen);
  expectStep('PASSWORD_SIGN_IN');
  expectOnlyInputs(screen, ['Password']);
  expect(screen.queryByLabelText('Forgot password?')).toBeNull();
  expect(client.sendOtp).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Password'), PASSWORD);
  await press(screen, 'Continue');
  expectStep('OTP');
  expectOnlyInputs(screen, ['Verification code']);
  screen.rerender(<MobileLogin />);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await press(screen, 'Back');
  expectStep('PASSWORD_SIGN_IN');
  expect(screen.getByLabelText('Password').props.value).toBe(PASSWORD);
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(screen);
  expectStep('COMPLETE');
  expect(submittedCredentials()).toEqual({ password: PASSWORD, otp: OTP });
});

it.each(['create', 'reset'])('uses separate OTP and password screens for %s recovery and resolves a fresh sign-in flow', async mode => {
  connect('Optional', { signedUp: true, hasPassword: mode === 'reset' });
  const screen = await mount();
  await start(screen);
  await press(screen, mode === 'reset' ? 'Forgot password?' : 'Create a password');
  expectStep('OTP');
  expectOnlyInputs(screen, ['Verification code']);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  await enterOtp(screen);
  expectStep('PASSWORD_CREATE');
  expectOnlyInputs(screen, ['New password', 'Confirm password']);
  expect(screen.queryByLabelText('Skip for now')).toBeNull();
  expect(client.setPasswordWithOtp).not.toHaveBeenCalled();
  enterNewPassword(screen);
  policy.employee_has_existing_password = true;
  await press(screen, mode === 'reset' ? 'Reset password' : 'Create password');
  expectStep('PASSWORD_SIGN_IN');
  expectOnlyInputs(screen, ['Password']);
  expect(client.setPasswordWithOtp).toHaveBeenCalledWith({ mobileNumber: MOBILE, otp: OTP, newPassword: PASSWORD });
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(completeMobileSignIn).not.toHaveBeenCalled();
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
});

it('returns optional signup through Back without resending and retains company/mobile context', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  await press(screen, 'Back');
  expectStep('OTP');
  await press(screen, 'Back');
  expectStep('MOBILE');
  expect(screen.getByLabelText('Mobile number').props.value).toBe(MOBILE);
  expect(screen.getByText(BACKEND)).toBeTruthy();
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
  expect(client.begin).toHaveBeenCalledTimes(1);
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
});

it('routes a real signup business rejection to OTP and keeps the chosen password for correction', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  signupError = 'Invalid or expired OTP';
  await press(screen, 'Create password');
  expectStep('OTP');
  expectOnlyInputs(screen, ['Verification code']);
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  signupError = '';
  await enterOtp(screen, '271828');
  expectStep('PASSWORD_OPTION');
  expect(screen.getByLabelText('New password').props.value).toBe(PASSWORD);
  expect(screen.getByLabelText('Confirm password').props.value).toBe(PASSWORD);
  await press(screen, 'Create password');
  expectStep('COMPLETE');
  expect(submittedCredentials()).toEqual({ otp: '271828', password: PASSWORD });
});

it('keeps an invalid sign-in OTP on verification and allows correction without another send', async () => {
  connect('OTP', { signedUp: true });
  const screen = await mount();
  await start(screen);
  signinError = 'Invalid or expired OTP';
  await enterOtp(screen);
  expectStep('OTP');
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
  expect(screen.getAllByText(/invalid or expired/)).toHaveLength(2);
  expect(screen.getByLabelText('Verify code').props.accessibilityState.disabled).toBe(true);
  signinError = '';
  await enterOtp(screen, '271828');
  expectStep('COMPLETE');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
});

it('displays password validation inline while keeping Create disabled and Skip available', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen, 'short');
  expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy();
  expect(screen.getByLabelText('Create password').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByLabelText('Skip for now').props.accessibilityState.disabled).toBe(false);
  enterNewPassword(screen, PASSWORD, 'different-password');
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  expect(screen.getByLabelText('Create password').props.accessibilityState.disabled).toBe(true);
  expectOnlyInputs(screen, ['New password', 'Confirm password']);
  expect(client.complete).not.toHaveBeenCalled();
});

it('invalidates the old transaction when mobile changes after Back', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  await press(screen, 'Back');
  await press(screen, 'Back');
  fireEvent.changeText(screen.getByLabelText('Mobile number'), '+5550002');
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(client.begin).toHaveBeenLastCalledWith({ mobileNumber: '+5550002' });
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  await enterOtp(screen, '271828');
  expectStep('PASSWORD_OPTION');
  expect(screen.getByLabelText('New password').props.value).toBe('');
  expect(screen.getByLabelText('Confirm password').props.value).toBe('');
});

it('cancels the mobile transaction before QR navigation and keeps raw credentials out of storage and routes', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  await press(screen, 'Back');
  await press(screen, 'Back');
  await press(screen, 'Scan QR code');
  expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  expect(mockNavigate.mock.calls[0]).toHaveLength(1);
  expect(mockStepScreens.mock.calls.every(([route]) => route.initialParams === undefined)).toBe(true);
  expect(JSON.stringify(mockStepScreens.mock.calls)).not.toContain(OTP);
  expect(JSON.stringify(mockStepScreens.mock.calls)).not.toContain(PASSWORD);
  const stored = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
  expect(stored).toEqual([['backendUrl', BACKEND]]);
  // The test navigator does not unmount when QR opens. Re-entering verifies
  // that QR cancelled the previous transaction instead of silently reusing it.
  await press(screen, 'Continue');
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
});

it('uses outer route removal as flow Back while preserving the OTP transaction', async () => {
  const screen = await mount();
  await start(screen);
  const [prevent, onRemove] = mockPreventRemove.mock.calls.at(-1);
  expect(prevent).toBe(true);
  act(() => onRemove({ data: { action: { type: 'GO_BACK' } } }));
  expectStep('MOBILE');
  expect(mockGoBack).not.toHaveBeenCalled();
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(client.sendOtp).toHaveBeenCalledTimes(1);
  expect(client.begin).toHaveBeenCalledTimes(1);
});

it('discards a staged signup when the outer route blurs and starts a fresh transaction on return', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  expectStep('PASSWORD_OPTION');
  expect(mockBlurListeners.size).toBe(1);
  expect(mockNavigation.addListener).toHaveBeenCalledTimes(1);
  blur();
  expectStep('MOBILE');
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  await enterOtp(screen, '271828');
  expectStep('PASSWORD_OPTION');
  expect(screen.getByLabelText('New password').props.value).toBe('');
  expect(screen.getByLabelText('Confirm password').props.value).toBe('');
  screen.unmount();
  expect(mockBlurListeners.size).toBe(0);
});

it('preserves a successful Redux handoff on blur while notification completion is still pending', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  const pending = deferred();
  let options;
  completeMobileSignIn.mockImplementation(input => {
    options = input;
    invalidateAuthSession();
    return pending.promise;
  });
  await press(screen, 'Create password');
  expect(options.isCancelled()).toBe(false);
  mockAuthenticated = true; // setSignIn has already switched the root navigator.
  const generation = getAuthSessionGeneration();
  blur();
  expect(getAuthSessionGeneration()).toBe(generation);
  expect(options.isCancelled()).toBe(false);
  expectStep('PASSWORD_OPTION');
  expect(screen.getByLabelText('New password').props.value).toBe(PASSWORD);
  expect(screen.getByLabelText('Create password').props.accessibilityState.busy).toBe(true);
  await act(async () => { pending.resolve({ status: 'authenticated' }); });
  expectStep('COMPLETE');
  expectOnlyInputs(screen, []);
});

it('cancels a pending handoff on unauthenticated blur and ignores its late completion', async () => {
  const screen = await mount();
  await start(screen);
  await enterOtp(screen);
  enterNewPassword(screen);
  const pending = deferred();
  let options;
  completeMobileSignIn.mockImplementation(input => {
    options = input;
    invalidateAuthSession();
    return pending.promise;
  });
  await press(screen, 'Create password');
  const generation = getAuthSessionGeneration();
  blur();
  expect(options.isCancelled()).toBe(true);
  expect(getAuthSessionGeneration()).toBeGreaterThan(generation);
  expectStep('MOBILE');
  await act(async () => { pending.resolve({ status: 'authenticated' }); });
  expectStep('MOBILE');
  await press(screen, 'Continue');
  expectStep('OTP');
  expect(client.begin).toHaveBeenCalledTimes(2);
  expect(client.sendOtp).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Verification code').props.value).toBe('');
  await enterOtp(screen, '271828');
  expectStep('PASSWORD_OPTION');
  expect(screen.getByLabelText('New password').props.value).toBe('');
  expect(screen.getByLabelText('Confirm password').props.value).toBe('');
});
