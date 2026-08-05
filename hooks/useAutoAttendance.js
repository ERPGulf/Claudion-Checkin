import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';
import { getPreciseDistance } from 'geolib';
import {
  GEOTAGGING,
  GEOTAGGING_LABELS,
  requestAutoAttendanceSync,
  selectAutoAttendanceActive,
  selectAutoAttendanceAllowed,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceGeotagging,
  selectAutoAttendanceUserEnabled,
  setAutoAttendanceGeotagging,
  setAutoAttendanceUserEnabled,
} from '../redux/Slices/AutoAttendanceSlice';
import { getOfficeLocation } from '../services/api/attendance.service';
import { fetchEmployeeData } from '../services/api/employee.service';
import { ensureNotificationSetup } from '../services/notifications/localNotifications';
import {
  addErrorListener,
  addGeofenceEnterListener,
  addGeofenceExitListener,
  clearLastEvent,
  getLastEvent,
  getRegisteredGeofences,
  hasFullAccuracy,
  isAvailable,
  isIgnoringBatteryOptimizations,
  isLowPowerModeEnabled,
  isMonitoring,
  OFFICE_GEOFENCE_IDENTIFIER,
  startGeofence,
  stopGeofence,
} from '../modules/expo-auto-attendance';
import {
  DEFAULT_GEOFENCE,
  MAX_LOG_ENTRIES,
  WARNING_CODES,
  parseGeofenceInput,
  readDevicePosition,
  resolveOfficeName,
  waitForMonitoring,
} from '../utils/autoAttendance';

/**
 * Every bit of automatic-attendance logic, shared by the classic and modern
 * screens so neither can drift from the other.
 *
 * The Redux selectors, the native listener subscriptions, the focus re-checks,
 * the permission flow and all seven handlers are lifted verbatim from the
 * original screen — same effect dependencies, same Alert copy, same ordering,
 * same `devPolicyOverrideRef` semantics. Nothing here was retuned while moving
 * it, and nothing about geofencing, monitoring or the APIs changed.
 *
 * Only the stack header stays in the screens: each renders its own, because
 * that is the one genuinely presentational thing this hook would otherwise own.
 */
