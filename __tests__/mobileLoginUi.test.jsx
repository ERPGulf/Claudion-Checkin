import React from 'react';
import { BackHandler, I18nManager, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { act, render, fireEvent } from '@testing-library/react-native';
import { COLORS, DARK_COLORS } from '../constants';

let mockMobileAvailable = true;
jest.mock('../utils/mobileAuthCrypto', () => ({ isMobileAuthAvailable: () => mockMobileAvailable }));

let mockColors;
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: mockColors, isDark: mockColors === require('../constants').DARK_COLORS }),
}));

let mockLogin;
const mockUseMobileLogin = jest.fn(() => mockLogin);
jest.mock('../hooks/useMobileLogin', () => ({ __esModule: true, default: () => mockUseMobileLogin() }));
const mockStore = { getState: () => ({ userAuth: { isLoggedIn: false } }) };
jest.mock('react-redux', () => ({ useStore: () => mockStore }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = false;
let mockPreventRemoval;
let mockPreventRemoveCallback;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => mockCanGoBack, addListener: () => jest.fn() }),
  usePreventRemove: (prevent, callback) => {
    mockPreventRemoval = prevent;
    mockPreventRemoveCallback = callback;
  },
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
let mockActiveStep;
let mockScreenProps;
let mockStackOptions;
jest.mock('@react-navigation/native-stack', () => {
  const { View } = require('react-native');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children, screenOptions }) => {
        mockStackOptions = screenOptions;
        return <View>{children}</View>;
      },
      Screen: ({ component: Component, name, ...props }) => {
        mockActiveStep = name;
        mockScreenProps = props;
        return <Component />;
      },
    }),
  };
});
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

import MobileLogin from '../screens/MobileLogin';

const flow = (password = 'disabled', otp = 'disabled', action = 'SIGN_IN', purpose = 'existing') => ({
  action,
  credentials: { password: { requirement: password, purpose }, otp: { requirement: otp } },
  capabilities: { canCreatePassword: false, canResetPassword: false },
});
let mockHardwareBack;
let backSubscription;
const originalRtl = I18nManager.isRTL;

beforeEach(() => {
  jest.clearAllMocks();
  mockColors = COLORS;
  mockMobileAvailable = true;
  mockCanGoBack = false;
  I18nManager.isRTL = false;
  backSubscription = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, callback) => {
    mockHardwareBack = callback;
    return { remove: jest.fn() };
  });
  mockLogin = {
    step: 'MOBILE',
    backendUrl: null,
    companyCode: '',
    discovery: 'company',
    serverAddress: '',
    mobileNumber: '',
    password: '',
    otp: '',
    newPassword: '',
    confirmPassword: '',
    flow: null,
    passwordMode: null,
    canCreatePassword: false,
    canResetPassword: false,
    isLoading: false,
    isHydrating: false,
    isNewPasswordValid: false,
    error: null,
    companyCodeError: null,
    serverAddressError: null,
    mobileNumberError: null,
    passwordError: null,
    newPasswordError: null,
    confirmPasswordError: null,
    otpError: null,
    resendSeconds: 0,
    otpSent: false,
  };
  [
    'setCompanyCode', 'setDiscovery', 'setServerAddress', 'setMobileNumber', 'setPassword', 'setOtp',
    'setNewPassword', 'setConfirmPassword', 'begin', 'continuePasswordSignIn', 'submitOtp',
    'submitNewPassword', 'skipPassword', 'resendOtp', 'changeCompany', 'startCreatePassword',
    'startResetPassword', 'goBack', 'cancelFlow',
  ].forEach(action => { mockLogin[action] = jest.fn(); });
});

afterEach(() => {
  I18nManager.isRTL = originalRtl;
  backSubscription.mockRestore();
});

it('collects company and mobile on the account screen without rendering credentials', () => {
  const screen = render(<MobileLogin />);
  fireEvent.changeText(screen.getByLabelText('Company code'), 'SYNTHETIC-COMPANY');
  fireEvent.changeText(screen.getByLabelText('Mobile number'), '+15550000000');
  fireEvent.press(screen.getByLabelText('Continue'));

  expect(mockLogin.setCompanyCode).toHaveBeenCalledWith('SYNTHETIC-COMPANY');
  expect(mockLogin.setMobileNumber).toHaveBeenCalledWith('+15550000000');
  expect(mockLogin.begin).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(mockActiveStep).toBe('MOBILE');
});

