import { formatExpenseDate } from './expenseClaims';

/**
 * Shared presentation logic for the three "what I've submitted" histories:
 * Loan Application, Leave Request and Attendance Request.
 *
 * They are separate Frappe doctypes but they answer the same two questions —
 * where does this record stand, and what span does it cover — so the answers are
 * formatted in one place. Expense Claims keeps its own `describeExpenseStatus`
 * because its status set is genuinely different (Paid / Unpaid have no meaning
 * for a leave request).
 */

/**
 * status → label, semantic tone and glyph.
 *
 * Frappe emits Open, Approved, Rejected and Cancelled across these doctypes,
 * plus the usual Draft / Submitted pair. The classic cards only knew "Open"
 * (green) and painted everything else grey, which made a *rejection* look like
 * an ordinary neutral state.
 *
 * Anything unrecognised keeps its raw label and goes neutral — never red, since
 * an unfamiliar status is not a rejection.
 */
const STATUS_DESCRIPTIONS = {
  open: { label: 'Open', tone: 'info', icon: 'time-outline' },
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
  rejected: { label: 'Rejected', tone: 'error', icon: 'close-circle' },
  cancelled: { label: 'Cancelled', tone: 'error', icon: 'ban-outline' },
  submitted: { label: 'Submitted', tone: 'info', icon: 'paper-plane-outline' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'create-outline' },
};

export function describeRecordStatus(status) {
  const key = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const known = STATUS_DESCRIPTIONS[key];
  if (known) return known;

  return {
    label: key ? status.trim() : 'Unknown',
    tone: 'neutral',
    icon: 'help-circle-outline',
  };
}

/**
 * "5 Aug 2026" for a single day, "5 Aug 2026 – 7 Aug 2026" for a span.
 *
 * Collapsing the equal case matters: most attendance requests and a good share
 * of leave requests are one day, and "5 Aug 2026 – 5 Aug 2026" reads as a
 * formatting bug rather than as a single day.
 */
export function formatDateRange(from, to) {
  const start = formatExpenseDate(from);

  if (!to || from === to) return start;

  const end = formatExpenseDate(to);
  if (start === end) return start;

  return `${start} – ${end}`;
}
