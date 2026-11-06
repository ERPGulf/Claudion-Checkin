import React from 'react';
import { act, render } from '@testing-library/react-native';
import { setLanguage, t } from '../localization';
import Navigator from '../navigation/navigator';
import Chat from '../screens/Chat';

const mockSetOptions = jest.fn();
const mockNavigation = { setOptions: mockSetOptions };
const mockColors = { surfaceSecondary: '#ffffff', textPrimary: '#111111' };

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('react-redux', () => ({ useSelector: () => false }));
jest.mock('../navigation/app-navigator', () => () => null);
jest.mock('../navigation/auth-navigator', () => () => null);
jest.mock('../navigation/rootNavigation', () => ({ navigationRef: { current: null }, flushPendingNavigation: jest.fn() }));
jest.mock('../services/crashlytics.service', () => ({ setCrashScreen: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children, ...props }) => require('react').createElement('NavigationContainer', props, children),
  useNavigation: () => mockNavigation,
}));
jest.mock('../hooks/useAppTheme', () => () => ({ colors: mockColors }));

test('React Navigation receives the same locale direction and updates without replacement', async () => {
  await act(async () => { await setLanguage('en'); });
  const screen = render(<Navigator />);
  expect(screen.UNSAFE_getByType('NavigationContainer').props.direction).toBe('ltr');
  await act(async () => { await setLanguage('ar'); });
  expect(screen.UNSAFE_getByType('NavigationContainer').props.direction).toBe('rtl');
  await act(async () => { await setLanguage('en'); });
  expect(screen.UNSAFE_getByType('NavigationContainer').props.direction).toBe('ltr');
});

test('updates the retained Chat tab header after changing language', async () => {
  await act(async () => { await setLanguage('en'); });
  render(<Chat />);
  expect(mockSetOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: 'Chat' }));
  await act(async () => { await setLanguage('ar'); });
  expect(mockSetOptions).toHaveBeenLastCalledWith(expect.objectContaining({ headerTitle: t('Chat') }));
  await act(async () => { await setLanguage('en'); });
});
