import React from 'react';
import { Switch } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});
jest.mock('@expo/vector-icons/Entypo', () => () => null);
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ setOptions: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('../hooks/useModernScreenHeader', () => ({ __esModule: true, default: () => {} }));
jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));
jest.mock('../modules/expo-auto-attendance', () => ({ isMonitoring: jest.fn(() => false) }));
jest.mock('expo-location', () => ({}));

let mockHook;
jest.mock('../hooks/useAutoAttendance', () => ({ __esModule: true, default: () => mockHook }));

/* eslint-disable import/first */
import AutoAttendance from '../screens/AutoAttendance';
import AutoAttendanceLegacy from '../screens/AutoAttendanceLegacy';
import { GEOTAGGING_LABELS } from '../redux/Slices/AutoAttendanceSlice';
import { describeAutoAttendanceStatus } from '../utils/autoAttendance';
/* eslint-enable import/first */

const hook = ({ configured = true, permitted = true, monitoring = 'active' } = {}) => {
  const status = describeAutoAttendanceStatus({ configured, permitted, monitoring });
  return {
    available: true, identifier: 'office-main', geotagging: 2, policy: GEOTAGGING_LABELS[2],
    allowed: true, configured, fullActions: true, status, active: status.key === 'active',
    monitoring: status.key === 'active', permissionGranted: permitted, lastEvent: null, eventLog: [],
    permissionError: null, reliabilityWarning: null, busy: false, presence: null, presenceLoading: false,
    latitudeText: '0', setLatitudeText: jest.fn(), longitudeText: '0', setLongitudeText: jest.fn(),
    radiusText: '100', setRadiusText: jest.fn(), refreshPresence: jest.fn(),
    handleGrantLocationAccess: jest.fn(), handleStart: jest.fn(), handleStop: jest.fn(),
    handleUseCurrentLocation: jest.fn(), handleClearStatus: jest.fn(),
    handleSimulatePolicy: jest.fn(), handleResetPolicy: jest.fn(),
  };
};

describe.each([
  ['modern', AutoAttendance],
  ['classic', AutoAttendanceLegacy],
])('%s Automatic Attendance screen', (_, Screen) => {
  it('has no employee switch, only the administrator-managed status', () => {
    mockHook = hook({ configured: false });
    const screen = render(<Screen />);

    expect(screen.UNSAFE_queryAllByType(Switch)).toHaveLength(0);
    expect(screen.getByText('Managed by your administrator.')).toBeTruthy();
    expect(screen.getAllByText('Disabled by administrator').length).toBeGreaterThan(0);
    expect(screen.queryByText('Grant location access')).toBeNull();
  });

  it('offers to grant location access while permission is missing', () => {
    mockHook = hook({ permitted: false, monitoring: 'permission' });
    const screen = render(<Screen />);

    expect(screen.getAllByText('Location permission required').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Grant location access'));
    expect(mockHook.handleGrantLocationAccess).toHaveBeenCalled();
  });

  it('shows Active without a grant action once monitoring is established', () => {
    mockHook = hook();
    const screen = render(<Screen />);

    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.queryByText('Grant location access')).toBeNull();
  });

  it('explains a registration that could not be established', () => {
    mockHook = hook({ monitoring: 'unavailable' });
    const screen = render(<Screen />);

    expect(screen.getAllByText('Monitoring unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText(/could not start/)).toBeTruthy();
  });
});
