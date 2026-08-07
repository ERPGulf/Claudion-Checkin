import {
  SYNC_STATUS,
  describeSyncStatus,
  groupRecordsByDay,
  mergeQueuedRecords,
  resolveQueueSyncStatus,
  toHistoryRecord,
} from '../utils/attendanceHistory';

/**
 * One timeline, whether or not the device has been online.
 *
 * The rule that matters most is that a punch is never shown twice: once the
 * server returns it, the local row for it has to disappear, and it has to
 * disappear without anyone writing bookkeeping to make that happen.
 */
const serverRecord = (time, logType = 'IN') => ({
  name: `EMP-CKIN-${time}`,
  log_type: logType,
  time,
  device_id: 'MobileAPP',
});

const queueRow = (overrides = {}) => ({
  id: 1,
  employeeId: 'TDI0167',
  action: 'checkin',
  timestamp: '2026-07-28 09:00:00',
  deviceId: 'MobileAPP',
  status: 'pending',
  duplicate: false,
  error: null,
  attendanceType: 'manual',
  ...overrides,
});

describe('resolveQueueSyncStatus', () => {
  it.each([
    ['pending', { status: 'pending' }, SYNC_STATUS.PENDING],
    ['syncing', { status: 'syncing' }, SYNC_STATUS.SYNCING],
    ['blocked', { status: 'blocked' }, SYNC_STATUS.NEEDS_ADMIN],
    ['rejected', { status: 'rejected' }, SYNC_STATUS.NEEDS_CORRECTION],
    ['resolved', { status: 'resolved' }, SYNC_STATUS.RESOLVED],
    ['synced', { status: 'synced', duplicate: false }, SYNC_STATUS.SYNCED],
  ])('maps a %s row', (_label, row, expected) => {
    expect(resolveQueueSyncStatus(row)).toBe(expected);
  });

  // Worth distinguishing: it answers "why does my double check-in only appear
  // once?" without anyone having to read a log.
  it('calls a synced duplicate "already synced", not just synced', () => {
    expect(resolveQueueSyncStatus({ status: 'synced', duplicate: true })).toBe(
      SYNC_STATUS.DUPLICATE,
    );
  });
});

describe('describeSyncStatus', () => {
  it('returns null for a server record, so no chip is drawn', () => {
    expect(describeSyncStatus(null)).toBeNull();
    expect(describeSyncStatus(undefined)).toBeNull();
  });

  it.each([
    [SYNC_STATUS.PENDING, 'Pending sync', 'warning'],
    [SYNC_STATUS.SYNCING, 'Syncing', 'info'],
    [SYNC_STATUS.SYNCED, 'Synced', 'success'],
    [SYNC_STATUS.NEEDS_ADMIN, 'Waiting for administrator', 'warning'],
    [SYNC_STATUS.NEEDS_CORRECTION, 'Needs correction', 'error'],
    [SYNC_STATUS.RESOLVED, 'Correction submitted', 'neutral'],
    [SYNC_STATUS.DUPLICATE, 'Already synced', 'info'],
  ])('describes %s as "%s" in the %s tone', (status, label, tone) => {
    expect(describeSyncStatus(status)).toMatchObject({ label, tone });
  });

  it('only ever uses tones the palette defines', () => {
    // `colors[`${tone}Surface`]` would be undefined for anything else, and the
    // chip would render with no background at all.
    const valid = ['success', 'info', 'warning', 'error', 'neutral'];
    Object.values(SYNC_STATUS).forEach(status => {
      expect(valid).toContain(describeSyncStatus(status).tone);
    });
  });
});

describe('toHistoryRecord', () => {
  it('shapes a queue row like a server record so one list renders both', () => {
    expect(toHistoryRecord(queueRow())).toMatchObject({
      log_type: 'IN',
      time: '2026-07-28 09:00:00',
      device_id: 'MobileAPP',
      syncStatus: SYNC_STATUS.PENDING,
    });
  });

  it('maps a checkout to OUT', () => {
    expect(toHistoryRecord(queueRow({ action: 'checkout' })).log_type).toBe('OUT');
  });

  it('namespaces the key so it can never collide with a docname', () => {
    expect(toHistoryRecord(queueRow({ id: 7 })).name).toBe('local-7');
  });
});

