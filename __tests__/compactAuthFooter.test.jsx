import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthFooter from '../components/common/AuthFooter';
import LanguageSetting from '../components/settings/LanguageSetting';
import { getLanguage, LANGUAGE_KEY, setLanguage } from '../localization';
import { COLORS, DARK_COLORS, SPACING, TYPO } from '../constants';

let mockDark = false;
jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: mockDark ? require('../constants').DARK_COLORS : require('../constants').COLORS, isDark: mockDark }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { nativeAppVersion: '3.2.1', expoConfig: { version: '9.0.0' } } }));
jest.mock('expo-updates', () => ({ isEnabled: false, isEmbeddedLaunch: true, updateId: null }));

const flatten = style => StyleSheet.flatten(style) || {};
const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS');

beforeEach(async () => {
  await act(async () => { await setLanguage('en'); });
  mockDark = false;
  jest.clearAllMocks();
});
afterEach(async () => {
  Object.defineProperty(Platform, 'OS', originalOS);
  await act(async () => { await setLanguage('en'); });
  jest.restoreAllMocks();
});

test.each([['ios', 44], ['android', 48]])('compact %s control has its accessible touch target and a small secondary surface', (os, minimum) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  mockDark = true;
  const screen = render(<LanguageSetting compact />);
  const button = screen.getByRole('button', { name: 'Switch to Arabic' });
  expect(flatten(button.props.style)).toMatchObject({ minHeight: minimum, minWidth: minimum });
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByText('English')).toBeNull();
  const icon = screen.UNSAFE_getByType('Ionicons');
  expect(icon.props.name).toBe('globe-outline');
  expect(flatten(icon.parent.props.style)).toMatchObject({ minHeight: 38, backgroundColor: DARK_COLORS.cardBackground, borderColor: DARK_COLORS.cardBorder });
  expect(flatten(icon.parent.props.style).shadowColor).toBeUndefined();
  expect(flatten(screen.getByText('العربية').props.style)).toMatchObject({ fontSize: TYPO.headline.fontSize, fontWeight: '500', color: DARK_COLORS.textSecondary });
});

test('one action changes and persists both languages while the footer metadata stays separate', async () => {
  const screen = render(<AuthFooter />);
  const metadata = screen.getByText('Version 3.2.1 · OTA Development');
  expect(metadata.props.onPress).toBeUndefined();
  expect(flatten(metadata.props.style).color).toBe(COLORS.textMuted);
  expect(flatten(screen.getByTestId('auth-footer').props.style)).toMatchObject({ flexDirection: 'column', gap: SPACING.sm });
  fireEvent.press(screen.getByRole('button', { name: 'Switch to Arabic' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'التبديل إلى الإنجليزية' })).toBeTruthy());
  expect(screen.getByText('English')).toBeTruthy();
  expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('ar');
  expect(flatten(screen.getByTestId('auth-footer').props.style).direction).toBe('rtl');
  fireEvent.press(screen.getByRole('button', { name: 'التبديل إلى الإنجليزية' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to Arabic' })).toBeTruthy());
  expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('en');
  expect(flatten(screen.getByTestId('auth-footer').props.style).direction).toBe('ltr');
});

test('rapid taps share one write and announce the busy state', async () => {
  let resolveWrite;
  const write = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => new Promise(resolve => { resolveWrite = resolve; }));
  const screen = render(<LanguageSetting compact />);
  fireEvent.press(screen.getByRole('button', { name: 'Switch to Arabic' }));
  fireEvent.press(screen.getByRole('button', { name: 'Switch to Arabic' }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Switch to Arabic' }).props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await act(async () => { resolveWrite(); });
  expect(screen.getByRole('button', { name: 'التبديل إلى الإنجليزية' }).props.accessibilityLanguage).toBe('ar');
});

test('a failed save preserves the current language and exposes an explicit retry', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Synthetic storage failure'));
  const screen = render(<LanguageSetting compact />);
  fireEvent.press(screen.getByRole('button', { name: 'Switch to Arabic' }));
  await waitFor(() => expect(screen.getByText('Could not save your language. Please try again.')).toBeTruthy());
  expect(getLanguage()).toBe('en');
  expect(screen.getByRole('button', { name: 'Switch to Arabic' }).props.accessibilityState.disabled).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Switch to Arabic' }));
  await waitFor(() => expect(getLanguage()).toBe('ar'));
});