it('preserves company-code and typed-address selection, field errors, and company change', () => {
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Use company code').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText('Use server address'));
  expect(mockLogin.setDiscovery).toHaveBeenCalledWith('server');

  mockLogin.discovery = 'server';
  mockLogin.serverAddressError = 'Enter a valid HTTPS server address.';
  screen.rerender(<MobileLogin />);
  expect(screen.queryByLabelText('Company code')).toBeNull();
  expect(screen.getByLabelText('Use server address').props.accessibilityState.selected).toBe(true);
  expect(screen.getByText('Enter a valid HTTPS server address.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Server address'), 'erp.example.test');
  expect(mockLogin.setServerAddress).toHaveBeenCalledWith('erp.example.test');

  mockLogin.backendUrl = 'https://company.example.test';
  screen.rerender(<MobileLogin />);
  expect(screen.queryByLabelText('Use server address')).toBeNull();
  expect(screen.getByText('Company selected')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Change company'));
  expect(mockLogin.changeCompany).toHaveBeenCalledTimes(1);
});

it('shows OTP as the only credential and submits without sending a code on render', () => {
  mockLogin.step = 'OTP';
  mockLogin.flow = flow('optional', 'required', 'SIGN_UP', 'create');
  mockLogin.otp = '000000';
  mockLogin.otpSent = true;
  mockLogin.mobileNumber = '+15550000000';
  const screen = render(<MobileLogin />);

  expect(screen.getByText('Verify your mobile number')).toBeTruthy();
  expect(screen.getByText('We sent a verification code to +15550000000.')).toBeTruthy();
  expect(screen.getByText('Your code will be checked when you finish setting up your account.')).toBeTruthy();
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(screen.queryByLabelText('Confirm password')).toBeNull();
  expect(screen.queryByLabelText('Mobile number')).toBeNull();
  expect(screen.queryByLabelText('Scan QR code')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Verification code'), '111111');
  fireEvent.press(screen.getByLabelText('Verify code'));
  screen.rerender(<MobileLogin />);

  expect(mockLogin.setOtp).toHaveBeenCalledWith('111111');
  expect(mockLogin.submitOtp).toHaveBeenCalledTimes(1);
  expect(mockLogin.begin).not.toHaveBeenCalled();
  expect(mockLogin.resendOtp).not.toHaveBeenCalled();
});

it('keeps OTP errors on the OTP screen and disables empty code submission', () => {
  mockLogin.step = 'OTP';
  mockLogin.flow = flow('disabled', 'required');
  mockLogin.otpError = 'Enter your verification code.';
  mockLogin.error = 'The verification code is invalid or expired.';
  const screen = render(<MobileLogin />);

  expect(screen.getByText('Enter your verification code.')).toBeTruthy();
  expect(screen.getByText('The verification code is invalid or expired.')).toBeTruthy();
  expect(screen.getByLabelText('Verification code')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Verify code'));
  expect(mockLogin.submitOtp).not.toHaveBeenCalled();
});

it.each(['PASSWORD_OPTION', 'PASSWORD_CREATE'])('separates %s creation from OTP and submits valid confirmed passwords', step => {
  mockLogin.step = step;
  mockLogin.flow = flow(step === 'PASSWORD_OPTION' ? 'optional' : 'required', 'required', 'SIGN_UP', 'create');
  mockLogin.otp = '000000';
  mockLogin.newPassword = 'synthetic-new-password';
  mockLogin.confirmPassword = 'synthetic-new-password';
  mockLogin.isNewPasswordValid = true;
  const screen = render(<MobileLogin />);

  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.getByLabelText('New password')).toBeTruthy();
  expect(screen.getByLabelText('Confirm password')).toBeTruthy();
  expect(!!screen.queryByLabelText('Skip for now')).toBe(step === 'PASSWORD_OPTION');
  fireEvent.changeText(screen.getByLabelText('New password'), 'synthetic-new-password');
  fireEvent.changeText(screen.getByLabelText('Confirm password'), 'synthetic-new-password');
  fireEvent.press(screen.getByLabelText('Create password'));
  expect(mockLogin.setNewPassword).toHaveBeenCalledWith('synthetic-new-password');
  expect(mockLogin.setConfirmPassword).toHaveBeenCalledWith('synthetic-new-password');
  expect(mockLogin.submitNewPassword).toHaveBeenCalledTimes(1);
});

it('offers a visible optional-password skip even when the draft password is invalid', () => {
  mockLogin.step = 'PASSWORD_OPTION';
  mockLogin.newPassword = 'short';
  mockLogin.newPasswordError = 'Use at least 8 characters.';
  mockLogin.confirmPasswordError = 'Passwords do not match.';
  const screen = render(<MobileLogin />);

  expect(screen.getByText('Secure your account')).toBeTruthy();
  expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Create password'));
  expect(mockLogin.submitNewPassword).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Skip for now').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(screen.getByLabelText('Skip for now'));
  expect(mockLogin.skipPassword).toHaveBeenCalledTimes(1);
});

it('renders only the resolved SDK sign-in factor when optional raw policy permits no alternative', () => {
  mockLogin.step = 'PASSWORD_SIGN_IN';
  mockLogin.flow = { ...flow('required', 'disabled'), policy: { signInPolicy: { passwordPolicy: 'optional', otpPolicy: 'optional' }, employeeHasExistingPassword: true } };
  mockLogin.password = 'synthetic-password';
  const screen = render(<MobileLogin />);

  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByText('Use verification code instead')).toBeNull();
  fireEvent.press(screen.getByLabelText('Sign in'));
  expect(mockLogin.continuePasswordSignIn).toHaveBeenCalledTimes(1);

  mockLogin.step = 'OTP';
  mockLogin.flow = { ...flow('disabled', 'required'), policy: { signInPolicy: { passwordPolicy: 'optional', otpPolicy: 'optional' }, employeeHasExistingPassword: false } };
  screen.rerender(<MobileLogin />);
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.getByLabelText('Verification code')).toBeTruthy();
});

