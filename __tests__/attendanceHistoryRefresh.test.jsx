/**
 * Pull-to-refresh on Attendance History drains the queue.
 *
 * ---------------------------------------------------------------------------
 * The failure this suite exists for
 * ---------------------------------------------------------------------------
 *
 * `refreshAll` — the half of the hook that drains before it refetches — was
 * written, documented and never wired up: the screen passed `onRefresh={refetch}`,
 * so the only gesture an employee has on the one screen where a stuck punch is
 * visible refetched the server and redrew the same "Pending sync" chip. The
 * design's own note calls a pull "the closest thing to a manual retry this
 * offers, and it is deliberately not a button" — and it was reaching nothing.
 *
 * The second half of the failure was quieter: `syncNow` was called without an
 * `employeeId`, so it fell back to the sync manager's idea of who is logged in
 * and refused outright ("no-employee") whenever the manager was not running —
 * a tenant with offline attendance switched off, or the employee code not yet
 * through after a login.
 *
 * The hook is exercised through a probe component rather than renderHook, so
 * the refresh runs the way the SectionList runs it.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockQueryState = {
  data: { pages: [[]] },
  isLoading: false,
  isError: false,
  error: null,
  isRefetching: false,
  hasNextPage: false,
  isFetchingNextPage: false,
};

const mockRefetch = jest.fn(() => Promise.resolve());
const mockFetchNextPage = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    ...mockQueryState,
    refetch: mockRefetch,
    fetchNextPage: mockFetchNextPage,
  }),
}));

jest.mock('react-redux', () => ({
  useSelector: (selector) =>
    selector({ user: { userDetails: { employeeCode: 'TDI0167' } } }),
}));

jest.mock('../services/api', () => ({
  getUserAttendance: jest.fn(() => Promise.resolve([])),
}));

const mockSyncNow = jest.fn(() => Promise.resolve({ ran: true }));
jest.mock('../services/offline/BackgroundSyncManager', () => ({
  __esModule: true,
  syncNow: (...args) => mockSyncNow(...args),
}));

const mockGetHistoryRows = jest.fn(() => Promise.resolve([]));
jest.mock('../services/offline/AttendanceQueueService', () => ({
  __esModule: true,
  addQueueChangeListener: jest.fn(() => () => {}),
  getHistoryRows: (...args) => mockGetHistoryRows(...args),
  getQueueCounts: jest.fn(() => Promise.resolve({ pendingCount: 0 })),
}));

/* eslint-disable import/first */
import useAttendanceHistory from '../hooks/useAttendanceHistory';
/* eslint-enable import/first */

/** Stands in for the SectionList's RefreshControl. */
function Probe() {
  const { isRefreshing, refreshAll } = useAttendanceHistory();

  return (
    <Text onPress={refreshAll}>
      {isRefreshing ? 'refreshing' : 'idle'}
    </Text>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncNow.mockResolvedValue({ ran: true });
  mockGetHistoryRows.mockResolvedValue([]);
  mockRefetch.mockResolvedValue();
});

describe('pull-to-refresh', () => {
  it('drains the queue before refetching the server', async () => {
    const { getByText } = render(<Probe />);

    await act(async () => {
      fireEvent.press(getByText('idle'));
    });

    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    // In that order, so a punch that syncs during the pull resolves to its
    // server copy in one pass rather than two.
    expect(mockSyncNow.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefetch.mock.invocationCallOrder[0],
    );
  });

  // Without this the pull is refused whenever the sync manager is not running.
  it('names the employee whose punches it is draining', async () => {
    const { getByText } = render(<Probe />);

    await act(async () => {
      fireEvent.press(getByText('idle'));
    });

    expect(mockSyncNow).toHaveBeenCalledWith({
      trigger: 'history-pull-to-refresh',
      employeeId: 'TDI0167',
    });
  });

  it('rereads the queue so a synced row loses its chip', async () => {
    const { getByText } = render(<Probe />);
    mockGetHistoryRows.mockClear();

    await act(async () => {
      fireEvent.press(getByText('idle'));
    });

    expect(mockGetHistoryRows).toHaveBeenCalledWith('TDI0167');
  });

  // The drain is the slow half and the half the employee is waiting on, so the
  // spinner has to cover it — React Query's `isRefetching` alone would leave the
  // gesture looking finished while the upload was still in flight.
  it('spins while the drain is in flight', async () => {
    let releaseSync;
    mockSyncNow.mockImplementation(
      () => new Promise((resolve) => {
        releaseSync = () => resolve({ ran: true });
      }),
    );

    const { getByText, queryByText } = render(<Probe />);

    await act(async () => {
      fireEvent.press(getByText('idle'));
    });

    expect(queryByText('refreshing')).toBeTruthy();

    await act(async () => {
      releaseSync();
    });

    expect(queryByText('idle')).toBeTruthy();
  });

  // A queue that cannot be drained must not cost the employee their history.
  it('still refetches when the drain fails', async () => {
    mockSyncNow.mockRejectedValue(new Error("Token missing"));

    const { getByText, queryByText } = render(<Probe />);

    await act(async () => {
      fireEvent.press(getByText('idle'));
    });

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(queryByText('idle')).toBeTruthy();
  });
});
