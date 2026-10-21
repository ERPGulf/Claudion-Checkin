import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BOOLEAN_PATHS,
  buildSettingsScope,
  featureSettingsHealth,
  normalizeFeatureSettings,
} from '../utils/featureSettings';
import reducer, {
  settingsRequested,
  settingsReceived,
  settingsFailed,
  settingsInvalidated,
  selectFeatureSettings,
} from '../redux/Slices/FeatureSettingsSlice';
import {
  assertCapability,
  assertCapabilityCurrent,
  getCapabilitySnapshot,
} from '../services/capabilityPolicy';
import { invalidateAuthSession, activateAuthSession, getAuthSessionGeneration } from '../utils/authSessionGuard';
import { store } from '../redux/Store';

let mockRootState;
jest.mock('../redux/Store', () => ({ store: { getState: () => mockRootState } }));

const tenant = 'https://alpha.example.test';
const scope = buildSettingsScope(tenant, 'EMP-SYNTHETIC');
const wireFlag = (path, value) => path.startsWith('attendance_action.')
  ? { attendance_action: { [path.split('.')[1]]: value } }
  : { [path]: value };
const install = (wire, owner = scope) => {
  mockRootState = {
    user: { baseUrl: tenant, userDetails: { employeeCode: 'EMP-SYNTHETIC' } },
    userAuth: { isLoggedIn: true },
    featureSettings: reducer(undefined, settingsReceived({ settings: normalizeFeatureSettings(wire), scope: owner, now: Date.now() })),
  };
};

beforeEach(async () => {
  activateAuthSession(getAuthSessionGeneration());
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([['baseUrl', tenant], ['employee_code', 'EMP-SYNTHETIC']]);
  install({});
});

