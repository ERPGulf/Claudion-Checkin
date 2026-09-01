/**
 * Server-driven feature availability.
 *
 * `employee_app.gauth.employee_checkin_setting` lets an administrator decide
 * which features an employee sees. This module is the single place that knows
 * the shape of that response: everything else in the app reads a normalised
 * object through `hooks/useFeatureSettings`, never the raw body.
 *
 * ---------------------------------------------------------------------------
 * The response is NOT uniformly boolean
 * ---------------------------------------------------------------------------
 *
 *   booleans  offline_attendance, photo_upload, restrict_location,
 *             unrestricted_checkout_location, employee_shift,
 *             employee_checkin_break, attendance_request, attendance_history,
 *             auto_attendance, loan_application, leave_request,
 *             employee_records, complaints, expense_claim
 *
 *   strings   offline_attendance_version ("1")
 *
 *   enum      geo_tagging — 0 disabled, 1 warnings only, 2 all attendance
 *             actions. Older builds send the ERPNext select *label* instead
 *             ("Enable geotagging for all attendance actions").
 *
 * `geo_tagging` is read into `geo_tagging_level`, the 0/1/2 enum the rest of the
 * app already speaks (redux/Slices/AutoAttendanceSlice). Both forms are accepted
 * — see `geoTaggingLevel` — because a tenant on an older `employee_app` still
 * sends prose, and reading their sentence as "unknown" would be a silent
 * downgrade. The raw value is exposed too, but `geo_tagging_level` is the one to
 * read: it is the only form that is comparable.
 *
 * ---------------------------------------------------------------------------
 * Default when a value is unknown: AVAILABLE
 * ---------------------------------------------------------------------------
 *
 * "Unknown" means the endpoint has never returned a value for this scope: an
 * older `employee_app` build that predates the setting, a field the server
 * omitted, or a first launch where the request has not landed yet.
 *
 * Those default to available, deliberately, and for the same reason
 * `services/offline/offlineCapability.js` is optimistic before it knows
 * anything: defaulting to hidden would strip Loan, Leave, Complaints and
 * Records out of the app for every tenant still running a backend that does not
 * send this payload, and a first-launch outage would do it to everyone else.
 *
 * This is a UX gate, not a security boundary. The server still authorises every
 * request behind these screens, so a feature briefly visible to someone who may
 * not use it costs a rejected API call, while a feature wrongly hidden costs the
 * employee their job function with no way to get it back.
 *
 * An explicit `false` is always honoured, and it is honoured *through an
 * outage*: the last successful settings for a scope are persisted with it, so a
 * failed refresh keeps the previous answer rather than reverting to the
 * optimistic default. Only a scope that has never been fetched is optimistic.
 *
 * Flip `DEFAULT_WHEN_UNKNOWN` to false to make the whole system fail-closed;
 * everything reads that one constant.
 */

/** See the note above before changing this. */
export const DEFAULT_WHEN_UNKNOWN = true;

/** Top-level feature flags, and the route each one guards. */
export const FEATURES = {
  LOAN_APPLICATION: 'loan_application',
  LEAVE_REQUEST: 'leave_request',
  EMPLOYEE_RECORDS: 'employee_records',
  COMPLAINTS: 'complaints',
  EXPENSE_CLAIM: 'expense_claim',
};

/** Nested under `attendance_action`. Addressed as `attendance_action.<key>`. */
export const ATTENDANCE_FEATURES = {
  OFFLINE_ATTENDANCE: 'attendance_action.offline_attendance',
  PHOTO_UPLOAD: 'attendance_action.photo_upload',
  RESTRICT_LOCATION: 'attendance_action.restrict_location',
  UNRESTRICTED_CHECKOUT_LOCATION:
    'attendance_action.unrestricted_checkout_location',
  EMPLOYEE_SHIFT: 'attendance_action.employee_shift',
  EMPLOYEE_CHECKIN_BREAK: 'attendance_action.employee_checkin_break',
  ATTENDANCE_REQUEST: 'attendance_action.attendance_request',
  ATTENDANCE_HISTORY: 'attendance_action.attendance_history',
  AUTO_ATTENDANCE: 'attendance_action.auto_attendance',
};

/** Every boolean the payload may carry, by its path. */
const BOOLEAN_PATHS = [
  ...Object.values(FEATURES),
  ...Object.values(ATTENDANCE_FEATURES),
];

