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
