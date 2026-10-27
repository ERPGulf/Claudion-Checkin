/**
 * Server-driven feature availability.
 *
 * `employee_app.gauth.employee_checkin_setting` lets an administrator decide
 * which features an employee sees. This module is the single place that knows
 * the shape of that response: everything else in the app reads a normalised
 * object through scoped selectors/hooks and `services/capabilityPolicy`.
 *
 * ---------------------------------------------------------------------------
 * The response is NOT uniformly boolean
 * ---------------------------------------------------------------------------
 *
 *   booleans  offline_attendance, photo_upload, restrict_location,
 *             unrestricted_checkout_location, employee_shift,
 *             employee_checkin_break, attendance_request, attendance_history,
 *             geo_tagging, loan_application, leave_request,
 *             employee_records, complaints, expense_claim,
 *             employee_resignation
 *
 *   strings   offline_attendance_version ("1")
 *
 * `geo_tagging` is the tenant's automatic-attendance switch
 * (`ATTENDANCE_FEATURES.AUTO_ATTENDANCE`) and the one exception to the rules
 * below: it starts background location, so only a real boolean `true` enables
 * it. Missing, null or anything else is off, and a fresh answer always replaces
 * the cached one. Employee eligibility is separate (AutoAttendanceSlice).
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
 * These are client availability/execution gates, not a security boundary. The
 * backend must independently authorize every operation; that behavior requires
 * staging verification. Unknown availability retains legacy compatibility, and
 * is explicitly different from an administrator's received false.
 *
 * An explicit `false` or wire `null` is always honoured, and it is honoured *through an
 * outage*: the last successful settings for a scope are persisted with it, so a
 * failed refresh keeps the previous answer rather than reverting to the
 * optimistic default. Only a scope that has never been fetched is optimistic.
 *
 * Changing unknown-field compatibility requires a product/backend migration
 * decision. Mandatory employee attendance/location rules remain independent.
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
  EMPLOYEE_RESIGNATION: 'employee_resignation',
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
  AUTO_ATTENDANCE: 'attendance_action.geo_tagging',
};

/** Every boolean the payload may carry, by its path. */
export const BOOLEAN_PATHS = [
  ...Object.values(FEATURES),
  ...Object.values(ATTENDANCE_FEATURES),
];

const BOOLEAN_PATH_SET = new Set(BOOLEAN_PATHS);
const OFFLINE_VERSION_PATH = 'attendance_action.offline_attendance_version';

/**
 * Frappe Check fields arrive as `true`, `1` or `"1"` depending on how the
 * endpoint serialises them, and a tenant on an older build may send `"true"`.
 * Explicit wire null disables a capability under the confirmed backend
 * contract. Missing/undefined and anything not recognisably true-or-false is
 * reported as unknown (normalised `null`) so it
 * falls through to the default rather than being coerced to `false` — a typo in
 * the payload must not silently disable a feature.
 */
export function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null) return false;

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

/**
 * The normalised shape. Boolean wire null becomes false before entering this
 * shape. Normalised null means missing/malformed, preserving both partial
 * refresh semantics and legacy persisted unknown values.
 */
