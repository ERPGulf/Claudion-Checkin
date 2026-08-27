import React from 'react';
import { render } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    Ionicons: stub,
    MaterialCommunityIcons: stub,
    AntDesign: stub,
    Octicons: stub,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  setOptions: jest.fn(),
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

// The service pulls in apiClient → expo-location, which this jest config does
// not transform. The transport is stubbed; normalization is tested directly.
const mockGet = jest.fn();
jest.mock('../services/api/apiClient', () => ({
  __esModule: true,
  default: { get: (...args) => mockGet(...args) },
}));

// The gate reads the store through useSelector; a settable fake keeps this a
// unit test of the guard rather than of redux wiring.
let mockFeatureState = { settings: null };
jest.mock('react-redux', () => ({
  useSelector: selector => selector({ featureSettings: mockFeatureState }),
}));

const mockAuthContext = jest.fn();
jest.mock('../services/api/authHelper', () => ({
  getAuthContext: (...args) => mockAuthContext(...args),
  buildHeaders: token => ({ Authorization: `Bearer ${token}` }),
}));

/* eslint-disable import/first */
import {
  ATTENDANCE_FEATURES,
  DEFAULT_WHEN_UNKNOWN,
  FEATURES,
  buildSettingsScope,
  emptyFeatureSettings,
  geoTaggingLevel,
  getFeatureValue,
  isFeatureEnabled,
  isRouteEnabled,
  normalizeBoolean,
  normalizeFeatureSettings,
} from '../utils/featureSettings';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import reducer, {
  settingsReceived,
  settingsFailed,
  settingsInvalidated,
  selectFeatureSettings,
  selectScopedFeatureSettings,
} from '../redux/Slices/FeatureSettingsSlice';
import {
  QUICK_ACCESS_OPTIONS,
  availableQuickAccessOptions,
  filterOfferedShortcuts,
} from '../utils/quickAccess';
import withFeatureGate from '../navigation/withFeatureGate';
/* eslint-enable import/first */

/** The example payload from the API contract. */
const FULL_RESPONSE = {
  attendance_action: {
    offline_attendance: true,
    offline_attendance_version: '1',
    photo_upload: true,
    restrict_location: true,
    unrestricted_checkout_location: true,
    employee_shift: false,
    geo_tagging: 'Enable geotagging for all attendance actions',
    employee_checkin_break: false,
    attendance_request: true,
    attendance_history: true,
  },
  loan_application: true,
  leave_request: true,
  employee_records: true,
  complaints: true,
};

/** Settings with everything explicitly on, then selectively switched off. */
const settingsWith = overrides => {
  const base = normalizeFeatureSettings(FULL_RESPONSE);
  return {
    ...base,
    ...overrides,
    attendance_action: {
      ...base.attendance_action,
      ...(overrides.attendance_action || {}),
    },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthContext.mockResolvedValue({
    baseUrl: 'https://tenant.example.com',
    token: 'REDACTED-TEST-TOKEN',
    employeeCode: 'EMP-001',
  });
});

/* =====================================================================
 * Normalization — the response is not uniformly boolean
 * ================================================================== */

describe('normalizeFeatureSettings', () => {
  it('reads the documented payload, preserving each type', () => {
    const s = normalizeFeatureSettings(FULL_RESPONSE);

    expect(s.loan_application).toBe(true);
    expect(s.leave_request).toBe(true);
    expect(s.employee_records).toBe(true);
    expect(s.complaints).toBe(true);

    expect(s.attendance_action.employee_shift).toBe(false);
    expect(s.attendance_action.employee_checkin_break).toBe(false);
    expect(s.attendance_action.attendance_history).toBe(true);

    // The two that are strings must stay strings, not be coerced to booleans.
    expect(s.attendance_action.offline_attendance_version).toBe('1');
    expect(s.attendance_action.geo_tagging).toBe(
      'Enable geotagging for all attendance actions',
    );
  });

  it('unwraps the Frappe { message } envelope', () => {
    const s = normalizeFeatureSettings({ message: FULL_RESPONSE });
    expect(s.loan_application).toBe(true);
  });

  it('survives null, a string, an array and nonsense', () => {
    for (const body of [null, undefined, '', 'nope', [], 42, { a: 1 }]) {
      const s = normalizeFeatureSettings(body);
      expect(s).toEqual(expect.objectContaining({ loan_application: null }));
      expect(s.attendance_action).toEqual(
        expect.objectContaining({ attendance_history: null }),
      );
    }
  });

  it('survives a missing attendance_action', () => {
    const s = normalizeFeatureSettings({ loan_application: false });

    expect(s.loan_application).toBe(false);
    expect(s.attendance_action.attendance_history).toBeNull();
    // And the nested block must still be an object, not undefined.
    expect(typeof s.attendance_action).toBe('object');
  });

  it('survives attendance_action being the wrong type', () => {
    const s = normalizeFeatureSettings({ attendance_action: 'yes' });
    expect(s.attendance_action.photo_upload).toBeNull();
  });

  it('leaves fields the server omitted as unknown, not as false', () => {
    // The distinction that keeps an older backend from losing every feature.
    const s = normalizeFeatureSettings({ loan_application: true });

    expect(s.loan_application).toBe(true);
    expect(s.complaints).toBeNull();
    expect(isFeatureEnabled(s, FEATURES.COMPLAINTS)).toBe(DEFAULT_WHEN_UNKNOWN);
  });
});