it('uses a password-only screen before a required OTP and preserves inline password errors', () => {
  mockLogin.step = 'PASSWORD_SIGN_IN';
  mockLogin.flow = flow('required', 'required');
  mockLogin.password = 'synthetic-password';
  mockLogin.passwordError = 'Enter your password.';
  const screen = render(<MobileLogin />);
  expect(screen.getByText('Enter your password.')).toBeTruthy();
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  fireEvent.press(screen.getByLabelText('Continue'));
  expect(mockLogin.continuePasswordSignIn).toHaveBeenCalledTimes(1);
});

it('shows create/reset capabilities only when the hook allows them', () => {
  mockLogin.step = 'PASSWORD_SIGN_IN';
  mockLogin.flow = flow('required', 'required');
  mockLogin.flow.capabilities = { canCreatePassword: true, canResetPassword: true };
  const screen = render(<MobileLogin />);
  expect(screen.queryByLabelText('Create a password')).toBeNull();
  expect(screen.queryByLabelText('Forgot password?')).toBeNull();

  mockLogin.canResetPassword = true;
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Forgot password?'));
  expect(mockLogin.startResetPassword).toHaveBeenCalledTimes(1);

  mockLogin.step = 'OTP';
  mockLogin.canCreatePassword = true;
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Create a password'));
  expect(mockLogin.startCreatePassword).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Forgot password?'));
  expect(mockLogin.startResetPassword).toHaveBeenCalledTimes(2);
});

it.each(['create', 'reset'])('keeps %s recovery OTP separate from the new password screen', mode => {
  mockLogin.step = 'OTP';
  mockLogin.passwordMode = mode;
  mockLogin.canCreatePassword = true;
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Verification code')).toBeTruthy();
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(screen.queryByLabelText('Create a password')).toBeNull();

  mockLogin.step = 'PASSWORD_CREATE';
  mockLogin.isNewPasswordValid = true;
  screen.rerender(<MobileLogin />);
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByLabelText('Skip for now')).toBeNull();
  expect(screen.getByPlaceholderText('At least 8 characters')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(mode === 'reset' ? 'Reset password' : 'Create password'));
  expect(mockLogin.submitNewPassword).toHaveBeenCalledTimes(1);
});

it('keeps resend disabled during countdown and enables a manual resend afterward', () => {
  mockLogin.step = 'OTP';
  mockLogin.resendSeconds = 24;
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Resend in 24s').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByLabelText('Resend in 24s'));
  expect(mockLogin.resendOtp).not.toHaveBeenCalled();

  mockLogin.resendSeconds = 0;
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Resend code'));
  expect(mockLogin.resendOtp).toHaveBeenCalledTimes(1);
});

