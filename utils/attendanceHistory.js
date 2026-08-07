import { format, isToday, isYesterday } from 'date-fns';

/**
 * Pure presentation logic for the attendance history list.
 *
 * Nothing here fetches, filters or paginates — the query is untouched in
 * hooks/useAttendanceHistory.js. This module only decides how one server record
 * is *described*, so both the classic and modern screens read the same rules and
 * the rules can be unit-tested without rendering a list.
 *
 * A record from `employee_app.attendance_api.get_attendance_details` looks like:
 *   {
 *     name: 'EMP-CKIN-07-2026-002815',
 *     employee_name: 'MOHAMMED NATHU CHUNGAR A.',
 *     log_type: 'OUT',
 *     time: '2026-07-28 17:39:45',
 *     device_id: 'MobileAPP',
 *     employee: 'TDI0167',
 *     skip_auto_attendance: 0,
 *     creation: '2026-07-28 17:39:45.894330',
 *   }
 */

/**
 * Normalises the backend's timestamp into something `new Date()` accepts.
 *
 * Same two fixes the classic LogCard applied inline — drop the microseconds and
 * turn the space into a `T` — but this returns `null` for anything unparseable
 * instead of handing an Invalid Date to `format()`, which throws in date-fns v2.
 */
export function parseLogTime(time) {
  if (typeof time !== 'string' || !time.trim()) return null;

  let normalised = time.split('.')[0];
  if (normalised.includes(' ')) normalised = normalised.replace(' ', 'T');

  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "05:39 PM". Padded and tabular so a column of times stays aligned. */
export function formatLogTime(date) {
  return date ? format(date, 'hh:mm a') : '--:--';
}

/** "28 Jul 2026" — spelled month, because 28/07/26 is ambiguous across locales. */
export function formatLogDate(date) {
  return date ? format(date, 'd MMM yyyy') : 'Unknown date';
}

/**
 * log_type → label, semantic tone and glyph.
 *
 * Today the endpoint only ever returns IN and OUT. LATE ENTRY and EARLY EXIT are
 * carried over because the classic LogCard already coloured them, and the break
 * rows are mapped in advance so that if the backend starts emitting them the
 * list styles them correctly instead of falling back to "unknown". Anything
 * unrecognised keeps its raw label and goes neutral — never red, since an
 * unfamiliar log type is not an error.
 */
const LOG_TYPE_DESCRIPTIONS = {
  IN: { label: 'Checked in', tone: 'success', icon: 'log-in-outline' },
  OUT: { label: 'Checked out', tone: 'info', icon: 'log-out-outline' },
  'LATE ENTRY': {
    label: 'Late entry',
    tone: 'warning',
    icon: 'alert-circle-outline',
  },
  'EARLY EXIT': {
    label: 'Early exit',
    tone: 'warning',
    icon: 'exit-outline',
  },
  // Not emitted by this endpoint today — breaks live on their own API.
  'BREAK START': { label: 'Break started', tone: 'warning', icon: 'cafe-outline' },
  'BREAK END': { label: 'Break ended', tone: 'info', icon: 'play-outline' },
};

export function describeLogType(logType) {
  const key = typeof logType === 'string' ? logType.trim().toUpperCase() : '';
  const known = LOG_TYPE_DESCRIPTIONS[key];
  if (known) return known;

  return {
    label: key ? logType.trim() : 'Unknown',
    tone: 'neutral',
    icon: 'help-circle-outline',
  };
}

/**
 * Where the punch came from, or `null` when it came from this app.
 *
 * Every record this app writes carries `device_id: 'MobileAPP'`, so labelling
 * those would put the same word on every row. Surfacing only the exceptions is
 * what makes a biometric-terminal punch stand out.
 */
export function describeLogSource(deviceId) {
  if (typeof deviceId !== 'string') return null;
  const trimmed = deviceId.trim();
  if (!trimmed || trimmed.toUpperCase() === 'MOBILEAPP') return null;
  return trimmed;
}

/** "Today" / "Yesterday" / "28 Jul 2026". */
export function formatDayTitle(date, now = new Date()) {
  if (!date) return 'Unknown date';
  // isToday/isYesterday compare against the real clock; `now` is threaded
  // through only so tests can pin the boundary.
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'd MMM yyyy');
}