describe('normalizeBoolean', () => {
  it('accepts the shapes Frappe Check fields arrive in', () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean(1)).toBe(true);
    expect(normalizeBoolean('1')).toBe(true);
    expect(normalizeBoolean('true')).toBe(true);

    expect(normalizeBoolean(false)).toBe(false);
    expect(normalizeBoolean(0)).toBe(false);
    expect(normalizeBoolean('0')).toBe(false);
    expect(normalizeBoolean('false')).toBe(false);
  });

  it('reports anything unrecognisable as unknown rather than false', () => {
    // A typo in the payload must not silently disable a feature.
    expect(normalizeBoolean(undefined)).toBeNull();
    expect(normalizeBoolean(null)).toBeNull();
    expect(normalizeBoolean('maybe')).toBeNull();
    expect(normalizeBoolean({})).toBeNull();
  });
});

describe('geoTaggingLevel', () => {
  it('reads the select label into the 0/1/2 level the app already uses', () => {
    expect(geoTaggingLevel('Enable geotagging for all attendance actions')).toBe(2);
    expect(geoTaggingLevel('Warnings only')).toBe(1);
    expect(geoTaggingLevel('Disabled')).toBe(0);
  });

  it('returns null for a sentence it does not recognise', () => {
    // So callers fall back to the per-employee value rather than guessing.
    expect(geoTaggingLevel('something new')).toBeNull();
    expect(geoTaggingLevel(undefined)).toBeNull();
  });

  it('keeps the raw string available alongside the level', () => {
    const s = normalizeFeatureSettings(FULL_RESPONSE);

    expect(getFeatureValue(s, 'attendance_action.geo_tagging')).toBe(
      'Enable geotagging for all attendance actions',
    );
    expect(getFeatureValue(s, 'attendance_action.geo_tagging_level')).toBe(2);
    expect(
      getFeatureValue(s, 'attendance_action.offline_attendance_version'),
    ).toBe('1');
  });
});

/* =====================================================================
 * The helper every caller uses
 * ================================================================== */

describe('isFeatureEnabled', () => {
  it('honours an explicit true and an explicit false', () => {
    const on = settingsWith({ loan_application: true });
    const off = settingsWith({ loan_application: false });

    expect(isFeatureEnabled(on, FEATURES.LOAN_APPLICATION)).toBe(true);
    expect(isFeatureEnabled(off, FEATURES.LOAN_APPLICATION)).toBe(false);
  });

  it('resolves nested paths without the caller knowing the shape', () => {
    const on = settingsWith({ attendance_action: { attendance_history: true } });
    const off = settingsWith({
      attendance_action: { attendance_history: false },
    });

    expect(
      isFeatureEnabled(on, ATTENDANCE_FEATURES.ATTENDANCE_HISTORY),
    ).toBe(true);
    expect(
      isFeatureEnabled(off, ATTENDANCE_FEATURES.ATTENDANCE_HISTORY),
    ).toBe(false);
  });

  it('falls back to the documented default when nothing is known', () => {
    expect(isFeatureEnabled(null, FEATURES.LOAN_APPLICATION)).toBe(
      DEFAULT_WHEN_UNKNOWN,
    );
    expect(
      isFeatureEnabled(emptyFeatureSettings(), FEATURES.LOAN_APPLICATION),
    ).toBe(DEFAULT_WHEN_UNKNOWN);
  });

  it('does not hide a feature because of a typo in the path', () => {
    expect(isFeatureEnabled(settingsWith({}), 'loan_aplication')).toBe(
      DEFAULT_WHEN_UNKNOWN,
    );
  });
});

