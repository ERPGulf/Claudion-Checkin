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
  BOOLEAN_PATHS,
  DEFAULT_WHEN_UNKNOWN,
  FEATURES,
  buildSettingsScope,
  emptyFeatureSettings,
  getFeatureValue,
  isFeatureEnabled,
  isRouteEnabled,
  normalizeBoolean,
  normalizeFeatureSettings,
  mergeFeatureSettings,
  hasRecognizedFeatureSettings,
} from '../utils/featureSettings';
import { getFeatureSettings } from '../services/api/featureSettings.service';
import reducer, {
  settingsReceived,
  settingsRequested,
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
// The two Home grids, imported so the "hidden everywhere" claim is checked
// against the real menus rather than a copy of them. The quick-access lists are
// already imported above.
import { HR_FEATURES } from '../components/Home/YourLavas';
import { LEGACY_HR_FEATURES } from '../components/HomeLegacy/YourLavas';
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
    geo_tagging: true,
    employee_checkin_break: false,
    attendance_request: true,
    attendance_history: true,
  },
  loan_application: true,
  leave_request: true,
  employee_records: true,
  complaints: true,
  employee_resignation: true,
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
    expect(s.employee_resignation).toBe(true);

    expect(s.attendance_action.employee_shift).toBe(false);
    expect(s.attendance_action.employee_checkin_break).toBe(false);
    expect(s.attendance_action.attendance_history).toBe(true);

    // The version stays a string, never coerced to a boolean.
    expect(s.attendance_action.offline_attendance_version).toBe('1');
    expect(getFeatureValue(s, 'attendance_action.offline_attendance_version')).toBe('1');
    expect(s.attendance_action.geo_tagging).toBe(true);
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

