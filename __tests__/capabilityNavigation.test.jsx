import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render } from '@testing-library/react-native';
import featureSettingsReducer, { settingsReceived } from '../redux/Slices/FeatureSettingsSlice';
import quickAccessReducer from '../redux/Slices/QuickAccessSlice';
import { buildSettingsScope, normalizeFeatureSettings, ROUTE_FEATURES } from '../utils/featureSettings';
import { QUICK_ACCESS_OPTIONS } from '../utils/quickAccess';
import AppNavigator from '../navigation/app-navigator';
import LegacyQuickAccess from '../components/HomeLegacy/QuickAccess';
import LegacyPicker from '../screens/SelectQuickAccessLegacy';

let mockRoute = 'Loan application';
let mockModern = true;
const mockMount = jest.fn();
const mockNavigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  return { createNativeStackNavigator: () => ({
    Navigator: ({ children }) => <>{children}</>,
    Screen: ({ name, component: Screen }) => name === mockRoute ? <Screen /> : null,
  }) };
});
jest.mock('../navigation/home.tabbar', () => () => null);
jest.mock('../screens/ComingSoon', () => () => null);
jest.mock('../hooks/useHomeExperience', () => () => ({ enabled: mockModern, hydrated: true }));
jest.mock('../screens', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const names = ['AttendanceAction', 'AttendanceActionLegacy', 'AttendanceCamera',
    'AttendanceHistory', 'AttendanceHistoryLegacy', 'AttendanceRequest', 'AttendanceRequestLegacy',
    'Notifications', 'NotificationsLegacy', 'SelectQuickAccess', 'SelectQuickAccessLegacy',
    'LeaveRequest', 'LeaveRequestLegacy', 'Complaints', 'ComplaintsLegacy', 'ExpenseClaim',
    'ExpenseClaimLegacy', 'Shortcut1', 'Shortcut2', 'Shortcut3', 'MyQrCode', 'MyQrCodeLegacy',
    'LoanApplication', 'LoanApplicationLegacy', 'AutoAttendanceScreen', 'AutoAttendanceLegacy',
    'Resignation', 'ResignationLegacy'];
  return Object.fromEntries(names.map(name => [name, () => {
    mockMount(name);
    return <Text>{`feature:${name}`}</Text>;
  }]));
});
jest.mock('../components/SelectQuickAccess/ButtonItem', () => {
  const { Text } = require('react-native');
  return ({ text1, text2 }) => <Text>{`${text1} ${text2 || ''}`.trim()}</Text>;
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: ({ children }) => <View>{children}</View>, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
});
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: Icon, Entypo: Icon, AntDesign: Icon, FontAwesome: Icon };
});
jest.mock('@expo/vector-icons/Entypo', () => () => null);

const tenant = 'https://capabilities.example.com';
const employeeCode = 'EMP-SYNTHETIC';
const scope = buildSettingsScope(tenant, employeeCode);
const settingsFor = (path, enabled) => normalizeFeatureSettings(path.startsWith('attendance_action.')
  ? { attendance_action: { [path.split('.')[1]]: enabled } }
  : { [path]: enabled });
const makeStore = (settings) => configureStore({ reducer: {
  featureSettings: featureSettingsReducer,
  quickAccess: quickAccessReducer,
  user: (state = { baseUrl: tenant, userDetails: { employeeCode } }) => state,
  userAuth: (state = { isLoggedIn: true }) => state,
}, preloadedState: {
  featureSettings: { settings, scope, status: 'success', lastFetchedAt: Date.now() },
  quickAccess: { activeButtons: QUICK_ACCESS_OPTIONS },
} });
const mount = (store, Component = AppNavigator) => render(<Provider store={store}><Component /></Provider>);
afterEach(() => { cleanup(); mockMount.mockClear(); });

describe.each([true, false])('feature routes with modern presentation %s', modern => {
  beforeEach(() => { mockModern = modern; });
  it.each(Object.entries(ROUTE_FEATURES))('guards the registered %s route and reacts while open', (route, path) => {
    mockRoute = route;
    const store = makeStore(settingsFor(path, true));
    const screen = mount(store);
    expect(mockMount).toHaveBeenCalled();
    act(() => { store.dispatch(settingsReceived({ settings: settingsFor(path, false), scope })); });
    expect(screen.getByText('Not available')).toBeTruthy();
    mockMount.mockClear();
    screen.unmount();
    const direct = mount(store);
    expect(direct.getByText('Not available')).toBeTruthy();
    expect(mockMount).not.toHaveBeenCalled();
  });
});

describe('classic quick access visibility', () => {
  const disabledHistory = settingsFor('attendance_action.attendance_history', false);
  it('hides persisted disabled pins and updates when the setting changes', () => {
    const store = makeStore(disabledHistory);
    const screen = mount(store, LegacyQuickAccess);
    expect(screen.queryByText('Attendance history')).toBeNull();
    expect(screen.getByText('Attendance action')).toBeTruthy();
    act(() => { store.dispatch(settingsReceived({ settings: settingsFor('attendance_action.attendance_history', true), scope })); });
    expect(screen.getByText('Attendance history')).toBeTruthy();
  });
  it('hides disabled options from the classic picker', () => {
    const screen = mount(makeStore(disabledHistory), LegacyPicker);
    expect(screen.queryByText('Attendance history')).toBeNull();
    expect(screen.getByText('Attendance action')).toBeTruthy();
  });
});