describe('isRouteEnabled', () => {
  it('maps each governed route to its flag', () => {
    const off = settingsWith({
      loan_application: false,
      leave_request: false,
      complaints: false,
      employee_records: false,
      attendance_action: { attendance_history: false, attendance_request: false },
    });

    expect(isRouteEnabled(off, 'Loan application')).toBe(false);
    expect(isRouteEnabled(off, 'Leave request')).toBe(false);
    expect(isRouteEnabled(off, 'Complaints')).toBe(false);
    expect(isRouteEnabled(off, 'Attendance history')).toBe(false);
    expect(isRouteEnabled(off, 'Attendance request')).toBe(false);
    expect(isRouteEnabled(off, 'Shortcut1')).toBe(false);
    expect(isRouteEnabled(off, 'Shortcut3')).toBe(false);
  });

  it('leaves ungoverned routes open', () => {
    const off = settingsWith({ loan_application: false });

    expect(isRouteEnabled(off, 'Attendance action')).toBe(true);
    expect(isRouteEnabled(off, 'Expense claim')).toBe(true);
    expect(isRouteEnabled(off, 'My QR Code')).toBe(true);
    expect(isRouteEnabled(off, 'homeTab')).toBe(true);
  });
});

/* =====================================================================
 * API
 * ================================================================== */

describe('getFeatureSettings', () => {
  it('calls the tenant it was provisioned with, using the session token', async () => {
    mockGet.mockResolvedValue({ data: FULL_RESPONSE });

    const res = await getFeatureSettings();

    const [url, config] = mockGet.mock.calls[0];
    expect(url).toBe(
      'https://tenant.example.com/api/method/employee_app.gauth.employee_checkin_setting',
    );
    // The token comes from the auth context, never from source.
    expect(config.headers.Authorization).toBe('Bearer REDACTED-TEST-TOKEN');
    expect(res.message.loan_application).toBe(true);
  });

  it('returns { error } rather than throwing when the request fails', async () => {
    mockGet.mockRejectedValue({ response: { status: 500 } });

    const res = await getFeatureSettings();

    expect(res.error).toBeTruthy();
    expect(res.message).toBeUndefined();
  });

  it('reports an expired session as an error, not as all-disabled', async () => {
    mockAuthContext.mockRejectedValue(new Error('Session expired'));

    const res = await getFeatureSettings();
    expect(res.error).toBeTruthy();
  });

  it('turns a malformed body into all-unknown, never all-disabled', async () => {
    mockGet.mockResolvedValue({ data: 'not json' });

    const res = await getFeatureSettings();

    expect(res.error).toBeUndefined();
    expect(res.message.loan_application).toBeNull();
    expect(isFeatureEnabled(res.message, FEATURES.LOAN_APPLICATION)).toBe(
      DEFAULT_WHEN_UNKNOWN,
    );
  });
});

/* =====================================================================
 * Store: caching, failure and tenant isolation
 * ================================================================== */