const BOOLEAN_PATH_SET = new Set(BOOLEAN_PATHS);

/**
 * Frappe Check fields arrive as `true`, `1` or `"1"` depending on how the
 * endpoint serialises them, and a tenant on an older build may send `"true"`.
 * Anything not recognisably true-or-false is reported as unknown (`null`) so it
 * falls through to the default rather than being coerced to `false` — a typo in
 * the payload must not silently disable a feature.
 */
export function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === '') {
      return text === '' ? null : false;
    }
  }

  return null;
}

/** A string setting, trimmed. Non-strings (and blanks) become null. */
function normalizeString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  // A number is a legitimate way to send a version ("1" vs 1).
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/** The three geotagging policies, matching redux/Slices/AutoAttendanceSlice. */
export const GEO_TAGGING_LEVELS = { DISABLED: 0, WARNINGS_ONLY: 1, ALL_ACTIONS: 2 };

/**
 * `geo_tagging` as the 0/1/2 level the rest of the app speaks.
 *
 * Two wire formats, because the backend changed and not every tenant has:
 *
 *  - **the enum** — `0` / `1` / `2`, as a number or as a numeric string. This is
 *    what current builds send, and it is unambiguous.
 *  - **the ERPNext select label** — "Enable geotagging for all attendance
 *    actions" and friends. Matched on substrings rather than exact equality
 *    because it is admin-facing prose that varies between builds.
 *
 * The enum is tested first and separately from the prose. That order matters:
 * `"0"` and `"1"` carry no words for the label patterns to match, so before this
 * they fell through to `null` — and `null` means "the server did not say", which
 * is the opposite of what `0` means. An administrator turning geotagging off
 * would have read as no answer at all.
 *
 * Still returns null for anything unrecognised, so a caller falls back to the
 * per-employee `geotagging` value `attendanceConfigCache` stores rather than
 * inventing a policy.
 */
export function geoTaggingLevel(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 2 ? value : null;
  }

  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();
  if (!text) return null;

  // `/^[012]$/` rather than Number(): "2 warnings" must not read as 2, and an
  // empty or whitespace string must not read as 0.
  if (/^[012]$/.test(text)) return Number(text);

  if (/disab|off|none/.test(text)) return 0;
  if (/all attendance|all action/.test(text)) return 2;
  if (/warn/.test(text)) return 1;
  if (/enable/.test(text)) return 2;

  return null;
}

/**
 * The normalised shape. Every value is either a settled value or `null` for
 * "the server did not tell us", which is what lets `isFeatureEnabled`
 * distinguish an explicit `false` from an absent field.
 */
export function emptyFeatureSettings() {
  return {
    loan_application: null,
    leave_request: null,
    employee_records: null,
    complaints: null,
    expense_claim: null,
    attendance_action: {
      offline_attendance: null,
      offline_attendance_version: null,
      photo_upload: null,
      restrict_location: null,
      unrestricted_checkout_location: null,
      employee_shift: null,
      geo_tagging: null,
      geo_tagging_level: null,
      employee_checkin_break: null,
      attendance_request: null,
      attendance_history: null,
      auto_attendance: null,
    },
  };
}

/**
 * Turns whatever the endpoint returned into the shape above.
 *
 * Total: null, a string, an array, a missing `attendance_action` and a payload
 * of entirely unexpected keys all produce a valid object of nulls rather than
 * throwing. A malformed response must never be able to take the app down, and
 * must never be mistaken for "everything is disabled".
 *
 * Frappe wraps method results in `{ message: ... }`; both the wrapped and bare
 * forms are accepted so the caller does not have to care.
 */
export function normalizeFeatureSettings(raw) {
  const settings = emptyFeatureSettings();

  let body = raw;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.message && typeof body.message === 'object') body = body.message;
    else if (body.data && typeof body.data === 'object') body = body.data;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return settings;
  }

  for (const key of Object.values(FEATURES)) {
    settings[key] = normalizeBoolean(body[key]);
  }

  const attendance =
    body.attendance_action &&
    typeof body.attendance_action === 'object' &&
    !Array.isArray(body.attendance_action)
      ? body.attendance_action
      : {};

  const target = settings.attendance_action;

  for (const path of Object.values(ATTENDANCE_FEATURES)) {
    const key = path.slice('attendance_action.'.length);
    target[key] = normalizeBoolean(attendance[key]);
  }

  // The two that are not booleans.
  target.offline_attendance_version = normalizeString(
    attendance.offline_attendance_version,
  );
  target.geo_tagging = normalizeString(attendance.geo_tagging);
  // From the raw value, not from the normalised string above: `normalizeString`
  // is lossy for this field (it renders a numeric 0 as "0"), and the level is
  // the form every caller actually uses.
  target.geo_tagging_level = geoTaggingLevel(attendance.geo_tagging);

  return settings;
}

