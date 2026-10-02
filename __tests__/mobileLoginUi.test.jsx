import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { COLORS, DARK_COLORS } from '../constants';

let mockMobileAvailable = true;
jest.mock('../utils/mobileAuthCrypto', () => ({
  isMobileAuthAvailable: () => mockMobileAvailable,
}));

let mockColors;
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: mockColors, isDark: mockColors === require('../constants').DARK_COLORS }),
}));

let mockLogin;
const mockUseMobileLogin = jest.fn(() => mockLogin);
jest.mock('../hooks/useMobileLogin', () => ({
  __esModule: true,
  default: () => mockUseMobileLogin(),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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

import MobileLogin from '../screens/MobileLogin';

const credential = (requirement, purpose = 'existing') => ({ requirement, purpose });
const flow = (nextStep, password = 'disabled', otp = 'disabled', purpose = 'existing') => ({
  nextStep,
  credentials: { password: credential(password, purpose), otp: credential(otp) },
  capabilities: { canCreatePassword: false, canResetPassword: false },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockColors = COLORS;
  mockMobileAvailable = true;
  mockLogin = {
    backendUrl: null,
    companyCode: '',
    mobileNumber: '',
    password: '',
    otp: '',
    newPassword: '',
    flow: null,
    passwordMode: null,
    isLoading: false,
    isHydrating: false,
    error: null,
    companyCodeError: null,
    mobileNumberError: null,
    resendSeconds: 0,
    otpSent: false,
  };
  [
    'setCompanyCode', 'setDiscovery', 'setServerAddress', 'setMobileNumber', 'setPassword', 'setOtp', 'setNewPassword',
    'begin', 'complete', 'resendOtp', 'changeCompany', 'startCreatePassword',
    'startResetPassword', 'cancelPasswordMode', 'savePassword',
  ].forEach(action => { mockLogin[action] = jest.fn(); });
});

it('collects the company code and mobile number before beginning', () => {
  const { getByLabelText } = render(<MobileLogin />);

  fireEvent.changeText(getByLabelText('Company code'), 'SYNTHETIC-COMPANY');
  fireEvent.changeText(getByLabelText('Mobile number'), '+15550000000');
  fireEvent.press(getByLabelText('Continue'));

  expect(mockLogin.setCompanyCode).toHaveBeenCalledWith('SYNTHETIC-COMPANY');
  expect(mockLogin.setMobileNumber).toHaveBeenCalledWith('+15550000000');
  expect(mockLogin.begin).toHaveBeenCalledTimes(1);
});

it('switches between a company code and a typed server address', () => {
  const screen = render(<MobileLogin />);

  expect(screen.getByLabelText('Use company code').props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByLabelText('Use server address'));
  expect(mockLogin.setDiscovery).toHaveBeenCalledWith('server');

  mockLogin.discovery = 'server';
  screen.rerender(<MobileLogin />);
  expect(screen.queryByLabelText('Company code')).toBeNull();
  expect(screen.getByLabelText('Use server address').props.accessibilityState.selected).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Server address'), 'erp.example.test');
  expect(mockLogin.setServerAddress).toHaveBeenCalledWith('erp.example.test');
});

it('uses the selected company and offers Change company', () => {
  mockLogin.backendUrl = 'https://company.example.test';
  const { getByLabelText, getByText, queryByLabelText } = render(<MobileLogin />);

  expect(queryByLabelText('Company code')).toBeNull();
  expect(queryByLabelText('Use server address')).toBeNull();
  expect(getByText('Company selected')).toBeTruthy();
  fireEvent.press(getByLabelText('Change company'));
  expect(mockLogin.changeCompany).toHaveBeenCalledTimes(1);
});

it.each([
  ['CREATE_PASSWORD_AND_ENTER_OTP', 'required', 'required', 'create', 'New password', true],
  ['ENTER_OTP_OPTIONAL_PASSWORD', 'optional', 'required', 'create', 'New password', true],
  ['ENTER_PASSWORD_AND_OTP', 'required', 'required', 'existing', 'Password', true],
  ['ENTER_PASSWORD', 'required', 'disabled', 'existing', 'Password', false],
  ['ENTER_OTP', 'disabled', 'required', 'none', null, true],
  ['CONTINUE_SESSION', 'disabled', 'disabled', 'none', null, false],
])('renders only the supplied credentials for %s', (step, password, otp, purpose, passwordLabel, hasOtp) => {
  mockLogin.flow = flow(step, password, otp, purpose);
  const { queryByLabelText, queryByText } = render(<MobileLogin />);

  expect(!!queryByLabelText('Password')).toBe(passwordLabel === 'Password');
  expect(!!queryByLabelText('New password')).toBe(passwordLabel === 'New password');
  expect(!!queryByLabelText('Verification code')).toBe(hasOtp);
  expect(!!queryByText('Optional')).toBe(password === 'optional');
});

it('submits credentials through complete and preserves the QR destination', () => {
  mockLogin.flow = flow('ENTER_OTP', 'disabled', 'required');
  const { getByLabelText } = render(<MobileLogin />);

  fireEvent.changeText(getByLabelText('Verification code'), '000000');
  fireEvent.press(getByLabelText('Sign in'));
  fireEvent.press(getByLabelText('Scan QR code'));

  expect(mockLogin.setOtp).toHaveBeenCalledWith('000000');
  expect(mockLogin.complete).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
});

it('keeps resend disabled for the server-provided cooldown', () => {
  mockLogin.flow = flow('ENTER_OTP', 'disabled', 'required');
  mockLogin.resendSeconds = 42;
  const screen = render(<MobileLogin />);

  expect(screen.getByLabelText('Resend in 42s').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByLabelText('Resend in 42s'));
  expect(mockLogin.resendOtp).not.toHaveBeenCalled();

  mockLogin.resendSeconds = 0;
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Resend code'));
  expect(mockLogin.resendOtp).toHaveBeenCalledTimes(1);
});

it('shows password actions only when the flow allows them', () => {
  mockLogin.flow = flow('ENTER_OTP', 'disabled', 'required');
  const screen = render(<MobileLogin />);
  expect(screen.queryByLabelText('Create a password')).toBeNull();
  expect(screen.queryByLabelText('Forgot password?')).toBeNull();

  mockLogin.flow.capabilities = { canCreatePassword: true, canResetPassword: true };
  screen.rerender(<MobileLogin />);
  fireEvent.press(screen.getByLabelText('Create a password'));
  fireEvent.press(screen.getByLabelText('Forgot password?'));
  expect(mockLogin.startCreatePassword).toHaveBeenCalledTimes(1);
  expect(mockLogin.startResetPassword).toHaveBeenCalledTimes(1);
});

it.each(['create', 'reset'])('renders the %s password step in the same screen', mode => {
  mockLogin.flow = flow('ENTER_PASSWORD', 'required', 'disabled');
  mockLogin.passwordMode = mode;
  const { getByLabelText, queryByLabelText } = render(<MobileLogin />);

  expect(queryByLabelText('Password')).toBeNull();
  expect(getByLabelText('Verification code')).toBeTruthy();
  fireEvent.changeText(getByLabelText('New password'), 'synthetic-new-password');
  fireEvent.press(getByLabelText('Save password'));
  fireEvent.press(getByLabelText('Back to sign-in'));

  expect(mockLogin.setNewPassword).toHaveBeenCalledWith('synthetic-new-password');
  expect(mockLogin.savePassword).toHaveBeenCalledTimes(1);
  expect(mockLogin.cancelPasswordMode).toHaveBeenCalledTimes(1);
});

it('blocks company change and navigation during submission', () => {
  mockLogin.backendUrl = 'https://company.example.test';
  mockLogin.isLoading = true;
  const { getByLabelText } = render(<MobileLogin />);

  fireEvent.press(getByLabelText('Change company'));
  fireEvent.press(getByLabelText('Scan QR code'));
  expect(mockLogin.changeCompany).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('offers QR sign-in without mounting the mobile hook when crypto is unavailable', () => {
  mockMobileAvailable = false;
  const { getByLabelText, queryByLabelText } = render(<MobileLogin />);

  expect(mockUseMobileLogin).not.toHaveBeenCalled();
  expect(queryByLabelText('Mobile number')).toBeNull();
  fireEvent.press(getByLabelText('Scan QR code'));
  expect(mockNavigate).toHaveBeenCalledWith('Qrscan');
});

it('supports the dark palette and a scrolling keyboard-friendly form', () => {
  mockColors = DARK_COLORS;
  const { getByLabelText, UNSAFE_getByType } = render(<MobileLogin />);
  expect(StyleSheet.flatten(getByLabelText('Continue').props.style).backgroundColor).toBe(DARK_COLORS.accentFill);
  expect(UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});