describe('every Boolean capability at the execution boundary', () => {
  it.each([false, 0, null])('synchronously rejects tenant geo %p received after an automatic ownership read', async geo => {
    install({ attendance_action: { auto_attendance: true, geo_tagging: 2 } });
    const owner = await assertCapability('attendance_action.auto_attendance');
    install({ attendance_action: { auto_attendance: true, geo_tagging: geo } });
    expect(() => assertCapabilityCurrent('attendance_action.auto_attendance', owner))
      .toThrow(expect.objectContaining({ code: 'FEATURE_DISABLED', feature: 'attendance_action.auto_attendance' }));
    await expect(assertCapability('attendance_action.auto_attendance')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('checks authentication generation again at the final synchronous boundary', async () => {
    const owner = await assertCapability('attendance_action.auto_attendance');
    invalidateAuthSession();
    expect(() => assertCapabilityCurrent('attendance_action.auto_attendance', owner))
      .toThrow(expect.objectContaining({ code: 'CAPABILITY_SCOPE_CHANGED' }));
  });

  it.each(BOOLEAN_PATHS)('%s refuses false and preserves enabled behavior', async path => {
    install(wireFlag(path, false));
    await expect(assertCapability(path)).rejects.toMatchObject({ code: 'FEATURE_DISABLED', retryable: false });
    install(wireFlag(path, true));
    await expect(assertCapability(path)).resolves.toMatchObject({ scope, state: 'loaded' });
  });

  it('applies cached explicit denials on restored sessions and failed refreshes', async () => {
    install({ expense_claim: false });
    mockRootState.featureSettings = reducer(mockRootState.featureSettings, settingsFailed({ error: 'outage' }));
    await expect(getCapabilitySnapshot()).resolves.toMatchObject({ state: 'stale' });
    await expect(assertCapability('expense_claim')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('does not apply cached permissions or denials to another tenant or employee', async () => {
    install({ expense_claim: false });
    await AsyncStorage.setItem('baseUrl', 'https://beta.example.test');
    expect((await getCapabilitySnapshot()).settings).toBeNull();
    expect(selectFeatureSettings({ ...mockRootState, user: { ...mockRootState.user, baseUrl: 'https://beta.example.test' } })).toBeNull();
    await AsyncStorage.setItem('baseUrl', tenant);
    await AsyncStorage.setItem('employee_code', 'EMP-OTHER');
    expect((await getCapabilitySnapshot()).settings).toBeNull();
  });

  it('stops an old operation after tenant change or same-account reauthentication', async () => {
    const owner = await assertCapability('expense_claim');
    await AsyncStorage.setItem('baseUrl', 'https://beta.example.test');
    await expect(assertCapability('expense_claim', owner)).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_CHANGED' });
    await AsyncStorage.setItem('baseUrl', tenant);
    invalidateAuthSession();
    await expect(assertCapability('expense_claim', owner)).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_CHANGED' });
  });

  it('refuses a new retained callback during logout cleanup before storage is cleared', async () => {
    invalidateAuthSession();
    await expect(assertCapability('expense_claim')).rejects.toMatchObject({ code: 'CAPABILITY_SCOPE_CHANGED' });
  });

  it('rechecks a denial received while persisted identity is being read', async () => {
    install({ expense_claim: true });
    let release;
    const heldRead = new Promise(resolve => { release = resolve; });
    AsyncStorage.getItem.mockImplementationOnce(() => heldRead);
    const operation = assertCapability('expense_claim');
    install({ expense_claim: false });
    release(tenant);
    await expect(operation).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('does not carry a stale allow across the snapshot promise continuation', async () => {
    install({ expense_claim: true });
    const read = jest.spyOn(store, 'getState').mockImplementationOnce(() => {
      Promise.resolve().then(() => install({ expense_claim: false }));
      return mockRootState;
    });
    try {
      await expect(assertCapability('expense_claim')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    } finally { read.mockRestore(); }
  });

  it('keeps unknown-field legacy compatibility explicit', async () => {
    expect((await getCapabilitySnapshot()).settings).not.toBeNull();
    await expect(assertCapability('expense_claim')).resolves.toBeTruthy();
    mockRootState.featureSettings = reducer(undefined, { type: 'init' });
    expect((await getCapabilitySnapshot()).state).toBe('unavailable');
    await expect(assertCapability('expense_claim')).resolves.toBeTruthy();
  });
});

describe('settings lifecycle and response races', () => {
  it('rejects responses and failures superseded by a newer request', () => {
    let state = reducer(undefined, settingsRequested({ scope, requestId: 'old' }));
    state = reducer(state, settingsRequested({ scope, requestId: 'new' }));
    state = reducer(state, settingsReceived({ scope, requestId: 'new', settings: normalizeFeatureSettings({ complaints: false }) }));
    state = reducer(state, settingsReceived({ scope, requestId: 'old', settings: normalizeFeatureSettings({ complaints: true }) }));
    state = reducer(state, settingsFailed({ requestId: 'old', error: 'late outage' }));
    expect(state.settings.complaints).toBe(false);
    expect(state.status).toBe('success');
  });

  it('does not resurrect settings after logout/invalidation', () => {
    let state = reducer(undefined, settingsRequested({ scope, requestId: 'old' }));
    state = reducer(state, settingsInvalidated());
    state = reducer(state, settingsReceived({ scope, requestId: 'old', settings: normalizeFeatureSettings({ complaints: true }) }));
    expect(state.settings).toBeNull();
    install({ complaints: true });
    mockRootState.userAuth.isLoggedIn = false;
    expect(selectFeatureSettings(mockRootState)).toBeNull();
  });

  it('preserves known restrictions across partial refreshes but accepts an explicit reenable', () => {
    install({ complaints: false, leave_request: false });
    let state = reducer(mockRootState.featureSettings, settingsReceived({ scope, settings: normalizeFeatureSettings({ leave_request: true }) }));
    expect(state.settings.complaints).toBe(false);
    expect(state.settings.leave_request).toBe(true);
    state = reducer(state, settingsReceived({ scope: 'other', settings: normalizeFeatureSettings({ leave_request: true }) }));
    expect(state.settings.complaints).toBeNull();
  });

  it('exposes loading, loaded, stale and unavailable without erasing cached rules', () => {
    expect(featureSettingsHealth({ status: 'loading', settings: null })).toBe('loading');
    expect(featureSettingsHealth({ status: 'idle', settings: null })).toBe('unavailable');
    expect(featureSettingsHealth({ status: 'success', settings: {}, lastFetchedAt: 100 }, 101)).toBe('loaded');
    expect(featureSettingsHealth({ status: 'success', settings: {}, lastFetchedAt: 100 }, 1800100)).toBe('stale');
    expect(featureSettingsHealth({ status: 'error', settings: {}, lastFetchedAt: 100 }, 101)).toBe('stale');
  });
});