/**
 * Reads a dotted path out of a normalised settings object.
 *
 * Callers address `"loan_application"` or `"attendance_action.attendance_history"`
 * and never touch the object's shape, so the payload can be reorganised without
 * touching call sites.
 *
 * Returns `DEFAULT_WHEN_UNKNOWN` for a null value, an unknown path, or a null
 * settings object — the three ways "the server has not said" can reach here.
 */
export function isFeatureEnabled(settings, path) {
  if (!BOOLEAN_PATH_SET.has(path)) {
    // A typo'd path must not silently read as disabled and hide a feature.
    if (__DEV__) {
      console.warn(`[featureSettings] Unknown feature path: ${path}`);
    }
    return DEFAULT_WHEN_UNKNOWN;
  }

  if (!settings || typeof settings !== 'object') return DEFAULT_WHEN_UNKNOWN;

  const value = path.startsWith('attendance_action.')
    ? settings.attendance_action?.[path.slice('attendance_action.'.length)]
    : settings[path];

  return value === null || value === undefined ? DEFAULT_WHEN_UNKNOWN : value;
}

/**
 * The non-boolean settings, read by path. Returns null when unset — there is no
 * sensible "default version" or "default geotagging sentence" to invent.
 */
export function getFeatureValue(settings, path) {
  if (!settings || typeof settings !== 'object') return null;

  switch (path) {
    case 'attendance_action.offline_attendance_version':
      return settings.attendance_action?.offline_attendance_version ?? null;
    case 'attendance_action.geo_tagging':
      return settings.attendance_action?.geo_tagging ?? null;
    case 'attendance_action.geo_tagging_level':
      return settings.attendance_action?.geo_tagging_level ?? null;
    default:
      return null;
  }
}

/**
 * Identifies whose settings these are.
 *
 * The app is multi-tenant and the server URL is provisioned per device by QR
 * scan, so settings belong to a (backend, employee) pair — not to the install.
 * Persisted settings carry their scope and are ignored the moment it stops
 * matching, which is what stops Tenant A's answers being applied to Tenant B
 * after a re-provision, or Employee A's to Employee B after a logout/login.
 */
export function buildSettingsScope(baseUrl, employeeCode) {
  if (!baseUrl) return null;
  return `${String(baseUrl).replace(/\/+$/, '')}::${employeeCode || 'unknown'}`;
}

/** Route name → the feature path that governs it. */
export const ROUTE_FEATURES = {
  'Loan application': FEATURES.LOAN_APPLICATION,
  'Leave request': FEATURES.LEAVE_REQUEST,
  Complaints: FEATURES.COMPLAINTS,
  'Expense claim': FEATURES.EXPENSE_CLAIM,
  'Attendance request': ATTENDANCE_FEATURES.ATTENDANCE_REQUEST,
  'Attendance history': ATTENDANCE_FEATURES.ATTENDANCE_HISTORY,
  'Auto attendance': ATTENDANCE_FEATURES.AUTO_ATTENDANCE,
  Shortcut1: FEATURES.EMPLOYEE_RECORDS,
  Shortcut2: FEATURES.EMPLOYEE_RECORDS,
  Shortcut3: FEATURES.EMPLOYEE_RECORDS,
};

/** Whether a route may be entered under the given settings. */
export function isRouteEnabled(settings, routeName) {
  const feature = ROUTE_FEATURES[routeName];
  // Routes with no flag (Home, Profile, QR, Attendance action…) are always open.
  if (!feature) return true;

  return isFeatureEnabled(settings, feature);
}

export default {
  DEFAULT_WHEN_UNKNOWN,
  FEATURES,
  ATTENDANCE_FEATURES,
  GEO_TAGGING_LEVELS,
  ROUTE_FEATURES,
  buildSettingsScope,
  emptyFeatureSettings,
  geoTaggingLevel,
  getFeatureValue,
  isFeatureEnabled,
  isRouteEnabled,
  normalizeBoolean,
  normalizeFeatureSettings,
};
