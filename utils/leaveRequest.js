/**
 * Presentation helpers for the Leave Application form.
 *
 * Nothing here validates, submits or reaches an API — `hooks/useLeaveRequest.js`
 * owns all of that, unchanged from the classic screen. This module only decides
 * how the form's own values are *described* back to the user, so the rules can
 * be unit-tested without rendering anything.
 */

/**
 * Glyph per leave type, matched on the type's name.
 *
 * Leave types are tenant configuration — whatever the company set up in Frappe —
 * so this matches on a substring rather than an exact string, and falls back to
 * a neutral calendar for anything it doesn't recognise. The value sent to the
 * server is always the raw type; this only picks a picture.
 */
const LEAVE_TYPE_ICONS = [
  [/remote|work\s*from\s*home|wfh/i, 'home-outline'],
  [/sick|medical|illness/i, 'medkit-outline'],
  [/annual|vacation|holiday|earned/i, 'sunny-outline'],
  [/casual|short/i, 'cafe-outline'],
  [/matern|patern|parent/i, 'people-outline'],
  [/bereave|compassion|funeral/i, 'heart-outline'],
  [/marriage|wedding/i, 'heart-circle-outline'],
  [/hajj|umrah|pilgrim/i, 'moon-outline'],
  [/unpaid|without\s*pay|leave\s*without/i, 'wallet-outline'],
  [/compensat|time\s*off|toil/i, 'swap-horizontal-outline'],
  [/study|exam|training|educat/i, 'school-outline'],
  [/emergen/i, 'alert-circle-outline'],
];

export function leaveTypeIcon(type) {
  if (typeof type !== 'string') return 'calendar-outline';
  const match = LEAVE_TYPE_ICONS.find(([pattern]) => pattern.test(type));
  return match ? match[1] : 'calendar-outline';
}

/**
 * How many days the chosen range covers, counted inclusively.
 *
 * This is arithmetic on the two dates already on screen — the same two the user
 * just picked — and it is shown as a review of what is about to be submitted. It
 * is deliberately *not* an entitlement calculation: the backend decides what a
 * leave application actually costs, and may well count working days, half days
 * or holidays differently. Nothing here is sent anywhere, and no request
 * depends on it.
 *
 * Both dates are normalised to midnight first, so a range picked across a
 * daylight-saving boundary can't come back a fraction short and round down.
 * Returns `null` for an invalid or inverted range, which is the case the caller
 * uses to hide the summary rather than print a negative.
 */
export function countLeaveDays(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);

  if (to < from) return null;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

/** "1 day" / "3 days". */
export function formatLeaveDuration(days) {
  if (days === null || days === undefined) return null;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
