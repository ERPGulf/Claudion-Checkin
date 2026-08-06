import { format } from 'date-fns';

/**
 * Pure presentation logic for the document detail screens (Shortcut 1/2/3).
 *
 * These screens are not one document type. `employee_app.attendance_api
 * .get_shortcut_1/2/3` each return `{ shortcut, data }`, where `shortcut` is a
 * tenant-configured title — "Health Card", "Residence Permit", "Passport",
 * "Labour Card", whatever that company set up — and `data` is a flat object of
 * whatever fields they chose to expose. There is no schema.
 *
 * So nothing here may hardcode a field. Everything is inferred from the *key*,
 * and every rule falls back to something neutral: an unrecognised field still
 * renders, with a generic glyph and its value as-is. Which fields appear, and in
 * what order, is exactly what the server sent — this module never adds, removes
 * or reorders one.
 */

/* -------------------------------------------------------------------------
 * Labels
 * ---------------------------------------------------------------------- */

/**
 * `card_number` → "Card Number".
 *
 * Byte-for-byte the transform the classic component applies inline, so a row is
 * titled identically on both UIs.
 */
export function formatFieldLabel(key = '') {
  return key
    .toString()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/* -------------------------------------------------------------------------
 * Field classification
 * ---------------------------------------------------------------------- */

const STATUS_KEY_RE = /status|approval|state\b/i;
const REMAINING_KEY_RE = /remaining|balance|days?_?left|left_?days?|expiry_?in/i;
const EXPIRY_KEY_RE = /expir|valid_?(till|until|to)|end_?date|due_?date/i;

/** Whether this field should render as a status badge rather than as text. */
export function isStatusField(key) {
  return STATUS_KEY_RE.test(String(key || ''));
}

/** Whether this field is a countdown — "remaining days", "balance days". */
export function isRemainingField(key) {
  return REMAINING_KEY_RE.test(String(key || ''));
}

/** Whether this field is the document's expiry date. */
export function isExpiryField(key) {
  return EXPIRY_KEY_RE.test(String(key || ''));
}

/* -------------------------------------------------------------------------
 * Icons
 * ---------------------------------------------------------------------- */

/**
 * Glyph per field, matched on the key name.
 *
 * Ordered — the first pattern that matches wins, so the specific rules sit above
 * the general ones ("issue date" must reach the calendar rule before "id"
 * catches it). Anything unmatched gets a neutral information glyph rather than a
 * wrong picture.
 */
const FIELD_ICONS = [
  [REMAINING_KEY_RE, 'hourglass-outline'],
  [EXPIRY_KEY_RE, 'calendar-outline'],
  [STATUS_KEY_RE, 'checkmark-circle-outline'],
  [/issue|start_?date|from_?date/i, 'calendar-number-outline'],
  [/birth|dob\b/i, 'gift-outline'],
  [/blood/i, 'water-outline'],
  [/nation|country|citizen/i, 'flag-outline'],
  [/passport/i, 'airplane-outline'],
  [/licen[cs]e|driving/i, 'car-outline'],
  [/insur|health|medical/i, 'medkit-outline'],
  [/sponsor|company|employer|organisation|organization/i, 'business-outline'],
  [/profession|designation|job|occupation|role|position/i, 'briefcase-outline'],
  [/depart|division|branch|team/i, 'people-outline'],
  [/place|location|address|city|region/i, 'location-outline'],
  [/phone|mobile|contact|tel\b/i, 'call-outline'],
  [/e?mail/i, 'mail-outline'],
  [/salary|amount|wage|allowance|pay\b/i, 'cash-outline'],
  [/type|category|class|grade/i, 'pricetag-outline'],
  [/name/i, 'person-outline'],
  [/number|no\b|_no$|code|id\b|serial/i, 'card-outline'],
  [/date/i, 'calendar-outline'],
];

export function fieldIcon(key) {
  const name = String(key || '');
  const match = FIELD_ICONS.find(([pattern]) => pattern.test(name));
  return match ? match[1] : 'information-circle-outline';
}

/* -------------------------------------------------------------------------
 * Status
 * ---------------------------------------------------------------------- */

/**
 * A status value → semantic tone, label and glyph.
 *
 * Matched on a substring, because these strings are tenant text: "Approved",
 * "approval pending", "Valid till 2026" all have to land somewhere sensible.
 * Order matters — the negative and pending patterns are tested before the
 * positive ones, so "approval pending" reads as pending rather than approved.
 *
 * Anything unrecognised keeps its own text and goes neutral. Never red: an
 * unfamiliar status is not a rejection, and this screen is read-only.
 */
const STATUS_TONES = [
  [/expired|rejected|cancell?ed|inactive|invalid|blocked|suspend/i, {
    tone: 'error',
    icon: 'close-circle',
  }],
  [/pending|process|review|await|progress|submitted|applied/i, {
    tone: 'warning',
    icon: 'time-outline',
  }],
  [/approved|active|valid|confirmed|completed|issued|renewed|clear/i, {
    tone: 'success',
    icon: 'checkmark-circle',
  }],
  [/draft|new\b|not_?started/i, { tone: 'neutral', icon: 'create-outline' }],
];

export function describeDocumentStatus(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return { label: 'Not available', tone: 'neutral', icon: 'help-circle-outline' };

  const match = STATUS_TONES.find(([pattern]) => pattern.test(text));

  return {
    // The tenant's own wording, capitalised the way every other label on the
    // screen is — never replaced with a word they didn't use.
    label: text.charAt(0).toUpperCase() + text.slice(1),
    tone: match ? match[1].tone : 'neutral',
    icon: match ? match[1].icon : 'ellipse-outline',
  };
}

/* -------------------------------------------------------------------------
 * Remaining days
 * ---------------------------------------------------------------------- */

/**
 * How close to expiry a document has to be before it is *shown* as running out.
 *
 * A presentation constant, and nothing more. It picks a badge tone, an icon and
 * a caption. It does not gate a field, change a request, alter a value, or reach
 * any server — the number rendered beside it is always the server's own
 * countdown, whatever this is set to. Moving it is a purely visual change, which
 * is the point of it having a name.
 */
export const EXPIRY_WARNING_DAYS = 30;

/**
 * The number out of a countdown value: `100`, `"100"`, `"100 Days"` → 100.
 * Returns `null` for anything that isn't a leading number, so a field named
 * "balance_note" can't be turned into a figure.
 */
export function parseRemainingDays(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * How to colour a countdown.
 *
 * Purely a colour choice — nothing is gated, hidden or recalculated, and the
 * number rendered is always the server's own. `EXPIRY_WARNING_DAYS` is a display
 * threshold, not a business rule.
 */
export function describeRemaining(value) {
  const days = parseRemainingDays(value);

  if (days === null) return { days: null, tone: 'neutral', caption: null };
  if (days <= 0) {
    return { days, tone: 'error', caption: 'Expired' };
  }
  if (days <= EXPIRY_WARNING_DAYS) {
    return { days, tone: 'warning', caption: 'Renew soon' };
  }
  return { days, tone: 'success', caption: 'Valid' };
}

/* -------------------------------------------------------------------------
 * Values
 * ---------------------------------------------------------------------- */

/** `2025-12-25`, optionally followed by a time. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;

/**
 * Renders a raw field value.
 *
 * Two changes from the classic `String(value)`, both presentational:
 *
 * - An empty string becomes an em dash. The classic screen rendered it as blank
 *   space, which reads as a broken row rather than as "we don't have this".
 * - An ISO date becomes "25 Dec 2025" — the same string Attendance History,
 *   Attendance Request and Expense Claims render, so a date reads the same
 *   everywhere in the app. Built from local components rather than
 *   `new Date('2025-12-25')`, which the spec defines as UTC midnight and which
 *   therefore shows the 24th anywhere west of Greenwich.
 *
 * Everything else — numbers, booleans, tenant text — goes through `String()`
 * exactly as the classic component does, so no value is silently rewritten.
 */
export function formatFieldValue(value) {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '—';

    const iso = ISO_DATE_RE.exec(trimmed);
    if (iso) {
      const [, year, month, day] = iso;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      if (!Number.isNaN(parsed.getTime())) return format(parsed, 'd MMM yyyy');
    }

    return trimmed;
  }

  return String(value);
}

/** A `Date` from an ISO field value, or `null`. Never guesses a format. */
function parseIsoField(value) {
  if (typeof value !== 'string') return null;

  const iso = ISO_DATE_RE.exec(value.trim());
  if (!iso) return null;

  const [, year, month, day] = iso;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How much of a document's validity is left, as a fraction, or `null`.
 *
 * Needs a real span to measure against, so it wants both an issue date and an
 * expiry date in the payload. When either is missing — or they are the wrong way
 * round, or neither parses as ISO — this returns `null` and the caller draws a
 * neutral bar. It never derives a total from the countdown itself, which would
 * mean inventing a start date the server never sent.
 *
 * `fraction` is remaining ÷ total, clamped to 0…1. `totalDays` comes back too,
 * so a caller can tell "measured" from "assumed" without re-deriving it.
 */
export function resolveValidityWindow(data, remainingValue) {
  const entries = Object.entries(data || {});

  const expiryEntry = entries.find(([key]) => isExpiryField(key));
  const issueEntry = entries.find(([key]) =>
    /issue|start_?date|from_?date/i.test(key),
  );

  const expiry = parseIsoField(expiryEntry?.[1]);
  const issue = parseIsoField(issueEntry?.[1]);
  if (!expiry || !issue) return null;

  const totalDays = Math.round((expiry - issue) / MS_PER_DAY);
  if (!Number.isFinite(totalDays) || totalDays <= 0) return null;

  const remainingDays = parseRemainingDays(remainingValue);
  if (remainingDays === null) return null;

  const fraction = Math.min(1, Math.max(0, remainingDays / totalDays));

  return { fraction, totalDays, remainingDays };
}

/* -------------------------------------------------------------------------
 * Screen model
 * ---------------------------------------------------------------------- */

/**
 * The hero's supporting line, when the data itself doesn't provide one.
 *
 * Built from the tenant's own title rather than a lookup table, so it works for
 * a document type nobody anticipated: "Health Card" → "Health card information",
 * "RESIDENCE PERMIT" → "Residence permit information", no title →
 * "Document information". Sentence case, because a heading and a subheading in
 * the same Title Case read as two headings.
 *
 * The title's own spelling is preserved — a tenant that configured "Driving
 * License" gets "Driving license information", not a rewrite to a spelling they
 * didn't choose. Nothing tenant-specific is hardcoded, and no business fact is
 * asserted: it names the document and stops.
 */
export function documentSubtitle(title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) return 'Document information';

  const sentence =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();

  // A title that already ends in "information"/"details"/"info" would otherwise
  // stutter — "Health information information".
  if (/\b(information|details|info)$/i.test(sentence)) return sentence;

  return `${sentence} information`;
}

/**
 * Turns the server's object into what the screen renders.
 *
 * Entries with a `null`/`undefined` value are dropped, which is exactly what the
 * classic component's filter does — so the two UIs agree on which rows exist.
 * Order is the server's order, untouched.
 *
 * The status and countdown fields are *promoted*: they come out as `status` and
 * `remaining` and are left out of `rows`, because they are rendered with
 * emphasis at the top instead. Only the first of each is promoted; a second
 * status-ish field stays an ordinary row rather than silently disappearing.
 *
 * `subtitle` is never empty. It prefers a fact from the payload — "Valid until
 * 25 Dec 2025" — but yields to `documentSubtitle(title)` when the countdown card
 * is going to print that same expiry, so the screen doesn't say it twice in two
 * places six points apart. `expiryValue` is handed out for that card to render.
 */
export function buildDetailModel(data, title) {
  const entries = Object.entries(data || {}).filter(
    ([, value]) => value !== null && value !== undefined,
  );

  let status = null;
  let remaining = null;
  const rows = [];

  entries.forEach(([key, value]) => {
    if (!status && isStatusField(key)) {
      status = { key, label: formatFieldLabel(key), value };
      return;
    }

    if (!remaining && isRemainingField(key)) {
      remaining = { key, label: formatFieldLabel(key), value };
      return;
    }

    rows.push({
      key,
      label: formatFieldLabel(key),
      value: formatFieldValue(value),
      icon: fieldIcon(key),
    });
  });

  const expiry = entries.find(([key]) => isExpiryField(key));
  const expiryValue = expiry ? formatFieldValue(expiry[1]) : null;

  // Prefer the real fact, fall back to naming the document — but hand the expiry
  // to the countdown card instead when there is one, since that card prints
  // "Valid until …" itself.
  const subtitle =
    expiryValue && !remaining
      ? `Valid until ${expiryValue}`
      : documentSubtitle(title);

  return { status, remaining, rows, subtitle, expiryValue };
}
