import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { getPreciseDistance } from 'geolib';
import { format } from 'date-fns';
import { GEOTAGGING } from '../redux/Slices/AutoAttendanceSlice';
import { hasFullAccuracy, isMonitoring } from '../modules/expo-auto-attendance';

/**
 * Pure/IO helpers for the automatic-attendance screen, lifted verbatim out of
 * screens/AutoAttendance.jsx so the classic and modern screens share one copy.
 *
 * Nothing here holds React state. Every timeout, fallback and validation rule is
 * unchanged from the original screen — this module was a move, not a rewrite.
 */

// Codes emitted on the native onError channel for non-fatal reliability
// warnings (as opposed to the permission-loss case, which has no code).
export const WARNING_CODES = {
  LOW_POWER_MODE: -2,
  REDUCED_ACCURACY: -3,
};

// __DEV__-only default test values for the manual geofence override —
// production always uses the backend office location (see AutoAttendanceBootstrap).
export const DEFAULT_GEOFENCE = {
  latitude: 25.286106,
  longitude: 51.534817,
  radius: 100,
};

export const MAX_LOG_ENTRIES = 20;

/** The three server-side policy values, ordered for the dev simulator. */
export const DEV_POLICY_OPTIONS = [
  GEOTAGGING.DISABLED,
  GEOTAGGING.WARNINGS_ONLY,
  GEOTAGGING.ALL_ACTIONS,
];

export const formatTimestamp = (timestamp) =>
  timestamp ? format(new Date(timestamp), 'dd MMM yyyy, HH:mm:ss') : '—';

// Human-friendly distance: metres under 1 km, otherwise kilometres.
export const formatDistance = (meters) => {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
};

// Coordinates for a cached employee_locations entry — same precedence as the
// service's resolveCoordinates (reporting_location GeoJSON first, then the
// flat latitude/longitude fields).
export const parseLocationCoords = (loc) => {
  const flatLat = Number(loc?.latitude);
  const flatLng = Number(loc?.longitude);
  if (Number.isFinite(flatLat) && Number.isFinite(flatLng)) {
    return { latitude: flatLat, longitude: flatLng };
  }
  try {
    const coords = JSON.parse(loc?.reporting_location || '{}')?.features?.[0]
      ?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const [lng, lat] = coords.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }
  } catch {
    // fall through to null
  }
  return null;
};

// Best-effort name for the registered geofence: the cached office nearest to
// the fence centre (they share the same source coordinates, so the closest one
// is the office the fence was built from). Null when nothing matches.
export const resolveOfficeName = async (latitude, longitude) => {
  try {
    const raw = await AsyncStorage.getItem('employee_locations');
    const locations = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(locations) || !locations.length) return null;
    let bestName = null;
    let bestDistance = Infinity;
    locations.forEach((loc) => {
      const coords = parseLocationCoords(loc);
      if (!coords) return;
      const distance = getPreciseDistance({ latitude, longitude }, coords);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestName = loc?.location || null;
      }
    });
    return bestName;
  } catch {
    return null;
  }
};

// getCurrentPositionAsync can wait forever on an emulator with no simulated
// fix — race it against a timeout, then fall back to the last known position.
export const readDevicePosition = async () => {
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for a GPS fix')), 8000),
      ),
    ]);
  } catch (error) {
    console.log(
      '[AutoAttendance] Presence GPS failed, trying last known:',
      error?.message,
    );
    return Location.getLastKnownPositionAsync({ maxAge: 600000 });
  }
};

// AutoAttendanceBootstrap owns registration, and it has a GPS fix plus a network
// round-trip to get through before the fence exists. Poll so the screen reports
// the real outcome instead of a stale "Not Monitoring"; a timeout is not an
// error — the bootstrap keeps retrying on the next launch/focus.
export const waitForMonitoring = async (timeoutMs = 15000, intervalMs = 400) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isMonitoring()) return true;
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/* -------------------------------------------------------------------------
 * Location access — the one permission flow, shared by sign-in onboarding,
 * the screen's "Grant location access" and the bootstrap's reported state.
 * ---------------------------------------------------------------------- */