// ----------------------
// OFFLINE QUEUE MERGE
// ----------------------

/**
 * Sync state of a row that this device created but the server may not have yet.
 *
 * Server records carry no sync state at all — they are, by definition, synced —
 * so `null` means "came from the server" and renders no chip. That is the common
 * case and the one that must stay visually unchanged.
 */
export const SYNC_STATUS = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  /** The server can't accept it yet. Still retrying; nobody here can help. */
  NEEDS_ADMIN: 'needs-admin',
  /** The server never will. Only an attendance correction resolves it. */
  NEEDS_CORRECTION: 'needs-correction',
  /** Superseded by a correction request. Kept for audit. */
  RESOLVED: 'resolved',
  DUPLICATE: 'duplicate',
};

const SYNC_STATUS_DESCRIPTIONS = {
  [SYNC_STATUS.PENDING]: {
    label: 'Pending sync',
    tone: 'warning',
    icon: 'cloud-offline-outline',
  },
  [SYNC_STATUS.SYNCING]: {
    label: 'Syncing',
    tone: 'info',
    icon: 'sync-outline',
  },
  [SYNC_STATUS.SYNCED]: {
    label: 'Synced',
    tone: 'success',
    icon: 'cloud-done-outline',
  },
  // Amber, not red. Nothing is lost and nothing failed — the record is saved and
  // still being retried. Red here would have every employee reporting a bug the
  // moment an endpoint is late being deployed.
  [SYNC_STATUS.NEEDS_ADMIN]: {
    label: 'Waiting for administrator',
    tone: 'warning',
    icon: 'shield-outline',
  },
  // The only red one: this is the single state that will not resolve itself.
  [SYNC_STATUS.NEEDS_CORRECTION]: {
    label: 'Needs correction',
    tone: 'error',
    icon: 'alert-circle-outline',
  },
  [SYNC_STATUS.RESOLVED]: {
    label: 'Correction submitted',
    tone: 'neutral',
    icon: 'document-text-outline',
  },
  [SYNC_STATUS.DUPLICATE]: {
    label: 'Already synced',
    tone: 'info',
    icon: 'checkmark-done-outline',
  },
};

/** Chip label, tone and glyph for a sync state, or null for a server record. */
export function describeSyncStatus(syncStatus) {
  if (!syncStatus) return null;
  return SYNC_STATUS_DESCRIPTIONS[syncStatus] ?? null;
}

/**
 * The sync state a queue row should be shown as.
 *
 * A synced row that the server reported as an existing log reads as "Already
 * synced" rather than plain "Synced" — the distinction matters to anyone
 * checking why a punch they made twice only appears once.
 */
export function resolveQueueSyncStatus(row) {
  if (row?.status === 'synced') {
    return row.duplicate ? SYNC_STATUS.DUPLICATE : SYNC_STATUS.SYNCED;
  }
  if (row?.status === 'syncing') return SYNC_STATUS.SYNCING;
  if (row?.status === 'blocked') return SYNC_STATUS.NEEDS_ADMIN;
  if (row?.status === 'rejected') return SYNC_STATUS.NEEDS_CORRECTION;
  if (row?.status === 'resolved') return SYNC_STATUS.RESOLVED;
  return SYNC_STATUS.PENDING;
}

/** Queue row → the record shape the list already renders. */
export function toHistoryRecord(row) {
  return {
    // Distinct from a server docname so React keys never collide, and so a
    // local row is recognisable in a log.
    name: `local-${row.id}`,
    localId: row.id,
    log_type: row.action === 'checkout' ? 'OUT' : 'IN',
    time: row.timestamp,
    device_id: row.deviceId,
    employee: row.employeeId,
    syncStatus: resolveQueueSyncStatus(row),
    syncError: row.error ?? row.duplicateMessage ?? null,
    attendanceType: row.attendanceType,
  };
}