describe('mergeQueuedRecords', () => {
  it('returns the server list untouched when nothing is queued', () => {
    const server = [serverRecord('2026-07-28 09:00:00')];
    expect(mergeQueuedRecords(server, [])).toBe(server);
  });

  it('interleaves a queued punch into the timeline, newest first', () => {
    const server = [
      serverRecord('2026-07-28 17:00:00', 'OUT'),
      serverRecord('2026-07-28 08:00:00', 'IN'),
    ];
    const rows = [queueRow({ timestamp: '2026-07-28 12:00:00' })];

    const merged = mergeQueuedRecords(server, rows);

    expect(merged.map(record => record.time)).toEqual([
      '2026-07-28 17:00:00',
      '2026-07-28 12:00:00',
      '2026-07-28 08:00:00',
    ]);
  });

  // The chip disappearing on its own after a sync depends entirely on this.
  it('drops the local row once the server returns the same punch', () => {
    const server = [serverRecord('2026-07-28 09:00:00', 'IN')];
    const rows = [
      queueRow({ status: 'synced', timestamp: '2026-07-28 09:00:00' }),
    ];

    const merged = mergeQueuedRecords(server, rows);

    expect(merged).toHaveLength(1);
    expect(merged[0].syncStatus).toBeUndefined();
  });

  it('matches on the instant, not on the exact string spelling', () => {
    const server = [{ ...serverRecord('2026-07-28T09:00:00'), log_type: 'IN' }];
    const rows = [queueRow({ timestamp: '2026-07-28 09:00:00.123456' })];

    expect(mergeQueuedRecords(server, rows)).toHaveLength(1);
  });

  it('does not confuse a check-out with a check-in at the same instant', () => {
    const server = [serverRecord('2026-07-28 09:00:00', 'IN')];
    const rows = [queueRow({ action: 'checkout', timestamp: '2026-07-28 09:00:00' })];

    expect(mergeQueuedRecords(server, rows)).toHaveLength(2);
  });

  it('keeps an unsynced row visible however old it is', () => {
    const server = [serverRecord('2026-07-28 09:00:00')];
    const rows = [queueRow({ status: 'rejected', timestamp: '2020-01-01 09:00:00' })];

    const merged = mergeQueuedRecords(server, rows);

    expect(merged).toHaveLength(2);
    expect(merged[1].syncStatus).toBe(SYNC_STATUS.NEEDS_CORRECTION);
  });

  // A synced row older than the loaded pages would invent a day section for a
  // date the user has not paged back to yet.
  it('hides a synced row that falls outside the loaded window', () => {
    const server = [serverRecord('2026-07-28 09:00:00')];
    const rows = [queueRow({ status: 'synced', timestamp: '2020-01-01 09:00:00' })];

    expect(mergeQueuedRecords(server, rows)).toHaveLength(1);
  });

  it('shows everything local when no server pages have loaded at all', () => {
    // First launch, offline: there is no window to be outside of.
    const rows = [queueRow({ status: 'synced', timestamp: '2026-07-28 09:00:00' })];

    expect(mergeQueuedRecords([], rows)).toHaveLength(1);
  });

  it('tolerates nullish inputs rather than throwing at the list', () => {
    expect(mergeQueuedRecords(null, null)).toEqual([]);
    expect(mergeQueuedRecords(undefined, [queueRow()])).toHaveLength(1);
  });
});

describe('grouping a merged timeline', () => {
  it('files a queued punch into the same day section as the server rows', () => {
    const server = [serverRecord('2026-07-28 17:00:00', 'OUT')];
    const rows = [queueRow({ timestamp: '2026-07-28 09:00:00' })];

    const sections = groupRecordsByDay(mergeQueuedRecords(server, rows));

    expect(sections).toHaveLength(1);
    expect(sections[0].count).toBe(2);
  });
});