export default function useAutoAttendance() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const available = isAvailable();

  const geotagging = useSelector(selectAutoAttendanceGeotagging);
  const allowed = useSelector(selectAutoAttendanceAllowed);
  const userEnabled = useSelector(selectAutoAttendanceUserEnabled);
  const active = useSelector(selectAutoAttendanceActive);
  const fullActions = useSelector(selectAutoAttendanceFullActions);
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode,
  );

  const policy =
    GEOTAGGING_LABELS[geotagging] || GEOTAGGING_LABELS[GEOTAGGING.DISABLED];

  const [monitoring, setMonitoring] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const [permissionError, setPermissionError] = useState(null);
  const [reliabilityWarning, setReliabilityWarning] = useState(null);
  const [busy, setBusy] = useState(false);
  const [presence, setPresence] = useState(null);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [latitudeText, setLatitudeText] = useState(
    String(DEFAULT_GEOFENCE.latitude),
  );
  const [longitudeText, setLongitudeText] = useState(
    String(DEFAULT_GEOFENCE.longitude),
  );
  const [radiusText, setRadiusText] = useState(String(DEFAULT_GEOFENCE.radius));

  // __DEV__ only: once the developer simulates a policy, pause the automatic
  // server refresh so the simulated value survives navigation/focus. Never set
  // in production (the simulator UI that flips it is inside a __DEV__ block).
  const devPolicyOverrideRef = useRef(false);

  const appendLog = useCallback((entry) => {
    setEventLog((prev) =>
      [{ ...entry, receivedAt: Date.now() }, ...prev].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  // Reflect the latest server-side policy whenever the screen is opened, so an
  // administrator's change shows up without requiring a re-login. Silent on
  // failure — Redux keeps the last synced value (seeded by AutoAttendanceBootstrap).
  const refreshGeotagging = useCallback(async () => {
    if (devPolicyOverrideRef.current) return;
    if (!employeeCode) return;
    try {
      const employee = await fetchEmployeeData(employeeCode);
      dispatch(setAutoAttendanceGeotagging(employee?.geotagging));
    } catch (error) {
      console.log(
        '[AutoAttendance] Failed to refresh geotagging policy:',
        error?.message,
      );
    }
  }, [employeeCode, dispatch]);

  const refreshPermissionStatus = useCallback(async () => {
    try {
      const [foreground, background] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
      ]);
      setPermissionGranted(
        foreground.status === 'granted' && background.status === 'granted',
      );
    } catch (error) {
      console.log(
        '[AutoAttendance] Failed to read permission status:',
        error?.message,
      );
      setPermissionGranted(false);
    }
  }, []);

  // Reliability signals JS can poll (hasFullAccuracy/isLowPowerModeEnabled are
  // iOS-only in practice — they resolve to true/false on Android via the
  // module's fallbacks; isIgnoringBatteryOptimizations is Android-only).
  // Re-checked on focus since the user typically toggles these from system
  // Settings, not from inside the app.
  const refreshReliabilityStatus = useCallback(() => {
    if (!available) return;
    try {
      if (!hasFullAccuracy()) {
        setReliabilityWarning(
          'Precise Location is off for this app. A 100 m geofence needs it to detect check-in/out reliably — turn it on in Settings > Privacy & Security > Location Services.',
        );
      } else if (isLowPowerModeEnabled()) {
        setReliabilityWarning(
          Platform.OS === 'ios'
            ? "Low Power Mode is on. iOS may delay or suppress automatic check-in/out until it's turned off."
            : "Battery Saver is on. Android may delay or block automatic check-in/out until it's turned off.",
        );
      } else if (Platform.OS === 'android' && !isIgnoringBatteryOptimizations()) {
        setReliabilityWarning(
          'Battery optimization is restricting this app. Open Settings > Apps > Claudion Checkin > Battery and choose "Unrestricted" so check-in/out keeps working in the background.',
        );
      } else {
        setReliabilityWarning(null);
      }
    } catch (error) {
      console.log('[AutoAttendance] Failed to read reliability status:', error);
    }
  }, [available]);

  // Compute the user's live position relative to the registered office fence.
  // Uses the actual registered geofence (not the nearest configured office) so
  // it reflects the boundary that will really trigger check-in/out, and reads
  // GPS directly (timeout-guarded) rather than via getOfficeLocation, so there
  // is no network round-trip and no risk of hanging on a fix-less emulator.
  const refreshPresence = useCallback(async () => {
    if (!available) return;

    let registered = null;
    try {
      [registered] = getRegisteredGeofences();
    } catch (error) {
      console.log('[AutoAttendance] Failed to read registered fence:', error?.message);
    }
    if (!registered) {
      setPresence(null);
      return;
    }

    setPresenceLoading(true);
    try {
      const position = await readDevicePosition();
      if (!position) {
        setPresence(null);
        return;
      }
      const distance = getPreciseDistance(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        { latitude: registered.latitude, longitude: registered.longitude },
      );
      const locationName = await resolveOfficeName(
        registered.latitude,
        registered.longitude,
      );
      setPresence({
        locationName,
        latitude: registered.latitude,
        longitude: registered.longitude,
        radius: registered.radius,
        distance,
        withinRadius: registered.radius > 0 ? distance <= registered.radius : false,
      });
    } catch (error) {
      console.log('[AutoAttendance] Failed to compute presence:', error?.message);
      setPresence(null);
    } finally {
      setPresenceLoading(false);
    }
  }, [available]);

  // Load native state + subscribe to geofence events (kept even in production
  // so the Status card reflects reality — only the raw testing UI is dev-only).
  useEffect(() => {
    if (!available) return undefined;

    try {
      setMonitoring(isMonitoring());
      setLastEvent(getLastEvent());
      // Show the fence that is actually registered, not the defaults.
      const [registered] = getRegisteredGeofences();
      if (registered) {
        setLatitudeText(String(registered.latitude));
        setLongitudeText(String(registered.longitude));
        setRadiusText(String(registered.radius));
      }
    } catch (error) {
      console.log('[AutoAttendance] Failed to read native state:', error);
    }
    refreshReliabilityStatus();
    refreshPermissionStatus();
    refreshGeotagging();
    refreshPresence();

    const subscriptions = [
      addGeofenceEnterListener((event) => {
        console.log('[AutoAttendance] ENTER detected', event);
        setMonitoring(isMonitoring());
        setLastEvent(event);
        appendLog(event);
        refreshPresence();
      }),
      addGeofenceExitListener((event) => {
        console.log('[AutoAttendance] EXIT detected', event);
        setMonitoring(isMonitoring());
        setLastEvent(event);
        appendLog(event);
        refreshPresence();
      }),
      addErrorListener((event) => {
        console.log('[AutoAttendance] Geofence error', event);
        appendLog({ transition: 'ERROR', ...event });
        if (
          event.code === WARNING_CODES.LOW_POWER_MODE ||
          event.code === WARNING_CODES.REDUCED_ACCURACY
        ) {
          setReliabilityWarning(event.message);
        }
      }),
    ];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [
    available,
    appendLog,
    refreshReliabilityStatus,
    refreshPermissionStatus,
    refreshGeotagging,
    refreshPresence,
  ]);

  // Settings toggles and the policy itself can change outside this screen, and
  // monitoring can be (re)started by AutoAttendanceBootstrap in the background
  // — re-check everything on focus rather than only once on mount.
  useEffect(() => {
    if (!available) return undefined;
    return navigation.addListener('focus', () => {
      setMonitoring(isMonitoring());
      refreshReliabilityStatus();
      refreshPermissionStatus();
      refreshGeotagging();
      refreshPresence();
    });
  }, [
    available,
    navigation,
    refreshReliabilityStatus,
    refreshPermissionStatus,
    refreshGeotagging,
    refreshPresence,
  ]);

  // Recompute presence when monitoring turns on (e.g. right after the user
  // enables it, or when AutoAttendanceBootstrap re-registers the fence); clear
  // it when monitoring stops, since there's no boundary to be inside/outside of.
  useEffect(() => {
    if (!available) return;
    if (monitoring) {
      refreshPresence();
    } else {
      setPresence(null);
    }
  }, [available, monitoring, refreshPresence]);

  const requestPermissions = async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      console.log('[AutoAttendance] Permission denied (foreground location)');
      setPermissionError(
        'Location permission was denied. Allow location access to use automatic attendance.',
      );
      return false;
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      console.log('[AutoAttendance] Permission denied (background location)');
      setPermissionError(
        'Background location was denied. Choose "Allow all the time" (Android) or "Always" (iOS) in system settings so check-in works when the app is closed.',
      );
      return false;
    }

    console.log('[AutoAttendance] Permission granted (fine + background)');
    setPermissionError(null);
    return true;
  };

  // The administrator sets the policy (server-side geotagging); this is the
  // user's own opt-in. Turning it on persists `userEnabled` (redux-persist), so
  // the service stays on across relaunches, secures the permissions monitoring
  // needs, and validates that an office is actually configured.
  //
  // It deliberately does NOT call startGeofence. AutoAttendanceBootstrap is the
  // single registrar: it reacts to `userEnabled` flipping, owns the ENTER/EXIT
  // listeners that perform the real check-in/checkout, and re-establishes
  // monitoring on every launch. Registering here as well meant two concurrent
  // startGeofence calls for the same fence, which on iOS is rejected outright
  // ("Another geofence registration is already in progress") or cancels the
  // in-flight registration — losing the initial-state check that produces the
  // automatic check-in when the user is already inside.
  const handleToggleEnabled = async (value) => {
    if (busy) return;

    if (!value) {
      // Clearing the opt-in is enough to stop monitoring — the bootstrap's
      // effect calls stopGeofence when it sees the feature go inactive. Reflect
      // it locally so the Status card updates without waiting for a re-render.
      dispatch(setAutoAttendanceUserEnabled(false));
      setMonitoring(false);
      setPresence(null);
      return;
    }

    // Persist the opt-in first, so it survives even if the user backgrounds the
    // app during the permission prompt.
    dispatch(setAutoAttendanceUserEnabled(true));

    setBusy(true);
    try {
      // Whether permission was already in place decides if the bootstrap needs
      // nudging: its run triggered by the opt-in above happens before the OS
      // prompt is answered, so on a first-ever enable it bails at its own
      // permission check. When permission was already granted that run is
      // sufficient, and asking for another would only burn a second GPS fix.
      const [priorForeground, priorBackground] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
      ]);
      const wasAlreadyGranted =
        priorForeground.status === 'granted' &&
        priorBackground.status === 'granted';

      const granted = await requestPermissions();
      setPermissionGranted(granted);
      // Opt-in stays saved even if permission is declined — the user can grant
      // it later (or on the next launch) and monitoring resumes.
      if (!granted) return;

      if (!wasAlreadyGranted) dispatch(requestAutoAttendanceSync());

      // Secure notification permission + Android channel now, in the
      // foreground, so the automatic check-out alert can fire later from the
      // background. Non-blocking: monitoring still starts if the user declines.
      await ensureNotificationSetup();

      if (!employeeCode) {
        Alert.alert(
          'Not available yet',
          "Your employee record hasn't finished loading. Try again in a moment.",
        );
        return;
      }

      // Validation only — the bootstrap resolves the office again for the
      // registration itself. Catching it here turns an unconfigured account into
      // an explanation instead of a toggle that silently does nothing.
      const nearest = await getOfficeLocation(employeeCode);
      if (!nearest) {
        Alert.alert(
          'No office location configured',
          'Your account has no reporting location set up. Contact HR/admin to enable automatic attendance.',
        );
        return;
      }

      // The bootstrap registers asynchronously; poll briefly so the Status card
      // shows the real outcome rather than a stale "Not Monitoring".
      const registered = await waitForMonitoring();
      setMonitoring(registered);
      console.log(
        registered
          ? '[AutoAttendance] Monitoring enabled'
          : '[AutoAttendance] Monitoring not registered yet',
        nearest,
      );
    } catch (error) {
      console.log('[AutoAttendance] Failed to enable monitoring:', error);
      Alert.alert(
        'Could not turn on monitoring',
        error?.message || 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  };

  // __DEV__ only below — raw native testing with manual coordinates,
  // independent of the server policy above.
  const handleStart = async () => {
    const parsed = parseGeofenceInput(latitudeText, longitudeText, radiusText);
    if (parsed.error) {
      Alert.alert('Invalid geofence', parsed.error);
      return;
    }
    const geofence = { ...parsed, identifier: OFFICE_GEOFENCE_IDENTIFIER };

    setBusy(true);
    try {
      const granted = await requestPermissions();
      if (!granted) return;

      await startGeofence(geofence);
      setMonitoring(true);
      console.log('[AutoAttendance] Monitoring started', geofence);
    } catch (error) {
      console.log('[AutoAttendance] Failed to start monitoring:', error);
      Alert.alert(
        'Could not start monitoring',
        error?.message || 'Failed to register the geofence.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopGeofence();
      setMonitoring(false);
      console.log('[AutoAttendance] Monitoring stopped');
    } catch (error) {
      console.log('[AutoAttendance] Failed to stop monitoring:', error);
      Alert.alert(
        'Could not stop monitoring',
        error?.message || 'Failed to remove the geofence.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setBusy(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        console.log('[AutoAttendance] Permission denied (foreground location)');
        setPermissionError(
          'Location permission was denied. Allow location access to use automatic attendance.',
        );
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        Alert.alert(
          'Location is off',
          'Turn on Location in the device settings (on an emulator: Settings → Location).',
        );
        return;
      }

      // On emulators without a simulated GPS fix, getCurrentPositionAsync can
      // wait forever — race it against a timeout, then fall back to the last
      // known position (primed by e.g. opening Google Maps once).
      let position = null;
      try {
        position = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Timed out waiting for a GPS fix')),
              10000,
            ),
          ),
        ]);
      } catch (positionError) {
        console.log(
          '[AutoAttendance] getCurrentPosition failed, trying last known:',
          positionError?.message,
        );
        position = await Location.getLastKnownPositionAsync({
          maxAge: 600000,
        });
      }

      if (!position) {
        Alert.alert(
          'No location fix',
          'The device has no location yet. On an emulator, open Extended Controls (⋮ next to the emulator) → Location, pick a point and press "Set location", then try again. Opening Google Maps once also helps.',
        );
        return;
      }

      setLatitudeText(position.coords.latitude.toFixed(6));
      setLongitudeText(position.coords.longitude.toFixed(6));
      console.log(
        '[AutoAttendance] Filled inputs from current location',
        position.coords,
      );
    } catch (error) {
      console.log('[AutoAttendance] Failed to get current location:', error);
      Alert.alert(
        'Location error',
        error?.message || 'Could not get the current location.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClearStatus = () => {
    try {
      clearLastEvent();
    } catch (error) {
      console.log('[AutoAttendance] Failed to clear native status:', error);
    }
    setLastEvent(null);
    setEventLog([]);
    console.log('[AutoAttendance] Status cleared');
  };

  // __DEV__ only: force a geotagging policy locally (bypassing the server) so
  // all three states can be exercised without an HR change. It dispatches into
  // the same Redux state the real policy uses, so AutoAttendanceBootstrap reacts
  // to it exactly as it would to a server value.
  const handleSimulatePolicy = (value) => {
    devPolicyOverrideRef.current = true;
    dispatch(setAutoAttendanceGeotagging(value));
    console.log('[AutoAttendance] Simulating geotagging policy', value);
  };

  const handleResetPolicy = () => {
    devPolicyOverrideRef.current = false;
    refreshGeotagging();
    console.log('[AutoAttendance] Reset to server geotagging policy');
  };

  return {
    // Environment
    available,
    identifier: OFFICE_GEOFENCE_IDENTIFIER,

    // Policy (server-controlled)
    geotagging,
    policy,
    allowed,
    userEnabled,
    active,
    fullActions,

    // Live state
    monitoring,
    permissionGranted,
    lastEvent,
    eventLog,
    permissionError,
    reliabilityWarning,
    busy,
    presence,
    presenceLoading,

    // Manual override inputs (__DEV__ UI)
    latitudeText,
    setLatitudeText,
    longitudeText,
    setLongitudeText,
    radiusText,
    setRadiusText,

    // Actions
    refreshPresence,
    handleToggleEnabled,
    handleStart,
    handleStop,
    handleUseCurrentLocation,
    handleClearStatus,
    handleSimulatePolicy,
    handleResetPolicy,
  };
}
