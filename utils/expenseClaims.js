import { format } from 'date-fns';

/**
 * Pure presentation logic for expense claims.
 *
 * Nothing here fetches, validates or paginates — the query, the mutation and the
 * upload are untouched in hooks/useExpenseClaims.js and
 * services/api/expense.service.js. This module only decides how one claim is
 * *described*, so the rules can be unit-tested without rendering a list and so
 * the modern screen can't drift from the classic one on the facts.
 *
 * A claim from `employee_app.attendance_api.get_expense_claims` looks like:
 *   {
 *     name: 'HR-EXP-2026-00042',
 *     title: 'Travel',
 *     expense_date: '2026-08-05',
 *     expense_type: 'Travel',
 *     amount: 1250,
 *     description: 'Airport transfer',
 *     status: 'Approved',
 *     file_url: '/files/receipt.pdf' | ['/files/a.pdf', …] | null,
 *   }
 */

/* -------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------- */

/**
 * Parses `expense_date`, which arrives as a bare `YYYY-MM-DD`.
 *
 * Split and constructed from local components rather than handed to
 * `new Date('2026-08-05')`, which the spec defines as *UTC* midnight — that
 * renders as the 4th on any device west of Greenwich. Returns `null` for
 * anything unparseable so `format()` is never handed an Invalid Date, which
 * throws in date-fns v2.
 */
export function parseExpenseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "5 Aug 2026" — the same string Attendance History and Attendance Request
 * render, so a date reads identically wherever it appears.
 */
export function formatExpenseDate(value) {
  const date = parseExpenseDate(value);
  return date ? format(date, 'd MMM yyyy') : 'No date';
}

/** `YYYY-MM-DD` in local time — the wire format `createExpenseClaim` expects. */
export function toWireDate(date) {
  return format(date, 'yyyy-MM-dd');
}

/* -------------------------------------------------------------------------
 * Amounts
 * ---------------------------------------------------------------------- */

/**
 * Groups an amount and pins it to two decimals: "1,250.00".
 *
 * No currency symbol. The app is multi-tenant — the server URL, and therefore
 * the company and its currency, is provisioned per device by QR scan — and no
 * endpoint in this app returns a currency code today. Printing a guessed symbol
 * would be worse than printing none, so the amount is labelled by its position
 * and its weight instead.
 */
