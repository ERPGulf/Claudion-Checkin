import React from 'react';
import { ActivityIndicator, Animated, View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const stub = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: stub, MaterialCommunityIcons: stub };
});

jest.mock('../hooks/useHomeExperience', () => ({
  __esModule: true,
  default: () => ({ enabled: true, hydrated: true, setEnabled: jest.fn() }),
}));

jest.mock('../hooks/useModernScreenHeader', () => ({
  __esModule: true,
  default: () => {},
}));

/**
 * The screen is presentation only, so the hook is stubbed and the assertion is
 * about which of its two refresh functions the gesture reaches.
 */
const historyRecord = {
  name: 'CI-1',
  log_type: 'IN',
  time: '2026-09-02 05:13:00',
  device_id: 'MobileAPP',
  syncStatus: 'pending',
};

const mockHistory = {
  isLoading: false,
  isError: false,
  error: null,
  // A pending punch, since that is the row the gesture exists for — and the
  // screen shows an empty state rather than a list when there is nothing.
  records: [historyRecord],
  sections: [{ title: 'Yesterday', count: 1, data: [[historyRecord]] }],
  hasNextPage: false,
  isFetchingNextPage: false,
  isRefreshing: false,
  loadMore: jest.fn(),
  refetch: jest.fn(),
  refreshAll: jest.fn(),
};

jest.mock('../hooks/useAttendanceHistory', () => ({
  __esModule: true,
  default: () => mockHistory,
}));

/* eslint-disable import/first */
import { SectionList } from 'react-native';
import AttendanceHistory from '../screens/AttendanceHistory';
import AttendanceHistoryCard from '../components/AttendanceHistory/AttendanceHistoryCard';
import HistorySectionHeader from '../components/AttendanceHistory/HistorySectionHeader';
import HistorySkeleton from '../components/AttendanceHistory/HistorySkeleton';
import { COLORS, DARK_COLORS } from '../constants';
/* eslint-enable import/first */

describe('AttendanceHistoryCard', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('splits the status, time and date into separate elements', () => {
    // The classic card crammed this into one string:
    // "CHECKED OUT AT 05:39 PM, 28/07/26".
    const { getByText, queryByText } = render(
      <AttendanceHistoryCard logType="OUT" time="2026-07-28 17:39:45" />,
    );

    expect(getByText('Checked out')).toBeTruthy();
    expect(getByText('05:39 PM')).toBeTruthy();
    expect(getByText('28 Jul 2026')).toBeTruthy();
    expect(queryByText(/CHECKED OUT AT/)).toBeNull();
  });

  it('chips an automatic punch, and leaves a manual one bare', () => {
    const auto = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" auto />,
    );
    expect(auto.getByText('Automatic')).toBeTruthy();

    const manual = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" />,
    );
    expect(manual.queryByText('Automatic')).toBeNull();
  });

  it('announces an automatic punch to a screen reader', () => {
    const { getByLabelText } = render(
      <AttendanceHistoryCard logType="OUT" time="2026-07-28 17:39:45" auto />,
    );

    expect(
      getByLabelText('Checked out, automatic, 05:39 PM, 28 Jul 2026'),
    ).toBeTruthy();
  });

  it('uses sentence case, not all caps', () => {
    const { getByText } = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" />,
    );

    expect(getByText('Checked in')).toBeTruthy();
  });

  it('tints a check-in green and a check-out blue, not red', () => {
    const checkIn = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" />,
    );
    const checkOut = render(
      <AttendanceHistoryCard logType="OUT" time="2026-07-28 17:39:45" />,
    );

    expect(checkIn.getByText('icon:log-in-outline')).toBeTruthy();
    expect(checkOut.getByText('icon:log-out-outline')).toBeTruthy();
    // A routine check-out must not read as an error.
    expect(checkOut.queryByText('icon:close-circle')).toBeNull();
  });

  it('hides the date when the section header already names the day', () => {
    const { queryByText, getByText } = render(
      <AttendanceHistoryCard
        logType="OUT"
        time="2026-07-28 17:39:45"
        showDate={false}
      />,
    );

    expect(getByText('05:39 PM')).toBeTruthy();
    expect(queryByText('28 Jul 2026')).toBeNull();
  });

  it('does not label punches made from this app', () => {
    const { queryByText } = render(
      <AttendanceHistoryCard
        logType="IN"
        time="2026-07-28 05:01:00"
        deviceId="MobileAPP"
      />,
    );

    expect(queryByText('MobileAPP')).toBeNull();
  });

  it('badges a punch from anywhere else', () => {
    const { getByText } = render(
      <AttendanceHistoryCard
        logType="IN"
        time="2026-07-28 05:01:00"
        deviceId="BIO-TERMINAL-2"
      />,
    );

    expect(getByText('BIO-TERMINAL-2')).toBeTruthy();
  });

  it('announces the whole row as one label to a screen reader', () => {
    const { getByLabelText } = render(
      <AttendanceHistoryCard
        logType="OUT"
        time="2026-07-28 17:39:45"
        deviceId="BIO-TERMINAL-2"
      />,
    );

    expect(
      getByLabelText('Checked out, 05:39 PM, 28 Jul 2026, from BIO-TERMINAL-2'),
    ).toBeTruthy();
  });

  it('only shows a chevron when the row actually does something', () => {
    const inert = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" />,
    );
    expect(inert.queryByText('icon:chevron-forward')).toBeNull();

    const pressable = render(
      <AttendanceHistoryCard
        logType="IN"
        time="2026-07-28 05:01:00"
        onPress={() => {}}
      />,
    );
    expect(pressable.queryByText('icon:chevron-forward')).toBeTruthy();
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <AttendanceHistoryCard
        logType="IN"
        time="2026-07-28 05:01:00"
        onPress={onPress}
      />,
    );

    fireEvent.press(getByText('Checked in'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a malformed timestamp instead of crashing', () => {
    // date-fns v2 throws on an Invalid Date, which is what the classic card
    // handed it.
    const { getByText } = render(
      <AttendanceHistoryCard logType="IN" time="not-a-date" />,
    );

    expect(getByText('--:--')).toBeTruthy();
    expect(getByText('Unknown date')).toBeTruthy();
  });

  it('falls back to neutral for an unrecognised log type', () => {
    const { getByText } = render(
      <AttendanceHistoryCard logType="TEA BREAK" time="2026-07-28 05:01:00" />,
    );

    expect(getByText('TEA BREAK')).toBeTruthy();
    expect(getByText('icon:help-circle-outline')).toBeTruthy();
  });

  it('follows the dark palette', () => {
    mockScheme = 'dark';
    const { getByText } = render(
      <AttendanceHistoryCard logType="IN" time="2026-07-28 05:01:00" />,
    );

    expect(getByText('Checked in').props.style.color).toBe(
      DARK_COLORS.textPrimary,
    );
  });
});

