import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LanguageSetting from '../components/settings/LanguageSetting';
import { LANGUAGE_KEY, getLanguage, setLanguage } from '../localization';

jest.mock('../hooks/useAppTheme', () => ({
  __esModule: true,
  default: () => ({ colors: require('../constants').COLORS, isDark: false }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

beforeEach(async () => {
  await act(async () => { await setLanguage('en'); });
  jest.clearAllMocks();
});

it('saves and applies both languages without remounting the selector', async () => {
  const view = render(<LanguageSetting />);
  expect(view.getByRole('radio', { name: 'English' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(view.getByRole('radio', { name: 'العربية' }));
  await waitFor(() => expect(view.getByText('اللغة')).toBeTruthy());
  expect(view.getByRole('radio', { name: 'العربية' }).props.accessibilityState.selected).toBe(true);
  expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('ar');
  fireEvent.press(view.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(view.getByText('Language')).toBeTruthy());
  expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('en');
});

it('keeps the current language when saving fails and allows an explicit retry', async () => {
  const write = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Synthetic storage failure'));
  const view = render(<LanguageSetting />);
  fireEvent.press(view.getByRole('radio', { name: 'العربية' }));
  await waitFor(() => expect(view.getByText('Could not save your language. Please try again.')).toBeTruthy());
  expect(getLanguage()).toBe('en');
  expect(view.getByRole('radio', { name: 'English' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(view.getByRole('radio', { name: 'العربية' }));
  await waitFor(() => expect(getLanguage()).toBe('ar'));
  expect(write).toHaveBeenCalledTimes(2);
  write.mockRestore();
});