export function formatExpenseAmount(amount) {
  // `Number(null)` and `Number('')` are both 0, so a missing amount would print
  // as a confident "0.00" — a claim for nothing rather than a claim with no
  // figure. Reject the empty cases before coercing.
  if (amount === null || amount === undefined || amount === '') return '—';

  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return '—';

  const [whole, fraction] = Math.abs(numeric).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${numeric < 0 ? '-' : ''}${grouped}.${fraction}`;
}

/* -------------------------------------------------------------------------
 * Status
 * ---------------------------------------------------------------------- */

/**
 * status → label, semantic tone and glyph.
 *
 * The classic card coloured approved / rejected / pending and sent everything
 * else grey. The Frappe Expense Claim doctype also emits Draft, Submitted,
 * Unpaid, Paid and Cancelled, so those are mapped in advance rather than all
 * collapsing into one grey pill. Anything unrecognised keeps its raw label and
 * goes neutral — never red, since an unfamiliar status is not a rejection.
 */
const STATUS_DESCRIPTIONS = {
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
  paid: { label: 'Paid', tone: 'success', icon: 'wallet-outline' },
  rejected: { label: 'Rejected', tone: 'error', icon: 'close-circle' },
  cancelled: { label: 'Cancelled', tone: 'error', icon: 'ban-outline' },
  pending: { label: 'Pending', tone: 'warning', icon: 'time-outline' },
  unpaid: { label: 'Unpaid', tone: 'warning', icon: 'time-outline' },
  submitted: { label: 'Submitted', tone: 'info', icon: 'paper-plane-outline' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'create-outline' },
};

export function describeExpenseStatus(status) {
  const key = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const known = STATUS_DESCRIPTIONS[key];
  if (known) return known;

  return {
    label: key ? status.trim() : 'Unknown',
    tone: 'neutral',
    icon: 'help-circle-outline',
  };
}

/* -------------------------------------------------------------------------
 * Expense types
 * ---------------------------------------------------------------------- */

/**
 * Glyph per expense type.
 *
 * Matched on a substring rather than exact equality, because the list is
 * whatever the tenant has configured in `Expense Claim Type` — "Travel",
 * "Travel Expenses" and "Local Travel" should all get the plane. The *value*
 * sent to the server is always the raw server string; this only picks a picture.
 * Anything unmatched gets a neutral tag rather than a wrong icon.
 */
const TYPE_ICONS = [
  [/travel|flight|air/i, 'airplane-outline'],
  [/taxi|cab|transport|fuel|petrol|mileage|car/i, 'car-outline'],
  [/medical|health|clinic|hospital|pharma/i, 'medkit-outline'],
  [/call|phone|mobile|telecom|internet|data/i, 'call-outline'],
  [/food|meal|lunch|dinner|catering/i, 'restaurant-outline'],
  [/hotel|accommodation|lodging|stay/i, 'bed-outline'],
  [/office|stationery|suppl/i, 'briefcase-outline'],
  [/train|course|educat|certif|exam/i, 'school-outline'],
  [/gift|entertain|client/i, 'gift-outline'],
];

export function expenseTypeIcon(type) {
  if (typeof type !== 'string') return 'pricetag-outline';
  const match = TYPE_ICONS.find(([pattern]) => pattern.test(type));
  return match ? match[1] : 'pricetag-outline';
}

/** "travel" → "Travel". Mirrors what the classic card did inline. */
export function formatExpenseType(type) {
  if (typeof type !== 'string' || !type.trim()) return 'Expense';
  const trimmed = type.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* -------------------------------------------------------------------------
 * Attachments
 * ---------------------------------------------------------------------- */

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|heic|bmp)(\?|$)/i;

/**
 * Normalises `file_url` into a list the UI can render.
 *
 * The field is a string on some claims, an array on others and absent on most —
 * the same three shapes the classic card handled inline. Relative Frappe paths
 * are joined to the tenant's `baseUrl`; absolute ones and object entries are
 * left alone. A row with no resolvable URL is dropped rather than rendered as an
 * un-openable link.
 */
export function resolveAttachments(fileUrl, baseUrl = '') {
  const entries = Array.isArray(fileUrl) ? fileUrl : fileUrl ? [fileUrl] : [];

  return entries
    .map((file, index) => {
      const raw = typeof file === 'string' ? file : file?.url;
      if (!raw) return null;

      const url = /^https?:\/\//i.test(raw) ? raw : `${baseUrl}${raw}`;
      const name =
        (typeof file === 'object' && file?.name) ||
        decodeURIComponent(url.split('/').pop()?.split('?')[0] || '') ||
        'Attachment';

      return {
        key: `${url}-${index}`,
        url,
        name,
        isImage:
          (typeof file === 'object' && !!file?.type?.startsWith('image')) ||
          IMAGE_EXTENSION_RE.test(url),
      };
    })
    .filter(Boolean);
}

/**
 * One combined screen-reader label per claim, so a card is announced as a
 * sentence rather than as six unrelated fragments.
 */
export function describeClaimForA11y(claim, attachmentCount = 0) {
  const { label: status } = describeExpenseStatus(claim?.status);

  return [
    formatExpenseType(claim?.expense_type),
    formatExpenseAmount(claim?.amount),
    formatExpenseDate(claim?.expense_date),
    claim?.status ? status : null,
    attachmentCount
      ? `${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`
      : 'No attachment',
  ]
    .filter(Boolean)
    .join(', ');
}
