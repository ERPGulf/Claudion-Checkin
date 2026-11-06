import React from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import UpdateBanner from '../components/UpdateBanner';

let mockUpdateState;
jest.mock('expo-updates', () => ({
  isEnabled: true,
  useUpdates: () => mockUpdateState,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const originalDev = global.__DEV__;
const originalAppState = AppState.currentState;
let onAppState;
let remove;

beforeEach(() => {
  jest.clearAllMocks();
  global.__DEV__ = false;
  AppState.currentState = 'active';
  mockUpdateState = { isUpdateAvailable: false, isUpdatePending: false, isDownloading: false };
  Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
  Updates.fetchUpdateAsync.mockResolvedValue({});
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onAppState = callback;
    return { remove };
  });
});

afterEach(() => {
  global.__DEV__ = originalDev;
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
});

const transition = async state => act(async () => {
  AppState.currentState = state;
  onAppState(state);
});

it('does no update work during a background attendance launch and checks on foreground', async () => {
  AppState.currentState = 'background';
  render(<UpdateBanner />);
  await act(async () => {});
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
  await transition('active');
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
});

it('coalesces foreground events while a check is in flight', async () => {
  let resolveCheck;
  Updates.checkForUpdateAsync.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve; }));
  render(<UpdateBanner />);
  await transition('active');
  await transition('active');
  expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  await act(async () => resolveCheck({ isAvailable: true }));
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
});

it('waits for a later foreground event after a failed download instead of retrying on state changes', async () => {
  mockUpdateState = { ...mockUpdateState, isUpdateAvailable: true };
  Updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
  Updates.fetchUpdateAsync.mockRejectedValue(new Error('synthetic update outage'));
  const view = render(<UpdateBanner />);
  await act(async () => {});
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  mockUpdateState = { ...mockUpdateState, isUpdateAvailable: true, isDownloading: true };
  view.rerender(<UpdateBanner />);
  mockUpdateState = { ...mockUpdateState, isDownloading: false };
  view.rerender(<UpdateBanner />);
  await act(async () => {});
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  await transition('background');
  await transition('active');
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(2);
});

it.each(['unmount', 'background'])('does not download after a check completes following %s', async action => {
  let resolveCheck;
  Updates.checkForUpdateAsync.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve; }));
  const view = render(<UpdateBanner />);
  if (action === 'unmount') view.unmount();
  else await transition('background');
  await act(async () => resolveCheck({ isAvailable: true }));
  expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
  if (action === 'unmount') expect(remove).toHaveBeenCalledTimes(1);
});

it('does not check again while a downloaded update is waiting for the user', async () => {
  mockUpdateState = { ...mockUpdateState, isUpdatePending: true };
  render(<UpdateBanner />);
  await act(async () => {});
  await transition('active');
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

it('skips update checks in development', async () => {
  global.__DEV__ = true;
  render(<UpdateBanner />);
  await act(async () => {});
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
});