it('returns through the flow using the visible back button, native removal, and Android back', () => {
  mockLogin.step = 'PASSWORD_OPTION';
  const screen = render(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Back'));
  expect(mockLogin.goBack).toHaveBeenCalledTimes(1);
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(mockPreventRemoval).toBe(true);
  act(() => mockPreventRemoveCallback());
  expect(mockLogin.goBack).toHaveBeenCalledTimes(2);
  expect(mockHardwareBack()).toBe(true);
  expect(mockLogin.goBack).toHaveBeenCalledTimes(3);
  expect(mockLogin.resendOtp).not.toHaveBeenCalled();
});

it('cancels transient credentials before leaving the account screen for QR or its parent', () => {
  mockCanGoBack = true;
  const screen = render(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Scan QR code'));
  expect(mockLogin.cancelFlow).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
  fireEvent.press(screen.getByLabelText('Back'));
  expect(mockLogin.cancelFlow).toHaveBeenCalledTimes(2);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  expect(mockPreventRemoval).toBe(false);
  expect(mockHardwareBack()).toBe(false);
  expect(mockLogin.cancelFlow).toHaveBeenCalledTimes(3);
});

it('blocks primary, secondary, company change, QR, native removal, and Android back during submission', () => {
  mockLogin.backendUrl = 'https://company.example.test';
  mockLogin.isLoading = true;
  mockCanGoBack = true;
  const screen = render(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Change company'));
  fireEvent.press(screen.getByLabelText('Scan QR code'));
  fireEvent.press(screen.getByLabelText('Continue'));
  fireEvent.press(screen.getByLabelText('Back'));
  act(() => mockPreventRemoveCallback());
  expect(mockHardwareBack()).toBe(true);
  expect(mockLogin.changeCompany).not.toHaveBeenCalled();
  expect(mockLogin.begin).not.toHaveBeenCalled();
  expect(mockLogin.cancelFlow).not.toHaveBeenCalled();
  expect(mockLogin.goBack).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();

  mockLogin.step = 'PASSWORD_OPTION';
  mockLogin.isNewPasswordValid = true;
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Create password'));
  fireEvent.press(screen.getByLabelText('Skip for now'));
  expect(mockLogin.submitNewPassword).not.toHaveBeenCalled();
  expect(mockLogin.skipPassword).not.toHaveBeenCalled();
});

it('uses password reveal controls without altering the flow', () => {
  mockLogin.step = 'PASSWORD_SIGN_IN';
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  fireEvent.press(screen.getByLabelText('Show password'));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
  fireEvent.press(screen.getByLabelText('Hide password'));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  expect(mockLogin.begin).not.toHaveBeenCalled();
});

it('never supplies OTP/password in native navigator route params', () => {
  mockLogin.step = 'PASSWORD_OPTION';
  mockLogin.otp = '000000';
  mockLogin.newPassword = 'synthetic-new-password';
  render(<MobileLogin />);
  expect(mockActiveStep).toBe('PASSWORD_OPTION');
  expect(mockScreenProps).toEqual({});
  expect(mockStackOptions.gestureEnabled).toBe(false);
});

it('shows completion progress without a back button and blocks native back while completing', () => {
  mockLogin.step = 'COMPLETE';
  mockCanGoBack = true;
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Signing you in')).toBeTruthy();
  expect(screen.queryByLabelText('Back')).toBeNull();
  expect(screen.queryByLabelText('Verification code')).toBeNull();
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(mockPreventRemoval).toBe(true);
  act(() => mockPreventRemoveCallback());
  expect(mockHardwareBack()).toBe(true);
  expect(mockLogin.goBack).not.toHaveBeenCalled();
});

it('shows hydration progress before account inputs become available', () => {
  mockLogin.isHydrating = true;
  const screen = render(<MobileLogin />);
  expect(screen.getByLabelText('Loading sign-in')).toBeTruthy();
  expect(screen.queryByLabelText('Mobile number')).toBeNull();
  expect(mockLogin.begin).not.toHaveBeenCalled();
});

it('offers QR without mounting the mobile hook when crypto is unavailable', () => {
  mockMobileAvailable = false;
  const screen = render(<MobileLogin />);
  expect(mockUseMobileLogin).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Mobile number')).toBeNull();
  fireEvent.press(screen.getByLabelText('Scan QR code'));
  expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
});

it.each([COLORS, DARK_COLORS])('uses the selected palette and keyboard-friendly scrolling', colors => {
  mockColors = colors;
  const screen = render(<MobileLogin />);
  expect(StyleSheet.flatten(screen.getByLabelText('Continue').props.style).backgroundColor).toBe(colors.accentFill);
  expect(screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('interactive');
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy();
});

it('localizes the new steps and aligns Arabic inputs and copy for RTL', () => {
  I18nManager.isRTL = true;
  mockLogin.step = 'PASSWORD_OPTION';
  const screen = render(<MobileLogin />);
  expect(screen.getByText('أمّن حسابك')).toBeTruthy();
  expect(screen.getByLabelText('تخطي الآن')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByLabelText('كلمة مرور جديدة').props.style).textAlign).toBe('right');
  expect(StyleSheet.flatten(screen.getByText('أمّن حسابك').props.style).textAlign).toBe('right');
  fireEvent.press(screen.getByLabelText('تخطي الآن'));
  expect(mockLogin.skipPassword).toHaveBeenCalledTimes(1);
});
