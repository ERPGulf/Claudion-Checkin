import React from 'react';
import { StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  render,
  renderHook,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';

// Drives useAppTheme. Defaults to light; the dark block below flips it.
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

const mockNavigation = { setOptions: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

// The service pulls in apiClient → expo-location, untransformed under this
// jest config, and must not reach a real endpoint either way.
jest.mock('../services/api/notification.service', () => ({
  getNotifications: jest.fn(),
  markNotificationAsRead: jest.fn(),
}));

/* eslint-disable import/first */
import Notifications from '../screens/Notifications';
import useNotifications from '../hooks/useNotifications';
import NotificationRow from '../components/Notifications/NotificationRow';
import NotificationSkeleton from '../components/Notifications/NotificationSkeleton';
import { SearchCount } from '../components/common/SearchBar';
import notificationReducer, {
  decrementUnreadCount,
} from '../redux/Slices/notificationSlice';
import {
  countUnread,
  filterNotifications,
  formatDateLabel,
  formatNotificationTime,
  groupByDate,
  normalizeType,
  notificationIcon,
  parseNotificationDate,
} from '../utils/notifications';
import {
  getNotifications,
  markNotificationAsRead,
} from '../services/api/notification.service';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

const flatten = style => StyleSheet.flatten(style) || {};

/** `YYYY-MM-DD HH:mm:ss` for a day offset from today, as Frappe sends it. */
const stamp = (daysAgo, time = '09:30:00') => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
};

const UNREAD = {
  name: 'NOTIF-001',
  title: 'Expense claim approved',
  notification: 'Your claim for 250.00 was approved by your manager.',
  type: 'Expense Claim',
  read: 0,
  date: stamp(0, '14:33:00'),
};

const READ = {
  name: 'NOTIF-002',
  title: 'Leave request rejected',
  notification: 'Your leave request for next week could not be approved.',
  type: 'leave',
  read: 1,
  date: stamp(1, '08:05:00'),
};

const LIST = [UNREAD, READ];

function renderScreen() {
  const store = configureStore({
    reducer: { notification: notificationReducer },
    preloadedState: { notification: { unreadCount: 3 } },
  });

  return {
    store,
    ...render(<Notifications />, {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

function renderNotificationsHook() {
  const store = configureStore({
    reducer: { notification: notificationReducer },
    preloadedState: { notification: { unreadCount: 3 } },
  });

  return {
    store,
    ...renderHook(() => useNotifications(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    }),
  };
}

beforeEach(() => {
  mockScheme = 'light';
  jest.clearAllMocks();
  AsyncStorage.getItem.mockImplementation(key =>
    Promise.resolve(key === 'employee_id' ? 'HR-EMP-0001' : null),
  );
  getNotifications.mockResolvedValue(LIST);
  markNotificationAsRead.mockResolvedValue({});
});

/* =====================================================================
 * Pure helpers — grouping and formatting lifted from the classic screen
 * ================================================================== */

describe('formatDateLabel', () => {
  it('names today and yesterday', () => {
    expect(formatDateLabel(stamp(0))).toBe('Today');
    expect(formatDateLabel(stamp(1))).toBe('Yesterday');
  });

  it('keeps the classic en-GB "28 Jan 2026" for anything older', () => {
    expect(formatDateLabel('2026-01-28 10:00:00')).toBe('28 Jan 2026');
  });
});

describe('groupByDate', () => {
  it('groups by label and keeps the server order of the days', () => {
    const sections = groupByDate(LIST);

    expect(sections.map(s => s.date)).toEqual(['Today', 'Yesterday']);
    expect(sections[0].data).toEqual([UNREAD]);
  });

  it('keeps several notifications of one day in one section', () => {
    const second = { ...UNREAD, name: 'NOTIF-003' };
    const sections = groupByDate([UNREAD, second, READ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].data).toHaveLength(2);
  });

  it('survives an empty list', () => {
    expect(groupByDate([])).toEqual([]);
    expect(groupByDate(undefined)).toEqual([]);
  });
});

describe('parseNotificationDate', () => {
  it('reads the space-separated form Frappe sends', () => {
    const date = parseNotificationDate('2026-01-28 14:33:12');

    // Local components, not UTC — the reason this isn't `new Date(string)`.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(28);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(33);
  });

  it('reads an ISO string too', () => {
    expect(parseNotificationDate('2026-01-28T14:33:12').getHours()).toBe(14);
  });

  it('returns null rather than a wrong time for anything else', () => {
    expect(parseNotificationDate('28/01/2026')).toBeNull();
    expect(parseNotificationDate('2026-01-28')).toBeNull();
    expect(parseNotificationDate(undefined)).toBeNull();
  });
});

describe('formatNotificationTime', () => {
  it('formats through the app time formatter', () => {
    // 12- or 24-hour depending on the locale; either way it has both parts.
    expect(formatNotificationTime('2026-01-28 14:33:12')).toMatch(
      /^(02:33 PM|14:33)$/,
    );
  });

  it('says nothing when the payload has no usable time', () => {
    expect(formatNotificationTime('2026-01-28')).toBeNull();
  });
});

describe('notificationIcon', () => {
  it('keeps the classic categories, keyed the same way', () => {
    expect(notificationIcon('Expense Claim').icon).toBe('card-outline');
    expect(notificationIcon('salary').tone).toBe('success');
    expect(notificationIcon('meeting').tone).toBe('info');
    expect(notificationIcon('attendance').tone).toBe('accent');
    expect(notificationIcon('system').tone).toBe('neutral');
  });

  it('normalises spaces and punctuation before matching, as before', () => {
    expect(normalizeType('Expense  Claim!')).toBe('expenseclaim');
    expect(notificationIcon('expense claim').icon).toBe('card-outline');
  });

  it('falls back to a neutral bell for an unknown type', () => {
    const fallback = notificationIcon('something-new');
    expect(fallback.icon).toBe('notifications-outline');
    expect(fallback.tone).toBe('neutral');
  });
});

describe('filterNotifications', () => {
  it('matches the title and the message, case-insensitively', () => {
    expect(filterNotifications(LIST, 'APPROVED').map(n => n.name)).toEqual([
      'NOTIF-001',
      'NOTIF-002', // "could not be approved"
    ]);
    expect(filterNotifications(LIST, 'rejected').map(n => n.name)).toEqual([
      'NOTIF-002',
    ]);
  });

  it('returns the same array for a blank query, so rows do not re-render', () => {
    expect(filterNotifications(LIST, '   ')).toBe(LIST);
  });

  it('counts unread by the classic read === 0 rule', () => {
    expect(countUnread(LIST)).toBe(1);
  });
});

/* =====================================================================
 * Screen presentation
 * ================================================================== */

describe('modern Notifications screen', () => {
  it('uses the shared modern header with a subtitle below it', async () => {
    const { getByText } = renderScreen();

    const options = mockNavigation.setOptions.mock.calls[0][0];
    expect(options.headerTitle).toBe('Notifications');
    expect(options.headerShown).toBe(true);
    expect(typeof options.headerLeft).toBe('function');

    await waitFor(() =>
      expect(
        getByText('Stay up to date with your latest activity. 1 unread.'),
      ).toBeTruthy(),
    );
  });

  it('shows a skeleton while loading rather than an empty inbox', async () => {
    const { getByLabelText, queryByText } = renderScreen();

    expect(getByLabelText('Loading notifications')).toBeTruthy();
    expect(queryByText('No notifications yet')).toBeNull();

    await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  });

  it('groups rows under sticky date headers', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Today')).toBeTruthy());
    expect(getByText('Yesterday')).toBeTruthy();
    expect(getByText('Expense claim approved')).toBeTruthy();
    expect(getByText('Leave request rejected')).toBeTruthy();
  });

  it('shows a category chip, a preview and a timestamp per row', async () => {
    const { getByText, getAllByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    expect(
      getByText('Your claim for 250.00 was approved by your manager.'),
    ).toBeTruthy();
    expect(getAllByText('icon:card-outline').length).toBeGreaterThan(0);
    expect(getByText(/^(02:33 PM|14:33)$/)).toBeTruthy();
  });

  it('ellipsizes the preview at two lines', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    const preview = getByText(
      'Your claim for 250.00 was approved by your manager.',
    );
    expect(preview.props.numberOfLines).toBe(2);
    expect(preview.props.ellipsizeMode).toBe('tail');
  });

  it('marks unread with weight and a dot, read with a chevron', async () => {
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    // Unread leads its announcement with the state.
    expect(
      getByLabelText(/^Unread\. Expense claim approved/),
    ).toBeTruthy();
    expect(flatten(getByText('Expense claim approved').props.style).fontWeight).toBe(
      '600',
    );

    // Read is lighter and offers a chevron instead of the dot.
    expect(flatten(getByText('Leave request rejected').props.style).fontWeight).toBe(
      '500',
    );
    expect(getByText('icon:chevron-forward')).toBeTruthy();
  });

  it('offers a search field and a tally once there is something to search', async () => {
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByLabelText('Search notifications')).toBeTruthy());
    expect(getByText('2 notifications')).toBeTruthy();
  });

  it('gives every row a 44pt-plus target', async () => {
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    const row = getByLabelText(/^Unread\. Expense claim approved/);
    expect(flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});

/* =====================================================================
 * Search — client-side over the list already in memory
 * ================================================================== */

describe('notification search', () => {
  it('filters the list without another request', async () => {
    const { getByLabelText, getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Search notifications'), 'rejected');

    expect(getByText('Leave request rejected')).toBeTruthy();
    expect(queryByText('Expense claim approved')).toBeNull();
    expect(getByText('1 of 2')).toBeTruthy();
    // The one call is the mount load.
    expect(getNotifications).toHaveBeenCalledTimes(1);
  });

  it('tells an empty result apart from an empty inbox', async () => {
    const { getByLabelText, getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    fireEvent.changeText(getByLabelText('Search notifications'), 'zzzz');

    expect(getByText('No matching notifications')).toBeTruthy();

    fireEvent.press(getByText('Clear search'));
    expect(getByText('Expense claim approved')).toBeTruthy();
  });

  it('drops the search field when there is nothing to search', async () => {
    getNotifications.mockResolvedValue([]);

    const { getByText, queryByLabelText } = renderScreen();

    await waitFor(() => expect(getByText('No notifications yet')).toBeTruthy());
    expect(
      getByText("We'll notify you when something important happens."),
    ).toBeTruthy();
    expect(queryByLabelText('Search notifications')).toBeNull();
  });
});

/* =====================================================================
 * Opening a notification — the classic flow, unchanged
 * ================================================================== */

describe('opening a notification', () => {
  it('opens the same in-screen sheet rather than navigating', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Expense claim approved'));
    });

    // The sheet shows the day and time, the category and a close affordance;
    // nothing navigated.
    expect(getByText(/^Today · (02:33 PM|14:33)$/)).toBeTruthy();
    expect(getByText('Expense Claim')).toBeTruthy();
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });

  it('decrements the bell badge only for an unread notification', async () => {
    const { store, getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Expense claim approved'));
    });
    expect(store.getState().notification.unreadCount).toBe(2);

    await act(async () => {
      fireEvent.press(getByText('Leave request rejected'));
    });
    // Already read — the badge must not move again.
    expect(store.getState().notification.unreadCount).toBe(2);
  });

  it('marks it read on the server with the notification name', async () => {
    const { getByText } = renderScreen();

    await waitFor(() => expect(getByText('Expense claim approved')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Expense claim approved'));
    });

    expect(markNotificationAsRead).toHaveBeenCalledWith('NOTIF-001');
  });
});

/* =====================================================================
 * useNotifications — the lifted flow
 * ================================================================== */

describe('useNotifications', () => {
  it('loads once with the stored employee id', async () => {
    const { result } = renderNotificationsHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getNotifications).toHaveBeenCalledWith('HR-EMP-0001');
    expect(result.current.total).toBe(2);
  });

  it('does not call the endpoint without an employee id', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);

    const { result } = renderNotificationsHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getNotifications).not.toHaveBeenCalled();
    expect(result.current.total).toBe(0);
  });

  it('flags the row read locally before the server answers', async () => {
    let resolveMark;
    markNotificationAsRead.mockImplementation(
      () => new Promise(resolve => { resolveMark = resolve; }),
    );

    const { result } = renderNotificationsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.openNotification(UNREAD);
    });

    expect(result.current.list[0].read).toBe(1);
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      resolveMark({});
    });
  });

  it('keeps the row read when the server call fails', async () => {
    markNotificationAsRead.mockRejectedValue(new Error('offline'));

    const { result } = renderNotificationsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.openNotification(UNREAD);
    });

    // Swallowed exactly as the classic screen does — the badge already moved.
    expect(result.current.list[0].read).toBe(1);
    expect(result.current.selected).toEqual(UNREAD);
  });

  it('re-runs the same load on refresh', async () => {
    const { result } = renderNotificationsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(getNotifications).toHaveBeenCalledTimes(2);
    expect(result.current.refreshing).toBe(false);
  });

  it('closes the sheet without touching the list', async () => {
    const { result } = renderNotificationsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.openNotification(UNREAD);
    });
    act(() => result.current.closeNotification());

    expect(result.current.selected).toBeNull();
    expect(result.current.total).toBe(2);
  });

  it('dispatches the badge decrement action itself', async () => {
    const { store, result } = renderNotificationsHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Same action the classic screen dispatches.
    store.dispatch(decrementUnreadCount());
    expect(store.getState().notification.unreadCount).toBe(2);
  });
});