describe('tenant geo_tagging is the automatic attendance switch', () => {
  const tenant = geo => normalizeFeatureSettings({ attendance_action: { geo_tagging: geo } });
  const automatic = settings => isFeatureEnabled(settings, ATTENDANCE_FEATURES.AUTO_ATTENDANCE);

  it('enables automatic attendance and its screen only for a real boolean true', () => {
    expect(automatic(tenant(true))).toBe(true);
    expect(isRouteEnabled(tenant(true), 'Auto attendance')).toBe(true);
  });

  it.each([false, null, undefined, 0, 1, 2, 'true', 'false', {}])('keeps it off for tenant geo_tagging %p', geo => {
    expect(automatic(tenant(geo))).toBe(false);
    expect(isRouteEnabled(tenant(geo), 'Auto attendance')).toBe(false);
    // Only automatic attendance: the rest keeps its own answer.
    expect(isRouteEnabled(tenant(geo), 'Attendance action')).toBe(true);
    expect(isFeatureEnabled(tenant(geo), ATTENDANCE_FEATURES.PHOTO_UPLOAD)).toBe(DEFAULT_WHEN_UNKNOWN);
  });

  it('stays off before any settings arrive', () => {
    expect(automatic(null)).toBe(false);
    expect(automatic(emptyFeatureSettings())).toBe(false);
  });

  it('lets a fresh true replace a cached false, and a fresh false a cached true', () => {
    expect(automatic(mergeFeatureSettings(tenant(false), tenant(true)))).toBe(true);
    expect(automatic(mergeFeatureSettings(tenant(true), tenant(false)))).toBe(false);
    expect(automatic(mergeFeatureSettings(tenant(true), tenant(null)))).toBe(false);
  });

  it('never carries a cached true into a fresh answer that omits or garbles it', () => {
    for (const fresh of [{ photo_upload: true }, { geo_tagging: 2 }, { geo_tagging: 'true' }]) {
      const merged = mergeFeatureSettings(tenant(true), normalizeFeatureSettings({ attendance_action: fresh }));
      expect(automatic(merged)).toBe(false);
    }
  });

  it('ignores a stale auto_attendance or numeric level persisted by an older build', () => {
    const cached = JSON.parse(JSON.stringify({
      ...tenant(false),
      attendance_action: { ...tenant(false).attendance_action, auto_attendance: true, geo_tagging_level: 2 },
    }));
    expect(automatic(cached)).toBe(false);
    expect(automatic({ attendance_action: { auto_attendance: true, geo_tagging: '2', geo_tagging_level: 2 } })).toBe(false);
    expect(automatic(mergeFeatureSettings(cached, tenant(true)))).toBe(true);
  });

  it('keeps an explicit answer through JSON cache hydration, as during an outage', () => {
    expect(automatic(JSON.parse(JSON.stringify(tenant(true))))).toBe(true);
    expect(automatic(JSON.parse(JSON.stringify(tenant(false))))).toBe(false);
  });

  it('reads the response the backend team shared', () => {
    const shared = {
      attendance_action: {
        offline_attendance: true, photo_upload: true, restrict_location: true,
        unrestricted_checkout_location: true, employee_shift: true, geo_tagging: false,
        employee_checkin_break: true, attendance_request: true, attendance_history: true,
      },
      loan_application: true, expense_claim: true, leave_request: true,
      employee_records: true, complaints: true, employee_resignation: false,
    };
    expect(hasRecognizedFeatureSettings(shared)).toBe(true);
    expect(automatic(normalizeFeatureSettings(shared))).toBe(false);
    expect(automatic(normalizeFeatureSettings({
      ...shared, attendance_action: { ...shared.attendance_action, geo_tagging: true },
    }))).toBe(true);
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
    expect(normalizeBoolean('maybe')).toBeNull();
    expect(normalizeBoolean({})).toBeNull();
  });

  it('treats explicit backend null as disabled, distinct from an omitted value', () => {
    expect(normalizeBoolean(null)).toBe(false);
    expect(normalizeBoolean(undefined)).toBeNull();
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
      employee_resignation: false,
      attendance_action: { attendance_history: false, attendance_request: false },
    });

    expect(isRouteEnabled(off, 'Resignation')).toBe(false);

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

  it('reports malformed success so known restrictions survive the refresh', async () => {
    mockGet.mockResolvedValue({ data: 'not json' });

    const res = await getFeatureSettings();

    expect(res.error).toBeTruthy();
    expect(res.message).toBeUndefined();
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

/**
 * The payload the backend sends today: `geo_tagging` is the tenant's boolean
 * automatic-attendance switch, and there is no separate `auto_attendance`.
 */
describe('the current capability payload', () => {
  const CURRENT = {
    attendance_action: {
      offline_attendance: false,
      offline_attendance_version: '1',
      photo_upload: true,
      restrict_location: true,
      unrestricted_checkout_location: true,
      employee_shift: false,
      geo_tagging: true,
      employee_checkin_break: false,
      attendance_request: true,
      attendance_history: true,
    },
    loan_application: true,
    expense_claim: true,
    leave_request: true,
    employee_records: true,
    complaints: true,
  };

  it('reads every boolean, including geo_tagging and expense_claim', () => {
    const s = normalizeFeatureSettings(CURRENT);

    expect(s.attendance_action.geo_tagging).toBe(true);
    expect(s.attendance_action.offline_attendance).toBe(false);
    expect(s.attendance_action.photo_upload).toBe(true);
    expect(s.attendance_action.employee_shift).toBe(false);
    expect(s.expense_claim).toBe(true);
    expect(s.complaints).toBe(true);
    expect(s.loan_application).toBe(true);
  });

  it('gates the Expense claim route on the new flag', () => {
    expect(isRouteEnabled(normalizeFeatureSettings(CURRENT), 'Expense claim'))
      .toBe(true);

    const off = normalizeFeatureSettings({ expense_claim: false });
    expect(isRouteEnabled(off, 'Expense claim')).toBe(false);
  });

  // Expense claim was an ungated route until this payload carried a flag for
  // it, so a tenant that has not upgraded must keep it.
  it('leaves Expense claim available when the server does not mention it', () => {
    expect(isRouteEnabled(normalizeFeatureSettings({}), 'Expense claim')).toBe(
      true,
    );
  });

  it('keeps offline_attendance_version', () => {
    expect(
      normalizeFeatureSettings(CURRENT).attendance_action
        .offline_attendance_version,
    ).toBe('1');
  });

  it('gates the Auto attendance route on the new flag', () => {
    const s = normalizeFeatureSettings(CURRENT);
    expect(isRouteEnabled(s, 'Auto attendance')).toBe(true);

    const off = normalizeFeatureSettings({
      attendance_action: { geo_tagging: false },
    });
    expect(isRouteEnabled(off, 'Auto attendance')).toBe(false);
  });

  /**
   * `geo_tagging: false` means "take it out of the menu".
   *
   * There are four places the option can appear, and they all filter through
   * `isRouteEnabled`, so one ROUTE_FEATURES entry covers them — but "covers
   * them" is the kind of claim that should be checked rather than reasoned
   * about, because a surface that ever stopped filtering would leave a tile
   * pointing at a screen that refuses to open.
   */
  describe('hides the option everywhere it is offered', () => {
    const off = normalizeFeatureSettings({
      attendance_action: { geo_tagging: false },
    });

    const autoTile = (item) => item.nav === 'Auto attendance';
    const autoOption = (option) => option.url === 'Auto attendance';

    const expenseOff = normalizeFeatureSettings({
      expense_claim: false,
      attendance_action: { geo_tagging: true },
    });
    const expenseTile = (item) => item.nav === 'Expense claim';
    const expenseOption = (option) => option.url === 'Expense claim';

    it('drops the tile from the Home grid', () => {
      expect(HR_FEATURES.some(autoTile)).toBe(true);
      expect(
        HR_FEATURES.filter((item) => isRouteEnabled(off, item.nav)).some(autoTile),
      ).toBe(false);
    });

    it('drops the tile from the classic Home grid', () => {
      expect(
        LEGACY_HR_FEATURES.filter((item) => isRouteEnabled(off, item.nav)).some(
          autoTile,
        ),
      ).toBe(false);
    });

    it('drops it from the quick-access picker', () => {
      expect(QUICK_ACCESS_OPTIONS.some(autoOption)).toBe(true);
      expect(availableQuickAccessOptions(off).some(autoOption)).toBe(false);
    });

    // A pin saved while the feature was on would otherwise sit on Home
    // navigating to a screen the gate now refuses.
    it('drops an already-pinned shortcut', () => {
      const pinned = QUICK_ACCESS_OPTIONS.filter(autoOption);
      expect(pinned).toHaveLength(1);
      expect(filterOfferedShortcuts(pinned, off)).toEqual([]);
    });

    it('hides Expense claim from every surface too', () => {
      const pinned = QUICK_ACCESS_OPTIONS.filter(expenseOption);
      expect(pinned).toHaveLength(1);

      expect(
        HR_FEATURES.filter((i) => isRouteEnabled(expenseOff, i.nav)).some(
          expenseTile,
        ),
      ).toBe(false);
      expect(
        LEGACY_HR_FEATURES.filter((i) => isRouteEnabled(expenseOff, i.nav)).some(
          expenseTile,
        ),
      ).toBe(false);
      expect(availableQuickAccessOptions(expenseOff).some(expenseOption)).toBe(
        false,
      );
      expect(filterOfferedShortcuts(pinned, expenseOff)).toEqual([]);
    });

    // Turning one feature off must not take its neighbours with it.
    it('leaves the other options alone', () => {
      expect(
        HR_FEATURES.filter((i) => isRouteEnabled(expenseOff, i.nav)).some(
          autoTile,
        ),
      ).toBe(true);
      expect(
        HR_FEATURES.filter((i) => isRouteEnabled(off, i.nav)).some(expenseTile),
      ).toBe(true);
    });

    it('keeps all four when the flag is on', () => {
      const on = normalizeFeatureSettings(CURRENT);
      const pinned = QUICK_ACCESS_OPTIONS.filter(autoOption);

      expect(HR_FEATURES.filter((i) => isRouteEnabled(on, i.nav)).some(autoTile)).toBe(true);
      expect(
        LEGACY_HR_FEATURES.filter((i) => isRouteEnabled(on, i.nav)).some(autoTile),
      ).toBe(true);
      expect(availableQuickAccessOptions(on).some(autoOption)).toBe(true);
      expect(filterOfferedShortcuts(pinned, on)).toHaveLength(1);
    });
  });

  // Background location is never on by default: no answer, no screen.
  it('hides Auto attendance when the server does not mention geo_tagging', () => {
    expect(isRouteEnabled(normalizeFeatureSettings({}), 'Auto attendance')).toBe(
      false,
    );
  });
});

describe('confirmed explicit-null capability contract', () => {
  const payloadFor = (path, value) => path.startsWith('attendance_action.')
    ? { attendance_action: { [path.slice('attendance_action.'.length)]: value } }
    : { [path]: value };

  it.each(BOOLEAN_PATHS)('disables %s and supersedes a cached allow', path => {
    const previous = normalizeFeatureSettings(payloadFor(path, true));
    const next = normalizeFeatureSettings(payloadFor(path, null));
    expect(isFeatureEnabled(next, path)).toBe(false);
    expect(isFeatureEnabled(mergeFeatureSettings(previous, next), path)).toBe(false);
    expect(hasRecognizedFeatureSettings(payloadFor(path, null))).toBe(true);
    const hydrated = JSON.parse(JSON.stringify(mergeFeatureSettings(previous, next)));
    expect(isFeatureEnabled(hydrated, path)).toBe(false);
  });

  it('preserves missing and malformed compatibility without reinterpreting old persisted unknowns', () => {
    const previous = normalizeFeatureSettings({ expense_claim: true, leave_request: false });
    const partial = normalizeFeatureSettings({ expense_claim: 'unexpected', complaints: null });
    const merged = mergeFeatureSettings(previous, partial);
    expect(isFeatureEnabled(merged, FEATURES.EXPENSE_CLAIM)).toBe(true);
    expect(isFeatureEnabled(merged, FEATURES.LEAVE_REQUEST)).toBe(false);
    expect(isFeatureEnabled(merged, FEATURES.COMPLAINTS)).toBe(false);
    expect(isFeatureEnabled(JSON.parse(JSON.stringify(emptyFeatureSettings())), FEATURES.COMPLAINTS))
      .toBe(DEFAULT_WHEN_UNKNOWN);
    expect(hasRecognizedFeatureSettings({ attendance_action: null })).toBe(false);
    expect(hasRecognizedFeatureSettings({ complaints: 'unexpected' })).toBe(false);
  });

  it('clears an explicitly null version as metadata without granting or denying offline permission', () => {
    const previous = normalizeFeatureSettings({ attendance_action: {
      offline_attendance: true, offline_attendance_version: '1',
    } });
    const next = normalizeFeatureSettings({ attendance_action: { offline_attendance_version: null } });
    const merged = mergeFeatureSettings(previous, next);
    expect(merged.attendance_action.offline_attendance_version).toBeNull();
    expect(isFeatureEnabled(merged, ATTENDANCE_FEATURES.OFFLINE_ATTENDANCE)).toBe(true);
    expect(BOOLEAN_PATHS).not.toContain('attendance_action.offline_attendance_version');
    expect(hasRecognizedFeatureSettings({ attendance_action: { offline_attendance_version: null } })).toBe(true);
    expect(mergeFeatureSettings(previous, normalizeFeatureSettings({ complaints: false }))
      .attendance_action.offline_attendance_version).toBe('1');
    expect(mergeFeatureSettings(previous, normalizeFeatureSettings({ attendance_action: {
      offline_attendance_version: {},
    } })).attendance_action.offline_attendance_version).toBe('1');
    const updated = mergeFeatureSettings(merged, normalizeFeatureSettings({ attendance_action: {
      offline_attendance_version: '2',
    } }));
    expect(updated.attendance_action.offline_attendance_version).toBe('2');
    expect(updated._explicitNullFields).toBeUndefined();
  });

  it('keeps null revocation through reducer hydration and rejects an older response', () => {
    const scope = buildSettingsScope('https://null-alpha.example.test', 'EMP-NULL');
    let state = reducer(undefined, settingsReceived({
      scope, settings: normalizeFeatureSettings({ expense_claim: true }),
    }));
    state = reducer(state, settingsRequested({ scope, requestId: 'older' }));
    state = reducer(state, settingsRequested({ scope, requestId: 'latest' }));
    state = reducer(state, settingsReceived({
      scope, requestId: 'latest', settings: normalizeFeatureSettings({ expense_claim: null }),
    }));
    state = reducer(state, settingsReceived({
      scope, requestId: 'older', settings: normalizeFeatureSettings({ expense_claim: true }),
    }));
    const hydrated = JSON.parse(JSON.stringify(state));
    expect(isFeatureEnabled(selectScopedFeatureSettings({ featureSettings: hydrated }, scope), FEATURES.EXPENSE_CLAIM)).toBe(false);
    const otherScope = buildSettingsScope('https://null-beta.example.test', 'EMP-NULL');
    expect(selectScopedFeatureSettings({ featureSettings: hydrated }, otherScope)).toBeNull();
    state = reducer(hydrated, settingsReceived({
      scope: otherScope, settings: normalizeFeatureSettings({ expense_claim: null }),
    }));
    expect(isFeatureEnabled(selectScopedFeatureSettings({ featureSettings: state }, otherScope), FEATURES.EXPENSE_CLAIM)).toBe(false);
  });
});
