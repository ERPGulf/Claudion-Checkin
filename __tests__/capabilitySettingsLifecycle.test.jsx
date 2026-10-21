import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useFeatureSettings from '../hooks/useFeatureSettings';
import RootReducer from '../redux/RootReducer';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import { setBaseUrl, setEmployeeCode } from '../redux/Slices/UserSlice';
import { buildSettingsScope, normalizeFeatureSettings } from '../utils/featureSettings';
import { activateAuthSession, getAuthSessionGeneration, invalidateAuthSession } from '../utils/authSessionGuard';

let mockStore;
jest.mock('../redux/Store', () => ({ store: { getState: () => mockStore.getState() } }));
jest.mock('../services/api/featureSettings.service', () => ({ getFeatureSettings: jest.fn() }));

const tenant = 'https://lifecycle-alpha.example.test';
const otherTenant = 'https://lifecycle-beta.example.test';
const employeeCode = 'EMP-SYNTHETIC';
const scope = buildSettingsScope(tenant, employeeCode);
let hook;
function Harness() { hook = useFeatureSettings(); return null; }
const mount = () => render(<Provider store={mockStore}><Harness /></Provider>);
const response = enabled => ({ message: normalizeFeatureSettings({ expense_claim: enabled }) });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
};
const startRefresh = async () => {
  const calls = getFeatureSettings.mock.calls.length;
  let pending;
  act(() => { pending = hook.refresh(); });
  await waitFor(() => expect(getFeatureSettings).toHaveBeenCalledTimes(calls + 1));
  return { pending };
};

beforeEach(async () => {
  jest.clearAllMocks();
  getFeatureSettings.mockReset();
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ['baseUrl', tenant], ['employee_code', employeeCode], ['access_token', 'synthetic-access'],
  ]);
  mockStore = configureStore({ reducer: RootReducer, preloadedState: {
    userAuth: { isLoggedIn: true }, user: { baseUrl: tenant, userDetails: { employeeCode } },
  } });
  getFeatureSettings.mockResolvedValue(response(true));
});
afterEach(cleanup);

it.each([false, null])('keeps the latest disabled setting %p when an older request finishes later', async disabled => {
  const old = deferred();
  const latest = deferred();
  getFeatureSettings.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  mount();
  const first = await startRefresh();
  const second = await startRefresh();
  await act(async () => { latest.resolve(response(disabled)); await second.pending; });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  await act(async () => { old.resolve(response(true)); await first.pending; });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.status).toBe('success');
});

it('ignores a late failure superseded by a successful refresh', async () => {
  const old = deferred();
  getFeatureSettings.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(false));
  mount();
  const first = await startRefresh();
  await act(async () => { await hook.refresh(); });
  await act(async () => { old.reject(new Error('Synthetic outage')); await first.pending; });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.status).toBe('success');
  expect(hook.error).toBeNull();
});

it('does not restore a pending response or identity after logout', async () => {
  const held = deferred();
  getFeatureSettings.mockReturnValueOnce(held.promise);
  mount();
  const first = await startRefresh();
  act(() => { invalidateAuthSession(); mockStore.dispatch({ type: 'REVERT_ALL' }); });
  await act(async () => { held.resolve(response(false)); await first.pending; });
  expect(mockStore.getState().featureSettings.settings).toBeNull();
  expect(mockStore.getState().user.baseUrl).toBeNull();
  expect(mockStore.getState().userAuth.isLoggedIn).toBe(false);
});

it('does not hydrate identity when logout occurs between owner validation and the refresh continuation', async () => {
  mockStore = configureStore({ reducer: RootReducer, preloadedState: { userAuth: { isLoggedIn: true } } });
  const held = deferred();
  getFeatureSettings.mockReturnValueOnce(held.promise);
  mount();
  const first = await startRefresh();
  const getState = mockStore.getState;
  const spy = jest.spyOn(mockStore, 'getState').mockImplementationOnce(() => {
    const root = getState();
    queueMicrotask(() => { invalidateAuthSession(); mockStore.dispatch({ type: 'REVERT_ALL' }); });
    return root;
  });
  try {
    await act(async () => { held.resolve(response(false)); await first.pending; });
    expect(mockStore.getState().user.baseUrl).toBeNull();
    expect(mockStore.getState().user.userDetails).toBeNull();
    expect(mockStore.getState().featureSettings.settings).toBeNull();
  } finally { spy.mockRestore(); }
});