/**
 * What background geofencing needs: foreground and background ("Always" /
 * "Allow all the time") location, and precise accuracy (iOS Precise Location,
 * Android ACCESS_FINE_LOCATION). Read from the OS every time — never from a
 * record of what was asked before. `blocked`: the system will show no prompt
 * for the first missing step, so only Settings can change it.
 */
export const readLocationAccess = async () => {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  const precise = foreground.status === 'granted' && hasFullAccuracy();
  let blocked = false;
  if (foreground.status !== 'granted') blocked = foreground.canAskAgain === false;
  else if (background.status !== 'granted') blocked = background.canAskAgain === false;
  // iOS offers Precise Location only in Settings; Android asks again with the
  // foreground request.
  else if (!precise) blocked = Platform.OS === 'ios';
  return {
    foreground: foreground.status,
    background: background.status,
    precise,
    granted: foreground.status === 'granted' && background.status === 'granted' && precise,
    blocked,
  };
};

/** Identifies an OS permission state, so a decline is honoured only until it changes. */
export const locationAccessKey = (access) =>
  `${access.foreground}/${access.background}/${access.precise}`;

/**
 * Foreground first, then background — the order both platforms require — and
 * only the steps still missing. Returns the state read back from the OS:
 * asking for "Always" does not mean it was given.
 */
export const requestLocationAccess = async () => {
  let access = await readLocationAccess();
  if (access.foreground !== 'granted' || (!access.precise && Platform.OS === 'android')) {
    await Location.requestForegroundPermissionsAsync();
    access = await readLocationAccess();
  }
  if (access.foreground === 'granted' && access.background !== 'granted') {
    await Location.requestBackgroundPermissionsAsync();
    access = await readLocationAccess();
  }
  return access;
};

// Android 11+ grants background location only on the app's settings page,
// which the system opens itself; Android 9 and below has no separate step.
const ALWAYS_STEP = Platform.OS === 'ios'
  ? 'allow location access with Precise Location on, then choose "Change to Always Allow"'
  : Platform.Version >= 30
    ? 'allow precise location; Android then opens this app\'s location settings, where you choose "Allow all the time"'
    : Platform.Version >= 29
      ? 'allow precise location, then choose "Allow all the time"'
      : 'allow precise location';

/** The prominent disclosure, shown before any system prompt. Resolves whether to continue. */
const explainLocationAccess = () => new Promise((resolve) => {
  Alert.alert(
    'Automatic attendance',
    'Your employer has turned on automatic attendance. It uses your location to detect when you arrive at or leave your assigned work locations, including when the app is not open.' +
      `\n\nWhen asked, ${ALWAYS_STEP}.`,
    [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ],
    { cancelable: false, onDismiss: () => resolve(false) },
  );
});

// Only from a tap: the system will no longer ask, so Settings is the one way in.
const offerLocationSettings = () => {
  Alert.alert(
    'Location permission required',
    Platform.OS === 'ios'
      ? 'Open Settings, tap Location, and choose "Always" with Precise Location on.'
      : 'Open Settings, tap Permissions > Location, and choose "Allow all the time" with "Use precise location" on.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
};

let locationAccessFlow = null;

/**
 * Explains, then asks for whatever is missing — one flow at a time, so a second
 * caller (a re-render, a refresh, the screen's button) joins the first instead
 * of stacking dialogs. `fromTap` also offers Settings once the system will no
 * longer ask; `unless` skips a state the employee already declined. `asked`:
 * whether the employee answered anything in this flow.
 */
export const askForLocationAccess = ({ fromTap = false, unless } = {}) => {
  if (!locationAccessFlow) {
    locationAccessFlow = (async () => {
      const access = await readLocationAccess();
      if (access.granted || unless?.(access)) return { ...access, asked: false };
      if (access.blocked) {
        if (fromTap) offerLocationSettings();
        return { ...access, asked: false };
      }
      if (!(await explainLocationAccess())) return { ...access, asked: true };
      return { ...(await requestLocationAccess()), asked: true };
    })().finally(() => { locationAccessFlow = null; });
  }
  return locationAccessFlow;
};

export const parseNumber = (text) => {
  const trimmed = String(text).trim();
  return trimmed === '' ? NaN : Number(trimmed);
};

export const parseGeofenceInput = (latitudeText, longitudeText, radiusText) => {
  const latitude = parseNumber(latitudeText);
  const longitude = parseNumber(longitudeText);
  const radius = parseNumber(radiusText);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: 'Latitude must be a number between -90 and 90.' };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: 'Longitude must be a number between -180 and 180.' };
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return { error: 'Radius must be a positive number of meters.' };
  }
  return { latitude, longitude, radius };
};

