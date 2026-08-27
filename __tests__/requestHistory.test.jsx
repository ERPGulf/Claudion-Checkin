import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

let mockEmployeeCode = 'EMP-001';
jest.mock('react-redux', () => ({
  useSelector: () => mockEmployeeCode,
}));

// useAttendanceRequest is imported for its two pure helpers, but the module also
// pulls in the attachment picker and the attendance service — neither of which
// this jest config transforms. Stub the edges; the helpers under test are pure.
jest.mock('../hooks/useAttachmentPicker', () => ({
  useAttachmentPicker: () => ({
    pickFromCamera: jest.fn(),
    pickFromGallery: jest.fn(),
    pickDocument: jest.fn(),
  }),
}));

jest.mock('../services/api/attendance.service', () => ({
  createAttendanceRequest: jest.fn(),
  getAttendanceRequests: jest.fn(),
  uploadAttendanceAttachment: jest.fn(),
}));

jest.mock('../services/offline/AttendanceQueueService', () => ({
  resolveWithCorrection: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: {} }),
}));

/* eslint-disable import/first */
import useRequestHistory, { PAGE_SIZE } from '../hooks/useRequestHistory';
import {
  describeRecordStatus,
  formatDateRange,
} from '../utils/records';
import {
  timeRangeInvalid,
  isSameCalendarDay,
} from '../hooks/useAttendanceRequest';
/* eslint-enable import/first */

function renderHistory(options) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderHook(() => useRequestHistory(options), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const record = (name, date) => ({ name, posting_date: date });

beforeEach(() => {
  mockEmployeeCode = 'EMP-001';
});

/* =====================================================================
 * useRequestHistory — one implementation behind three histories
 * ================================================================== */

describe('useRequestHistory', () => {
  it('sorts newest first on the field it is given', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      message: [
        record('A', '2026-08-01'),
        record('C', '2026-08-09'),
        record('B', '2026-08-05'),
      ],
    });

    const { result } = renderHistory({
      queryKey: 'x',
      fetcher,
      sortBy: 'posting_date',
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map(i => i.name)).toEqual(['C', 'B', 'A']);
  });

  it('does not mutate the array the query cache handed it', async () => {
    // Sorting in place would reorder the cached data under other readers.
    const message = [
      record('A', '2026-08-01'),
      record('C', '2026-08-09'),
    ];
    const fetcher = jest.fn().mockResolvedValue({ message });

    const { result } = renderHistory({
      queryKey: 'x',
      fetcher,
      sortBy: 'posting_date',
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(message.map(i => i.name)).toEqual(['A', 'C']);
  });

  it('reveals a page at a time and reports when there is more', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      message: Array.from({ length: PAGE_SIZE + 2 }, (_, i) =>
        record(`R${i}`, `2026-08-0${i + 1}`),
      ),
    });

    const { result } = renderHistory({
      queryKey: 'x',
      fetcher,
      sortBy: 'posting_date',
    });

    await waitFor(() =>
      expect(result.current.visible).toHaveLength(PAGE_SIZE),
    );
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.showMore());

    expect(result.current.visible).toHaveLength(PAGE_SIZE + 2);
    expect(result.current.hasMore).toBe(false);

    // A new submission puts the cursor back on the first page.
    act(() => result.current.resetPagination());
    expect(result.current.visible).toHaveLength(PAGE_SIZE);
  });

  it('turns the service\'s { error } into a failed query, not an empty list', async () => {
    const fetcher = jest.fn().mockResolvedValue({ error: 'Session expired.' });

    const { result } = renderHistory({
      queryKey: 'x',
      fetcher,
      sortBy: 'posting_date',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Session expired.');
    expect(result.current.items).toEqual([]);
  });

  it('does not ask the server whose records it means before login', async () => {
    mockEmployeeCode = null;
    const fetcher = jest.fn();

    renderHistory({ queryKey: 'x', fetcher, sortBy: 'posting_date' });

    await waitFor(() => expect(fetcher).not.toHaveBeenCalled());
  });
});

/* =====================================================================
 * utils/records
 * ================================================================== */

describe('formatDateRange', () => {
  it('collapses a single day rather than repeating it', () => {
    expect(formatDateRange('2026-08-05', '2026-08-05')).toBe('5 Aug 2026');
    expect(formatDateRange('2026-08-05', undefined)).toBe('5 Aug 2026');
  });

  it('renders a real span with both ends', () => {
    expect(formatDateRange('2026-08-05', '2026-08-07')).toBe(
      '5 Aug 2026 – 7 Aug 2026',
    );
  });
});

describe('describeRecordStatus', () => {
  it('gives a rejection its own tone rather than a neutral pill', () => {
    expect(describeRecordStatus('Rejected').tone).toBe('error');
    expect(describeRecordStatus('Approved').tone).toBe('success');
    expect(describeRecordStatus('Open').tone).toBe('info');
  });

  it('keeps an unfamiliar status neutral, never red', () => {
    expect(describeRecordStatus('Escalated')).toEqual({
      label: 'Escalated',
      tone: 'neutral',
      icon: 'help-circle-outline',
    });
  });
});

/* =====================================================================
 * Attendance Request — the same-day time rule
 * ================================================================== */

describe('timeRangeInvalid', () => {
  const day = (d, h = 0, m = 0) => new Date(2026, 7, d, h, m);

  it('rejects a same-day range whose end is not after its start', () => {
    expect(
      timeRangeInvalid(day(5), day(5), day(5, 17, 0), day(5, 9, 0)),
    ).toBe(true);

    // Equal is also invalid — a zero-length request.
    expect(
      timeRangeInvalid(day(5), day(5), day(5, 9, 0), day(5, 9, 0)),
    ).toBe(true);
  });

  it('accepts a normal same-day range', () => {
    expect(
      timeRangeInvalid(day(5), day(5), day(5, 9, 0), day(5, 17, 0)),
    ).toBe(false);
  });

  it('leaves a multi-day overnight range alone', () => {
    // 17:00 on the 5th to 09:00 on the 6th is legitimate, and the date range is
    // what expresses it — applying the same-day rule here would ban it.
    expect(
      timeRangeInvalid(day(5), day(6), day(5, 17, 0), day(6, 9, 0)),
    ).toBe(false);
  });

  it('compares clock time only, ignoring the date the picker attached', () => {
    // The time pickers hand back Dates carrying their own, irrelevant, day.
    const fromTime = new Date(2020, 0, 1, 9, 0);
    const toTime = new Date(2031, 11, 31, 17, 0);

    expect(timeRangeInvalid(day(5), day(5), fromTime, toTime)).toBe(false);
  });
});

describe('isSameCalendarDay', () => {
  it('compares local calendar days, not instants', () => {
    expect(
      isSameCalendarDay(new Date(2026, 7, 5, 0, 5), new Date(2026, 7, 5, 23, 55)),
    ).toBe(true);
    expect(
      isSameCalendarDay(new Date(2026, 7, 5), new Date(2026, 7, 6)),
    ).toBe(false);
  });
});