it('keeps a new tenant response and rejects the previous tenant response before identity writes', async () => {
  const old = deferred();
  getFeatureSettings.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(false));
  mount();
  const first = await startRefresh();
  await AsyncStorage.setItem('baseUrl', otherTenant);
  act(() => { mockStore.dispatch(setBaseUrl(otherTenant)); });
  await act(async () => { await hook.refresh(); });
  await act(async () => { old.resolve(response(true)); await first.pending; });
  expect(mockStore.getState().user.baseUrl).toBe(otherTenant);
  expect(mockStore.getState().featureSettings.scope).toBe(buildSettingsScope(otherTenant, employeeCode));
  expect(hook.isEnabled('expense_claim')).toBe(false);
});

it('excludes a pending response when another employee takes over the same tenant', async () => {
  const old = deferred();
  getFeatureSettings.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(false));
  mount();
  const first = await startRefresh();
  await AsyncStorage.setItem('employee_code', 'EMP-OTHER-SYNTHETIC');
  act(() => { mockStore.dispatch(setEmployeeCode('EMP-OTHER-SYNTHETIC')); });
  await act(async () => { await hook.refresh(); });
  await act(async () => { old.resolve(response(true)); await first.pending; });
  expect(mockStore.getState().user.userDetails.employeeCode).toBe('EMP-OTHER-SYNTHETIC');
  expect(mockStore.getState().featureSettings.scope).toBe(buildSettingsScope(tenant, 'EMP-OTHER-SYNTHETIC'));
  expect(hook.isEnabled('expense_claim')).toBe(false);
});

it('hydrates the existing identity store for a QR password re-login after REVERT_ALL', async () => {
  mockStore = configureStore({ reducer: RootReducer, preloadedState: { userAuth: { isLoggedIn: true } } });
  getFeatureSettings.mockResolvedValueOnce(response(false));
  mount();
  expect(mockStore.getState().user.baseUrl).toBeNull();
  await act(async () => { await hook.refresh(); });
  expect(mockStore.getState().user).toMatchObject({ baseUrl: tenant, userDetails: { employeeCode } });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.health).toBe('loaded');
});

it('retains the last known denial and marks it stale when settings refresh fails', async () => {
  mockStore.dispatch(settingsReceived({ scope, settings: response(false).message }));
  getFeatureSettings.mockResolvedValueOnce({ error: 'Synthetic settings outage' });
  mount();
  await act(async () => { await hook.refresh(); });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.health).toBe('stale');
  expect(hook.status).toBe('error');
});

it('replaces a cached allow with explicit null and keeps the denial during an outage', async () => {
  mockStore.dispatch(settingsReceived({ scope, settings: response(true).message }));
  getFeatureSettings.mockResolvedValueOnce(response(null));
  mount();
  expect(hook.isEnabled('expense_claim')).toBe(true);
  await act(async () => { await hook.refresh(); });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  getFeatureSettings.mockResolvedValueOnce({ error: 'Synthetic settings outage' });
  await act(async () => { await hook.refresh(); });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.health).toBe('stale');
});

it('hydrates the persisted null-derived denial on a cold start without internet', async () => {
  mockStore.dispatch(settingsReceived({ scope, settings: response(null).message }));
  const persisted = JSON.parse(JSON.stringify(mockStore.getState()));
  mockStore = configureStore({ reducer: RootReducer, preloadedState: persisted });
  getFeatureSettings.mockResolvedValueOnce({ error: 'Synthetic cold-start settings outage' });
  mount();
  expect(hook.isEnabled('expense_claim')).toBe(false);
  await act(async () => { await hook.refresh(); });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(hook.health).toBe('stale');
});

it('keeps explicit null scoped to its tenant during switching and applies the new tenant null response', async () => {
  mockStore.dispatch(settingsReceived({ scope, settings: response(null).message }));
  mount();
  expect(hook.isEnabled('expense_claim')).toBe(false);
  await AsyncStorage.setItem('baseUrl', otherTenant);
  act(() => { mockStore.dispatch(setBaseUrl(otherTenant)); });
  expect(hook.isEnabled('expense_claim')).toBe(true);
  getFeatureSettings.mockResolvedValueOnce(response(null));
  await act(async () => { await hook.refresh(); });
  expect(hook.isEnabled('expense_claim')).toBe(false);
  expect(mockStore.getState().featureSettings.scope).toBe(buildSettingsScope(otherTenant, employeeCode));
});