describe('FeatureSettingsSlice', () => {
  const scopeA = buildSettingsScope('https://a.example.com', 'EMP-1');
  const scopeB = buildSettingsScope('https://b.example.com', 'EMP-2');

  const stateWith = (settings, scope) =>
    reducer(undefined, settingsReceived({ settings, scope, now: 1000 }));

  it('stores settings against the scope they were fetched for', () => {
    const state = stateWith(settingsWith({ loan_application: false }), scopeA);

    expect(state.status).toBe('success');
    expect(state.scope).toBe(scopeA);
    expect(selectFeatureSettings({ featureSettings: state }).loan_application).toBe(
      false,
    );
  });

  it('keeps the last known settings when a refresh fails', () => {
    // The requirement that matters: a disabled feature must not reappear just
    // because the settings endpoint went down.
    const stored = stateWith(settingsWith({ loan_application: false }), scopeA);
    const failed = reducer(stored, settingsFailed({ error: 'Network Error' }));

    expect(failed.status).toBe('error');
    expect(failed.error).toBe('Network Error');
    expect(failed.settings.loan_application).toBe(false);
    expect(
      isFeatureEnabled(
        selectFeatureSettings({ featureSettings: failed }),
        FEATURES.LOAN_APPLICATION,
      ),
    ).toBe(false);
  });

  it('does not leak one tenant\'s settings into another', () => {
    const state = stateWith(settingsWith({ loan_application: false }), scopeA);

    expect(selectScopedFeatureSettings({ featureSettings: state }, scopeA)).not.toBeNull();
    // Same install, different backend: the stored answer must not apply.
    expect(selectScopedFeatureSettings({ featureSettings: state }, scopeB)).toBeNull();
  });

  it('does not leak one employee\'s settings into another', () => {
    const sameTenantOtherUser = buildSettingsScope(
      'https://a.example.com',
      'EMP-999',
    );
    const state = stateWith(settingsWith({ complaints: false }), scopeA);

    expect(
      selectScopedFeatureSettings({ featureSettings: state }, sameTenantOtherUser),
    ).toBeNull();
  });

  it('clears on logout (REVERT_ALL) and on explicit invalidation', () => {
    const state = stateWith(settingsWith({ loan_application: false }), scopeA);

    expect(reducer(state, { type: 'REVERT_ALL' }).settings).toBeNull();
    expect(reducer(state, settingsInvalidated()).settings).toBeNull();
  });

  it('ignores a trailing slash when comparing tenants', () => {
    expect(buildSettingsScope('https://a.example.com/', 'E')).toBe(
      buildSettingsScope('https://a.example.com', 'E'),
    );
  });
});

/* =====================================================================
 * Entry points: shortcuts and the picker
 * ================================================================== */

describe('quick access respects feature settings', () => {
  const loanPin = QUICK_ACCESS_OPTIONS.find(o => o.url === 'Loan application');

  it('drops a pinned shortcut whose feature is now off', () => {
    const off = settingsWith({ loan_application: false });

    expect(filterOfferedShortcuts([loanPin], off)).toEqual([]);
    // …and keeps it when the feature is on.
    expect(
      filterOfferedShortcuts([loanPin], settingsWith({ loan_application: true })),
    ).toHaveLength(1);
  });

  it('keeps its original behaviour when no settings are supplied', () => {
    expect(filterOfferedShortcuts([loanPin])).toHaveLength(1);
    expect(filterOfferedShortcuts(undefined)).toEqual([]);
  });

  it('stops a disabled feature being pinned back on from the picker', () => {
    const off = settingsWith({ loan_application: false, complaints: false });
    const urls = availableQuickAccessOptions(off).map(o => o.url);

    expect(urls).not.toContain('Loan application');
    expect(urls).not.toContain('Complaints');
    expect(urls).toContain('Expense claim');
  });

  it('leaves the catalogue itself untouched, so ids never shift', () => {
    const off = settingsWith({ loan_application: false });
    availableQuickAccessOptions(off);

    expect(QUICK_ACCESS_OPTIONS.some(o => o.url === 'Loan application')).toBe(
      true,
    );
  });
});

/* =====================================================================
 * Route protection
 * ================================================================== */

describe('withFeatureGate', () => {
  const { Text } = require('react-native');
  const Screen = () => <Text>LOAN SCREEN</Text>;

  const renderGated = settings => {
    mockFeatureState = { settings };
    const Gated = withFeatureGate('Loan application', Screen);
    return render(<Gated />);
  };

  afterEach(() => {
    mockFeatureState = { settings: null };
  });

  it('renders the screen when the feature is enabled', () => {
    const { getByText } = renderGated(settingsWith({ loan_application: true }));
    expect(getByText('LOAN SCREEN')).toBeTruthy();
  });

  it('refuses to mount the screen when the feature is disabled', () => {
    const { queryByText, getByText } = renderGated(
      settingsWith({ loan_application: false }),
    );

    // Not merely hidden — the screen component never renders, so its focus
    // effects and network calls do not run.
    expect(queryByText('LOAN SCREEN')).toBeNull();
    expect(getByText('Not available')).toBeTruthy();
  });

  it('renders the screen when settings are unknown', () => {
    const { getByText } = renderGated(null);
    expect(getByText('LOAN SCREEN')).toBeTruthy();
  });
});
