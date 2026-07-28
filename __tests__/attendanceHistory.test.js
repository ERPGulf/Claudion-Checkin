import {
  describeLogSource,
  describeLogType,
  formatDayTitle,
  formatLogDate,
  formatLogTime,
  groupRecordsByDay,
  parseLogTime,
} from '../utils/attendanceHistory';

// Pin the clock. Without this the fixtures below drift in and out of being
// "Today"/"Yesterday" depending on the day the suite happens to run.
beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterAll(() => {
  jest.useRealTimers();
});

/** Shape taken from a real response. */
const record = (time, log_type = 'IN', device_id = 'MobileAPP') => ({
  name: `EMP-CKIN-${time}`,
  employee_name: 'MOHAMMED NATHU CHUNGAR A.',
  log_type,
  time,
  device_id,
  employee: 'TDI0167',
  skip_auto_attendance: 0,
});

describe('parseLogTime', () => {
  it('accepts the backend format', () => {
    const parsed = parseLogTime('2026-07-28 17:39:45');

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(28);
    expect(parsed.getHours()).toBe(17);
    expect(parsed.getMinutes()).toBe(39);
  });

  it('drops microseconds', () => {
    expect(parseLogTime('2026-07-28 17:39:45.894330').getSeconds()).toBe(45);
  });

  it('returns null rather than an Invalid Date', () => {
    // The classic LogCard passed garbage straight to format(), which throws in
    // date-fns v2 — so this must be caught before formatting.
    expect(parseLogTime('not a date')).toBeNull();
    expect(parseLogTime('')).toBeNull();
    expect(parseLogTime(null)).toBeNull();
    expect(parseLogTime(undefined)).toBeNull();
    expect(parseLogTime(12345)).toBeNull();
  });

  it('parses as local time, matching the classic screen', () => {
    // No trailing Z: 17:39 must stay 17:39 rather than shifting by the offset.
    expect(formatLogTime(parseLogTime('2026-07-28 17:39:45'))).toBe('05:39 PM');
  });
});

describe('formatters', () => {
  it('pads the hour so a column of times aligns', () => {
    expect(formatLogTime(parseLogTime('2026-07-28 05:01:00'))).toBe('05:01 AM');
  });

  it('spells the month, because 28/07/26 is ambiguous', () => {
    expect(formatLogDate(parseLogTime('2026-07-28 17:39:45'))).toBe(
      '28 Jul 2026',
    );
  });

  it('degrades without throwing when there is no date', () => {
    expect(formatLogTime(null)).toBe('--:--');
    expect(formatLogDate(null)).toBe('Unknown date');
  });
});

describe('describeLogType', () => {
  it('maps the two types this endpoint actually returns', () => {
    expect(describeLogType('IN')).toMatchObject({
      label: 'Checked in',
      tone: 'success',
    });
    expect(describeLogType('OUT')).toMatchObject({
      label: 'Checked out',
      tone: 'info',
    });
  });

  it('never uses red for a routine check-out', () => {
    // The classic card painted OUT red. Leaving a shift is not an error.
    expect(describeLogType('OUT').tone).not.toBe('error');
  });

  it('keeps the exception types the classic card coloured', () => {
    expect(describeLogType('LATE ENTRY').tone).toBe('warning');
    expect(describeLogType('EARLY EXIT').tone).toBe('warning');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(describeLogType('  in  ').label).toBe('Checked in');
  });

  it('falls back to neutral, keeping the raw label', () => {
    expect(describeLogType('SOMETHING NEW')).toMatchObject({
      label: 'SOMETHING NEW',
      tone: 'neutral',
    });
    expect(describeLogType(undefined)).toMatchObject({
      label: 'Unknown',
      tone: 'neutral',
    });
  });

  it('never returns a tone the theme cannot resolve', () => {
    const tones = ['success', 'info', 'warning', 'error', 'accent', 'neutral'];
    ['IN', 'OUT', 'LATE ENTRY', 'EARLY EXIT', 'BREAK START', 'BREAK END', '?']
      .map(describeLogType)
      .forEach(({ tone }) => expect(tones).toContain(tone));
  });
});

describe('describeLogSource', () => {
  it('hides this app, since that would label every row', () => {
    expect(describeLogSource('MobileAPP')).toBeNull();
    expect(describeLogSource('mobileapp')).toBeNull();
  });

  it('surfaces anything else', () => {
    expect(describeLogSource('BIO-TERMINAL-2')).toBe('BIO-TERMINAL-2');
  });

  it('treats blank and non-string as absent', () => {
    expect(describeLogSource('   ')).toBeNull();
    expect(describeLogSource(null)).toBeNull();
    expect(describeLogSource(undefined)).toBeNull();
  });
});

describe('formatDayTitle', () => {
  it('names today and yesterday', () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    expect(formatDayTitle(now)).toBe('Today');
    expect(formatDayTitle(yesterday)).toBe('Yesterday');
  });

  it('falls back to a spelled date', () => {
    expect(formatDayTitle(new Date(2026, 6, 28, 12))).toBe('28 Jul 2026');
  });
});

describe('groupRecordsByDay', () => {
  it('returns nothing for an empty or invalid list', () => {
    expect(groupRecordsByDay([])).toEqual([]);
    expect(groupRecordsByDay(null)).toEqual([]);
    expect(groupRecordsByDay(undefined)).toEqual([]);
  });

  it('groups a day into one section holding all its rows', () => {
    const sections = groupRecordsByDay([
      record('2026-07-28 17:39:45', 'OUT'),
      record('2026-07-28 05:01:00', 'IN'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('28 Jul 2026');
    expect(sections[0].count).toBe(2);
    // A single item per section: the whole day renders as one card.
    expect(sections[0].data).toHaveLength(1);
    expect(sections[0].data[0]).toHaveLength(2);
  });

  it('splits distinct days and preserves server order', () => {
    const sections = groupRecordsByDay([
      record('2026-07-28 17:39:45', 'OUT'),
      record('2026-07-27 16:04:00', 'OUT'),
      record('2026-07-26 08:27:00', 'OUT'),
    ]);

    expect(sections.map(s => s.title)).toEqual([
      '28 Jul 2026',
      '27 Jul 2026',
      '26 Jul 2026',
    ]);
  });

  it('does not re-sort within a day', () => {
    // Pagination appends; reordering rows the user is looking at is worse than
    // showing them exactly as the server sent them.
    const sections = groupRecordsByDay([
      record('2026-07-28 05:01:00', 'IN'),
      record('2026-07-28 17:39:45', 'OUT'),
    ]);

    expect(sections[0].data[0].map(r => r.log_type)).toEqual(['IN', 'OUT']);
  });

  it('joins a later page into an existing day instead of duplicating it', () => {
    const sections = groupRecordsByDay([
      record('2026-07-28 17:39:45', 'OUT'),
      record('2026-07-27 16:04:00', 'OUT'),
      // page 2 returns another 28 Jul row
      record('2026-07-28 05:01:00', 'IN'),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].count).toBe(2);
  });

  it('keeps undateable records instead of dropping them', () => {
    const sections = groupRecordsByDay([record('nonsense', 'IN')]);

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('unknown');
    expect(sections[0].title).toBe('Unknown date');
  });

  it('never loses a record', () => {
    const input = [
      record('2026-07-28 17:39:45', 'OUT'),
      record('2026-07-28 05:01:00', 'IN'),
      record('2026-07-27 16:04:00', 'OUT'),
      record('broken', 'IN'),
    ];

    const total = groupRecordsByDay(input).reduce(
      (sum, section) => sum + section.data[0].length,
      0,
    );

    expect(total).toBe(input.length);
  });
});