describe('HistorySectionHeader', () => {
  beforeEach(() => {
    mockScheme = 'light';
  });

  it('shows the day and a pluralised count', () => {
    const one = render(<HistorySectionHeader title="Today" count={1} />);
    expect(one.getByText('Today')).toBeTruthy();
    expect(one.getByText('1 entry')).toBeTruthy();

    const many = render(<HistorySectionHeader title="Yesterday" count={4} />);
    expect(many.getByText('4 entries')).toBeTruthy();
  });

  it('omits the count when there is nothing to count', () => {
    const { queryByText } = render(
      <HistorySectionHeader title="Today" count={0} />,
    );

    expect(queryByText(/entr/)).toBeNull();
  });

  it('is opaque, since it sticks over scrolling rows', () => {
    const { UNSAFE_getByType } = render(
      <HistorySectionHeader title="Today" count={2} />,
    );

    // A transparent sticky header lets rows scroll through the text.
    expect(UNSAFE_getByType(View).props.style.backgroundColor).toBe(
      COLORS.surfaceSecondary,
    );
  });

  it('is announced as a heading', () => {
    const { getByText } = render(
      <HistorySectionHeader title="Today" count={2} />,
    );

    expect(getByText('Today').props.accessibilityRole).toBe('header');
  });
});

describe('HistorySkeleton', () => {
  it('tells assistive tech the list is loading', () => {
    mockScheme = 'light';
    const { getByLabelText } = render(<HistorySkeleton />);

    expect(getByLabelText('Loading attendance history')).toBeTruthy();
  });

  it('shows placeholder rows rather than a spinner', () => {
    mockScheme = 'light';
    const { UNSAFE_queryAllByType } = render(
      <HistorySkeleton groups={2} rowsPerGroup={3} />,
    );

    expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    // Two group titles + 2 x 3 rows x 3 blocks per row.
    expect(UNSAFE_queryAllByType(Animated.View).length).toBeGreaterThanOrEqual(
      20,
    );
  });

  it('mirrors the requested geometry', () => {
    mockScheme = 'light';
    const small = render(<HistorySkeleton groups={1} rowsPerGroup={1} />);
    const large = render(<HistorySkeleton groups={3} rowsPerGroup={4} />);

    expect(
      large.UNSAFE_queryAllByType(Animated.View).length,
    ).toBeGreaterThan(small.UNSAFE_queryAllByType(Animated.View).length);
  });
});

/**
 * The gesture, and what it reaches.
 *
 * `refreshAll` — drain the queue, then refetch — existed, was documented as the
 * manual retry the design deliberately offers instead of a button, and was
 * wired to nothing: the list passed `onRefresh={refetch}`. So on the one screen
 * where a stuck punch is visible, pulling down refetched the server and redrew
 * the same "Pending sync" chip it was already showing.
 */
describe('AttendanceHistory pull-to-refresh', () => {
  beforeEach(() => {
    mockScheme = 'light';
    mockHistory.isRefreshing = false;
    mockHistory.refetch.mockClear();
    mockHistory.refreshAll.mockClear();
  });

  const refreshControlOf = (tree) =>
    tree.UNSAFE_getByType(SectionList).props.refreshControl;

  it('drains the queue rather than only refetching', () => {
    const tree = render(<AttendanceHistory />);

    // The gesture, as the list delivers it.
    refreshControlOf(tree).props.onRefresh();

    expect(mockHistory.refreshAll).toHaveBeenCalledTimes(1);
    expect(mockHistory.refetch).not.toHaveBeenCalled();
  });

  it('spins for the whole gesture, drain included', () => {
    mockHistory.isRefreshing = true;
    const tree = render(<AttendanceHistory />);

    expect(refreshControlOf(tree).props.refreshing).toBe(true);
  });
});
