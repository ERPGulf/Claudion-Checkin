import { formatFieldTime } from './attendanceRequest';

/* -------------------------------------------------------------------------
 * Date grouping — lifted verbatim from the classic screen
 * ---------------------------------------------------------------------- */

/**
 * "Today" / "Yesterday" / "28 Jan 2026" — the group a notification belongs to.
 *
 * Copied unchanged from `screens/NotificationsLegacy.jsx`, including the
 * `en-GB` locale and the 2-digit day, so the two screens can never disagree about
 * which day a notification lands on. The modern screen restyles these labels; it
 * does not compute them differently.
 */
export function formatDateLabel(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Groups a flat notification list into `[{ date, data }]`.
 *
 * The reduce is the classic screen's, so the sections come out in the order the
 * server returned them (first notification of a day fixes that day's position) —
 * not re-sorted. Same labels, same membership, same order.
 */
export function groupByDate(list) {
  const grouped = (list || []).reduce((acc, item) => {
    const label = formatDateLabel(item.date);
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  return Object.keys(grouped).map(date => ({ date, data: grouped[date] }));
}

/* -------------------------------------------------------------------------
 * Timestamps
 * ---------------------------------------------------------------------- */

/**
 * Frappe hands back `2026-01-28 14:33:12`. `new Date()` on that string is
 * implementation-defined — Hermes returns Invalid Date for the space separator —
 * so the components are read out explicitly instead. ISO strings are also
 * accepted, and anything else gives null rather than a wrong time.
 *
 * Only used for the time-of-day on a row. Grouping still goes through
 * `formatDateLabel`, which keeps its original `new Date(dateString)`.
 */
export function parseNotificationDate(value) {
  if (!value || typeof value !== 'string') return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);

  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;

  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second || 0),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "2:33 PM", or "14:33" where the locale expects a 24-hour clock — through the
 * app's existing time formatter, so a notification's time reads the same as an
 * attendance log's. Returns null when the payload carries no usable time, and the
 * row then simply omits it.
 */
export function formatNotificationTime(value) {
  const date = parseNotificationDate(value);
  return date ? formatFieldTime(date) : null;
}

/* -------------------------------------------------------------------------
 * Category → glyph and tone
 * ---------------------------------------------------------------------- */

/** Squashes a server `type` to a registry key. Lifted verbatim. */
export function normalizeType(type) {
  if (!type) return '';

  return type
    .toLowerCase()
    .replace(/\s+/g, '') // remove spaces
    .replace(/[^a-z]/g, ''); // remove non-letters
}

/**
 * The classic screen's icon registry, keyed the same way, with the hardcoded hex
 * backgrounds replaced by semantic tones so the chip follows the palette in both
 * light and dark mode.
 *
 * Categories are unchanged — money, meetings, attendance, leave, system, and a
 * neutral fallback for anything unrecognised. The one deliberate difference is
 * leave: it was `#DC2626`, and red in this palette means *failure*, so a routine
 * leave notification would have looked like a rejection. It takes `warning`
 * instead, which is still distinct from every other category.
 */
const ICON_REGISTRY = {
  // money
  salary: { icon: 'card-outline', tone: 'success' },
  expense: { icon: 'card-outline', tone: 'success' },
  expenseclaim: { icon: 'card-outline', tone: 'success' },

  // meetings & time
  meeting: { icon: 'people-outline', tone: 'info' },
  attendance: { icon: 'time-outline', tone: 'accent' },

  // leave
  leave: { icon: 'calendar-outline', tone: 'warning' },

  // fallback/system
  system: { icon: 'settings-outline', tone: 'neutral' },
};

export function notificationIcon(type) {
  const key = normalizeType(type);

  return (
    ICON_REGISTRY[key] || {
      icon: 'notifications-outline',
      tone: 'neutral',
    }
  );
}

/* -------------------------------------------------------------------------
 * Search
 * ---------------------------------------------------------------------- */

/**
 * Client-side filter over the title and the message body.
 *
 * Safe to do locally and without a new endpoint because
 * `getNotifications(employeeId)` already returns the whole list in one call —
 * there is no cursor and nothing is fetched per page. A blank query returns the
 * same array reference, so an unfiltered list never re-renders the rows.
 */
export function filterNotifications(list, query) {
  const needle = (query || '').trim().toLowerCase();

  if (!needle) return list || [];

  return (list || []).filter(item => {
    const title = (item?.title || '').toLowerCase();
    const body = (item?.notification || '').toLowerCase();
    return title.includes(needle) || body.includes(needle);
  });
}

/** How many of a list are still unread, by the same `read === 0` rule. */
export function countUnread(list) {
  return (list || []).filter(item => Number(item?.read) === 0).length;
}