/** Second-precision epoch, so two spellings of one instant compare equal. */
const identityOf = (time, logType) => {
  const parsed = parseLogTime(time);
  const at = parsed ? Math.floor(parsed.getTime() / 1000) : String(time ?? '');
  return `${at}|${String(logType ?? '').toUpperCase()}`;
};

/**
 * Folds queued rows into the server's history so the screen shows one timeline
 * rather than a local list and a remote list.
 *
 * Three rules, in order:
 *
 *  1. **The server wins.** Once a punch comes back from
 *     `get_attendance_details`, the local row for it is dropped entirely — same
 *     instant, same log type, so it is the same punch. This is what makes the
 *     chip disappear on its own after a sync, with no extra bookkeeping.
 *
 *  2. **Unsynced rows always show**, however old. They are the whole point: a
 *     punch the server has never heard of must be visible until it has.
 *
 *  3. **Synced rows show only inside the loaded window.** They exist to cover
 *     the gap between "uploaded" and "the history query has refetched", which is
 *     seconds. Past the oldest loaded server record they would appear as lone
 *     rows for days the user has not paged back to yet, inventing sections — so
 *     below that floor they are dropped and the server's copy is awaited.
 *
 * Sorting is newest-first over the merged set. The server already returns that
 * order, and `groupRecordsByDay` deliberately does not sort, so interleaving a
 * local row correctly has to happen here.
 */
export function mergeQueuedRecords(serverRecords, queueRows) {
  const server = Array.isArray(serverRecords) ? serverRecords : [];
  const rows = Array.isArray(queueRows) ? queueRows : [];

  if (!rows.length) return server;

  const seen = new Set(
    server.map(record => identityOf(record?.time, record?.log_type)),
  );

  // Rule 3's floor. With no server records at all there is no window to be
  // outside of, so everything local shows — the first-launch-offline case.
  const oldestServerAt = server.reduce((oldest, record) => {
    const parsed = parseLogTime(record?.time);
    if (!parsed) return oldest;
    const at = parsed.getTime();
    return oldest === null || at < oldest ? at : oldest;
  }, null);

  const locals = rows
    .map(toHistoryRecord)
    .filter(record => {
      if (seen.has(identityOf(record.time, record.log_type))) return false;

      if (
        record.syncStatus === SYNC_STATUS.SYNCED ||
        record.syncStatus === SYNC_STATUS.DUPLICATE
      ) {
        if (oldestServerAt === null) return true;
        const parsed = parseLogTime(record.time);
        return !!parsed && parsed.getTime() >= oldestServerAt;
      }

      return true;
    });

  if (!locals.length) return server;

  const timeOf = record => parseLogTime(record?.time)?.getTime() ?? 0;

  return [...server, ...locals].sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * Groups records into SectionList sections, one per calendar day.
 *
 * Deliberately does **not** sort. The server returns newest-first and
 * pagination appends pages, so re-sorting here could reorder rows the user is
 * already looking at. Days appear in the order they are first seen, and a later
 * page's records join the day they belong to rather than opening a duplicate
 * section.
 *
 * Each section's `data` is a single-element array holding the whole day's rows,
 * so a day renders as one continuous card. Splitting it into one item per row
 * would mean either a shadow per row or visible seams between card fragments.
 */
export function groupRecordsByDay(records, now = new Date()) {
  if (!Array.isArray(records) || !records.length) return [];

  const days = new Map();

  records.forEach(record => {
    const date = parseLogTime(record?.time);
    // One bucket for everything undateable, kept in place rather than dropped —
    // a record the UI can't date is still a record the user punched.
    const key = date ? format(date, 'yyyy-MM-dd') : 'unknown';

    if (!days.has(key)) {
      days.set(key, { key, title: formatDayTitle(date, now), rows: [] });
    }
    days.get(key).rows.push(record);
  });

  return Array.from(days.values()).map(day => ({
    key: day.key,
    title: day.title,
    count: day.rows.length,
    data: [day.rows],
  }));
}