/* -------------------------------------------------------------------------
 * Presentation vocabulary — new, and used only by the modern screen.
 *
 * Maps the raw state the native module reports onto the semantic `tone` names
 * the design system already understands, so a badge can never end up with a
 * success tint and an error label. The classic screen ignores these.
 * ---------------------------------------------------------------------- */

/** Monitoring state → badge tone + label. */
export const describeMonitoring = (monitoring) =>
  monitoring
    ? { tone: 'success', label: 'Monitoring', icon: 'radio-outline' }
    : { tone: 'neutral', label: 'Idle', icon: 'pause-circle-outline' };

/**
 * What automatic attendance is doing, from the employer's configuration, the
 * OS permission (`permitted`: null until read) and the bootstrap's report.
 * Configured alone is never "Active".
 */
export const describeAutoAttendanceStatus = ({ configured, permitted, monitoring }) => {
  if (!configured) return { key: 'disabled', tone: 'neutral', label: 'Disabled by administrator', icon: 'lock-closed-outline' };
  if (permitted === false || (permitted == null && monitoring === 'permission')) {
    return { key: 'permission', tone: 'warning', label: 'Location permission required', icon: 'location-outline' };
  }
  if (monitoring === 'active') return { key: 'active', tone: 'success', label: 'Active', icon: 'radio-outline' };
  if (monitoring === 'unavailable') return { key: 'unavailable', tone: 'error', label: 'Monitoring unavailable', icon: 'warning-outline' };
  return { key: 'starting', tone: 'info', label: 'Initializing monitoring', icon: 'sync-outline' };
};

/** A geofence transition → badge tone + label. */
export const describeTransition = (transition) => {
  switch (transition) {
    case 'ENTER':
      return { tone: 'info', label: 'Entered', icon: 'enter-outline' };
    case 'EXIT':
      return { tone: 'accent', label: 'Exited', icon: 'exit-outline' };
    case 'ERROR':
      return { tone: 'error', label: 'Error', icon: 'warning-outline' };
    default:
      return { tone: 'neutral', label: 'None yet', icon: 'ellipse-outline' };
  }
};

/** Whether automatic check-in/out is actually armed → badge tone + label. */
export const describeAutomatic = (active, fullActions) =>
  active && fullActions
    ? { tone: 'success', label: 'On', icon: 'flash-outline' }
    : { tone: 'neutral', label: 'Off', icon: 'flash-off-outline' };

/** The server policy → badge tone, for the geotagging card's header chip. */
export const describePolicy = (geotagging) => {
  switch (geotagging) {
    case GEOTAGGING.ALL_ACTIONS:
      return { tone: 'success', label: 'All actions', icon: 'checkmark-circle' };
    case GEOTAGGING.WARNINGS_ONLY:
      return { tone: 'warning', label: 'Warnings only', icon: 'alert-circle' };
    default:
      return { tone: 'neutral', label: 'Disabled', icon: 'close-circle' };
  }
};

/** Presence → badge tone + label, for the overview card. */
export const describePresence = (presence, loading) => {
  if (presence == null) {
    return loading
      ? { tone: 'neutral', label: 'Locating…', icon: 'locate-outline' }
      : { tone: 'neutral', label: 'Unknown', icon: 'help-circle-outline' };
  }
  return presence.withinRadius
    ? { tone: 'success', label: 'At the office', icon: 'business-outline' }
    : { tone: 'warning', label: 'Away', icon: 'navigate-outline' };
};
