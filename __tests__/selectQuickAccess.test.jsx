import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return {
    Ionicons: stub,
    MaterialCommunityIcons: stub,
    AntDesign: stub,
    Octicons: stub,
    FontAwesome: stub,
  };
});

const mockNavigation = { setOptions: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

/* eslint-disable import/first */
import SelectQuickAccess, {
  QUICK_ACCESS_OPTIONS,
} from '../screens/SelectQuickAccess';
import quickAccessReducer from '../redux/Slices/QuickAccessSlice';
/* eslint-enable import/first */

/** Real reducer, not a mock store — the point is that add/remove still work. */
function renderScreen(activeButtons = []) {
  const store = configureStore({
    reducer: { quickAccess: quickAccessReducer },
    preloadedState: { quickAccess: { activeButtons } },
  });

  return { store, ...render(<SelectQuickAccess />, { wrapper: ({ children }) => (
    <Provider store={store}>{children}</Provider>
  ) }) };
}

const ATTENDANCE_ACTION = {
  id: 1,
  iconName: 'calendar-outline',
  text1: 'Attendance',
  text2: 'action',
  url: 'Attendance action',
};

describe('SelectQuickAccess (modern)', () => {
  beforeEach(() => {
    mockNavigation.setOptions.mockClear();
  });

  it('renders a tile for every option', () => {
    const { getByText } = renderScreen();

    QUICK_ACCESS_OPTIONS.forEach(option => {
      const label = `${option.text1} ${option.text2 || ''}`.trim();
      expect(getByText(label)).toBeTruthy();
    });
  });

  it('offers more than the original two', () => {
    const { getByText } = renderScreen();

    // The ones that always existed...
    expect(getByText('Attendance action')).toBeTruthy();
    expect(getByText('Attendance history')).toBeTruthy();
    // ...plus the ones added for the modern picker.
    ['Attendance request', 'Automatic attendance', 'Leave request',
      'Expense claim', 'Loan application', 'Complaints', 'Vacation list',
      'My QR'].forEach(label => expect(getByText(label)).toBeTruthy());
  });

  it('no longer offers Salary advance or Trip details', () => {
    const { queryByText } = renderScreen();

    expect(queryByText('Salary advance')).toBeNull();
    expect(queryByText('Trip details')).toBeNull();

    const urls = QUICK_ACCESS_OPTIONS.map(o => o.url);
    expect(urls).not.toContain('Salary advance');
    // Trip details had no registered screen, so pinning it and tapping it threw.
    expect(urls).not.toContain('Trip details');
  });

  it('reports how many are pinned', () => {
    const { getByText } = renderScreen([ATTENDANCE_ACTION]);

    expect(
      getByText(
        `1 of ${QUICK_ACCESS_OPTIONS.length} pinned to your Home screen`,
      ),
    ).toBeTruthy();
  });

  it('pins an unpinned shortcut', () => {
    const { store, getByText } = renderScreen();

    fireEvent.press(getByText('Loan application'));

    expect(store.getState().quickAccess.activeButtons).toHaveLength(1);
    expect(store.getState().quickAccess.activeButtons[0].id).toBe(15);
  });

  it('unpins an already pinned shortcut', () => {
    const { store, getByText } = renderScreen([ATTENDANCE_ACTION]);

    fireEvent.press(getByText('Attendance action'));

    expect(store.getState().quickAccess.activeButtons).toHaveLength(0);
  });

  it('marks pinned tiles with a check, unpinned without', () => {
    const pinned = renderScreen([ATTENDANCE_ACTION]);
    expect(pinned.queryAllByText('icon:checkmark')).toHaveLength(1);

    const none = renderScreen();
    expect(none.queryAllByText('icon:checkmark')).toHaveLength(0);
  });

  it('keeps the screen title and a back affordance in the header', () => {
    renderScreen();

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Quick Access');
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe('function');
  });
});