/* =====================================================================
 * Shared component additions
 * ================================================================== */

describe('SearchCount noun', () => {
  it('still reads in claims for its first caller', () => {
    const { getByText } = render(<SearchCount matches={42} total={42} />);
    expect(getByText('42 claims')).toBeTruthy();
  });

  it('does not pluralise a single item', () => {
    const { getByText } = render(<SearchCount matches={1} total={1} />);
    expect(getByText('1 claim')).toBeTruthy();
  });

  it('counts whatever the caller names', () => {
    const { getByText } = render(
      <SearchCount matches={3} total={3} noun="notification" />,
    );
    expect(getByText('3 notifications')).toBeTruthy();
  });

  it('falls back to "x of y" while filtered, whatever the noun', () => {
    const { getByText } = render(
      <SearchCount matches={3} total={9} noun="notification" />,
    );
    expect(getByText('3 of 9')).toBeTruthy();
  });
});

describe('NotificationSkeleton', () => {
  it('announces itself as loading', () => {
    const { getByLabelText } = render(<NotificationSkeleton />);
    expect(getByLabelText('Loading notifications')).toBeTruthy();
  });

  it('scales with the rows asked for', () => {
    const small = render(<NotificationSkeleton groups={1} rowsPerGroup={1} />);
    const large = render(<NotificationSkeleton groups={3} rowsPerGroup={4} />);

    expect(large.toJSON().children.length).toBeGreaterThan(
      small.toJSON().children.length,
    );
  });
});

/* =====================================================================
 * Dark mode
 * ================================================================== */

describe('modern Notifications in dark mode', () => {
  const row = notification => (
    <NotificationRow notification={notification} onPress={jest.fn()} />
  );

  it('takes every colour from the palette', () => {
    const light = render(row(UNREAD));
    expect(flatten(light.getByText(UNREAD.title).props.style).color).toBe(
      COLORS.textPrimary,
    );

    mockScheme = 'dark';
    const dark = render(row(UNREAD));
    expect(flatten(dark.getByText(UNREAD.title).props.style).color).toBe(
      DARK_COLORS.textPrimary,
    );
    // Unread no longer inverts the card to a hardcoded near-black panel.
    expect(flatten(dark.getByText(UNREAD.notification).props.style).color).toBe(
      DARK_COLORS.textSecondary,
    );
  });
});
