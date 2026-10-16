import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import useAttendanceAction from '../hooks/useAttendanceAction';
import RootReducer from '../redux/RootReducer';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { getTodayBreaks, employeeBreak } from '../services/api/attendance.service';
import { performManualAttendanceTransition } from '../services/offline/ManualAttendanceService';
import { captureAttendanceQueueScope } from '../services/offline/attendanceQueueProvenance';
import { SESSION_STATE_KEY } from '../utils/attendanceSessionState';
import { loginQueueEmployee, TEST_TENANT } from '../test-utils/attendanceScope';

const mockNavigation = { addListener: jest.fn(() => jest.fn()), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('../utils/HapticsMessage', () => ({ hapticsMessage: jest.fn() }));
jest.mock('../services/api/attendance.service', () => ({
  userCheckIn: jest.fn(), getAttendanceStatus: jest.fn(async () => ({ custom_in: 0, unavailable: true })),
  getDailyWorkedHours: jest.fn(async () => '08:00'), getMonthlyWorkedHours: jest.fn(async () => '80:00'),
  getTodayBreaks: jest.fn(), employeeBreak: jest.fn(),
  getServerTime: jest.fn(async () => '2026-10-16 09:00:00'),
}));
jest.mock('../services/offline/ManualAttendanceService', () => ({
  ...jest.requireActual('../services/offline/ManualAttendanceService'), performManualAttendanceTransition: jest.fn(),
}));
jest.mock('../services/offline/AttendanceQueueService', () => ({ getQueueCounts: jest.fn(async () => ({ awaitingServerCount: 0 })) }));
jest.mock('../services/offline/offlineAttendanceGate', () => ({ resolveNearestOffice: jest.fn(async () => ({ withinRadius: true })) }));

const employeeCode = 'EMP-001';
const scope = buildSettingsScope(TEST_TENANT, employeeCode);
let hook, store, attendanceScope;
function Harness() { hook = useAttendanceAction(); return null; }
const mount = () => render(<Provider store={store}><Harness /></Provider>);
const settings = (overrides) => normalizeFeatureSettings({ attendance_action: { employee_checkin_break: true, photo_upload: true, ...overrides } });
const update = (overrides) => store.dispatch(settingsReceived({ scope, settings: settings(overrides) }));
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await loginQueueEmployee(employeeCode);
  attendanceScope = await captureAttendanceQueueScope(employeeCode);
  await AsyncStorage.multiSet([['restrict_location', '0'], ['unrestricted_checkout_location', '0'], ['photo', '0']]);
  getTodayBreaks.mockResolvedValue({ total_break_minutes: 0, breaks: [] });
  employeeBreak.mockResolvedValue({ allowed: true, message: 'Break started' });
  store = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: TEST_TENANT, userDetails: { employeeCode } },
    attendance: { checkin: true, checkinTime: Date.now(), breakMinutes: 25 },
    featureSettings: { settings: settings({}), scope, status: 'success', lastFetchedAt: Date.now() },
  } });
  performManualAttendanceTransition.mockImplementation(async ({ type }) => {
    const session = { status: type === 'OUT' ? 'CHECKED_OUT' : 'CHECKED_IN', startedAt: Date.now(),
      endedAt: type === 'OUT' ? Date.now() : null, origin: 'MANUAL', closedBy: type === 'OUT' ? 'MANUAL' : null };
    await AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify(session));
    return { status: 'COMPLETED', session, response: { allowed: true }, scope: attendanceScope, occurredAt: Date.now() };
  });
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

it('suppresses disabled break reads and retained callbacks without deleting break state', async () => {
  const saved = String(Date.now() - 60_000);
  await AsyncStorage.setItem('breakStartTime', saved);
  update({ employee_checkin_break: false });
  mount();
  await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  await act(async () => { await hook.handleBreak('Synthetic reason'); });
  const focus = mockNavigation.addListener.mock.calls.find(([event]) => event === 'focus')[1];
  await act(async () => { await focus(); });
  expect(getTodayBreaks).not.toHaveBeenCalled();
  expect(employeeBreak).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('breakStartTime')).toBe(saved);
  expect(store.getState().attendance.breakMinutes).toBe(25);
});

it('rechecks a retained break callback after a live disable', async () => {
  mount();
  await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  const retained = hook.handleBreak;
  act(() => { update({ employee_checkin_break: false }); });
  getTodayBreaks.mockClear();
  await act(async () => { await retained(); });
  expect(getTodayBreaks).not.toHaveBeenCalled();
  expect(employeeBreak).not.toHaveBeenCalled();
});

it('stops a break mutation when the capability changes during its preflight read', async () => {
  mount();
  await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  let release;
  getTodayBreaks.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let pending;
  act(() => { pending = hook.handleBreak(); });
  await waitFor(() => expect(release).toBeDefined());
  act(() => { update({ employee_checkin_break: false }); });
  await act(async () => { release({ breaks: [] }); await pending; });
  expect(employeeBreak).not.toHaveBeenCalled();
});

it('suspends the two-hour break action after a live disable and preserves the stored timer', async () => {
  jest.useFakeTimers();
  const saved = String(Date.now() - 119 * 60_000);
  await AsyncStorage.setItem('breakStartTime', saved);
  mount();
  await waitFor(() => expect(hook.onBreak).toBe(true));
  act(() => { update({ employee_checkin_break: false }); });
  await act(async () => { jest.advanceTimersByTime(121_000); });
  expect(employeeBreak).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('breakStartTime')).toBe(saved);
});

it('allows checkout while a disabled break remains stored', async () => {
  await AsyncStorage.setItem('breakStartTime', String(Date.now() - 60_000));
  mount();
  await waitFor(() => expect(hook.onBreak).toBe(true));
  act(() => { update({ employee_checkin_break: false }); });
  await act(async () => { await hook.handlePrimaryAction(); });
  expect(performManualAttendanceTransition).toHaveBeenCalledWith(expect.objectContaining({ type: 'OUT' }));
  expect(employeeBreak).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Checked out!' }));
});

it('rechecks photo availability in a retained attendance callback and preserves direct attendance', async () => {
  await AsyncStorage.setItem('photo', '1');
  mount();
  await waitFor(() => expect(hook.restrictionLoaded).toBe(true));
  const retained = hook.handlePrimaryAction;
  act(() => { update({ photo_upload: false }); });
  await act(async () => { await retained(); });
  expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Attendance camera', expect.anything());
  expect(performManualAttendanceTransition).toHaveBeenCalled();
});