export function emptyFeatureSettings() {
  return {
    loan_application: null,
    leave_request: null,
    employee_records: null,
    complaints: null,
    expense_claim: null,
    employee_resignation: null,
    attendance_action: {
      offline_attendance: null,
      offline_attendance_version: null,
      photo_upload: null,
      restrict_location: null,
      unrestricted_checkout_location: null,
      employee_shift: null,
      geo_tagging: null,
      employee_checkin_break: null,
      attendance_request: null,
      attendance_history: null,
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

  // Background location: whatever the server sends other than `true` is off.
  // Only a missing field stays unknown (and is off at the gate too).
  target.geo_tagging = 'geo_tagging' in attendance ? attendance.geo_tagging === true : null;

  // The one that is not a boolean.
  target.offline_attendance_version = normalizeString(
    attendance.offline_attendance_version,
  );
  // Versions are metadata, never Boolean permissions. Keep explicit null
  // separate from a missing version so a partial refresh can clear an old
  // version without clearing it whenever the server omits the field. This
  // optional serialized marker leaves older persisted shapes compatible.
  if (attendance.offline_attendance_version === null) {
    settings._explicitNullFields = [OFFLINE_VERSION_PATH];
  }

  return settings;
}

/** Reject an empty/malformed success rather than replacing known denials. */
export function hasRecognizedFeatureSettings(raw) {
  const normalized = normalizeFeatureSettings(raw);
  return BOOLEAN_PATHS.some(path => {
    const value = path.startsWith('attendance_action.')
      ? normalized.attendance_action[path.slice('attendance_action.'.length)]
      : normalized[path];
    return value !== null;
  }) || normalized.attendance_action.offline_attendance_version !== null ||
    normalized._explicitNullFields?.includes(OFFLINE_VERSION_PATH) === true;
}

/**
 * Missing fields in a refresh cannot retract a previously explicit answer —
 * except `geo_tagging`, which is never carried over: a cached `true` must not
 * keep background location on once a fresh answer stops saying so.
 */
export function mergeFeatureSettings(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, attendance_action: { ...previous.attendance_action } };
  for (const [key, value] of Object.entries(next || {})) {
    if (key === '_explicitNullFields') continue;
    if (key === 'attendance_action') {
      for (const [name, setting] of Object.entries(value || {})) {
        if (setting !== null && setting !== undefined) merged.attendance_action[name] = setting;
      }
    } else if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  if (next?._explicitNullFields?.includes(OFFLINE_VERSION_PATH)) {
    merged.attendance_action.offline_attendance_version = null;
    merged._explicitNullFields = [OFFLINE_VERSION_PATH];
  } else if (next?.attendance_action?.offline_attendance_version != null) {
    delete merged._explicitNullFields;
  }
  merged.attendance_action.geo_tagging = next?.attendance_action?.geo_tagging ?? null;
  return merged;
}

export const SETTINGS_STALE_AFTER_MS = 30 * 60 * 1000;

/** Pure snapshot health; stale answers retain their explicit restrictions. */
export function featureSettingsHealth(slice, now = Date.now()) {
  if (slice?.status === 'loading') return 'loading';
  if (!slice?.settings) return 'unavailable';
  if (slice.status === 'error' || !slice.lastFetchedAt ||
      now - slice.lastFetchedAt >= SETTINGS_STALE_AFTER_MS) return 'stale';
  return 'loaded';
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
 * Automatic attendance is the exception: unknown is off, never available.
 */
export function isFeatureEnabled(settings, path) {
  if (!BOOLEAN_PATH_SET.has(path)) {
    // A typo'd path must not silently read as disabled and hide a feature.
    if (__DEV__) {
      console.warn(`[featureSettings] Unknown feature path: ${path}`);
    }
    return DEFAULT_WHEN_UNKNOWN;
  }

  if (path === ATTENDANCE_FEATURES.AUTO_ATTENDANCE) return settings?.attendance_action?.geo_tagging === true;

  if (!settings || typeof settings !== 'object') return DEFAULT_WHEN_UNKNOWN;

  const value = path.startsWith('attendance_action.')
    ? settings.attendance_action?.[path.slice('attendance_action.'.length)]
    : settings[path];

  return value === null || value === undefined ? DEFAULT_WHEN_UNKNOWN : value;
}

/**
 * The non-boolean settings, read by path. Returns null when unset — there is no
 * sensible "default version" to invent.
 */
export function getFeatureValue(settings, path) {
  if (!settings || typeof settings !== 'object') return null;

  switch (path) {
    case 'attendance_action.offline_attendance_version':
      return settings.attendance_action?.offline_attendance_version ?? null;
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
  let tenant = String(baseUrl).trim().replace(/[\u0000-\u001F\u200B]+/g, '').replace(/\/+$/, '');
  try {
    const url = new URL(tenant);
    tenant = `${url.protocol}//${url.host.toLowerCase()}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    // Keep compatibility with existing provisioned URLs; auth validates these.
  }
  return `${tenant}::${employeeCode || 'unknown'}`;
}

/** Route name → the feature path that governs it. */
export const ROUTE_FEATURES = {
  'Attendance camera': ATTENDANCE_FEATURES.PHOTO_UPLOAD,
  'Loan application': FEATURES.LOAN_APPLICATION,
  'Leave request': FEATURES.LEAVE_REQUEST,
  Complaints: FEATURES.COMPLAINTS,
  'Expense claim': FEATURES.EXPENSE_CLAIM,
  Resignation: FEATURES.EMPLOYEE_RESIGNATION,
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
  ROUTE_FEATURES,
  buildSettingsScope,
  emptyFeatureSettings,
  getFeatureValue,
  isFeatureEnabled,
  isRouteEnabled,
  normalizeBoolean,
  normalizeFeatureSettings,
};
