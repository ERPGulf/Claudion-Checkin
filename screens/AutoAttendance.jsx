import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import Entypo from "@expo/vector-icons/Entypo";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { format } from "date-fns";
import { COLORS, SIZES } from "../constants";
import {
  GEOTAGGING,
  GEOTAGGING_LABELS,
  selectAutoAttendanceActive,
  selectAutoAttendanceAllowed,
  selectAutoAttendanceFullActions,
  selectAutoAttendanceGeotagging,
  selectAutoAttendanceUserEnabled,
  setAutoAttendanceGeotagging,
  setAutoAttendanceUserEnabled,
} from "../redux/Slices/AutoAttendanceSlice";
import { getOfficeLocation } from "../services/api/attendance.service";
import { fetchEmployeeData } from "../services/api/employee.service";
import { ensureNotificationSetup } from "../services/notifications/localNotifications";
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
} from "../modules/expo-auto-attendance";

// Codes emitted on the native onError channel for non-fatal reliability
// warnings (as opposed to the permission-loss case, which has no code).
const WARNING_CODES = {
  LOW_POWER_MODE: -2,
  REDUCED_ACCURACY: -3,
};

// __DEV__-only default test values for the manual geofence override below —
// production always uses the backend office location (see AutoAttendanceBootstrap).
const DEFAULT_GEOFENCE = {
  latitude: 25.286106,
  longitude: 51.534817,
  radius: 100,
};

const MAX_LOG_ENTRIES = 20;

const formatTimestamp = (timestamp) =>
  timestamp ? format(new Date(timestamp), "dd MMM yyyy, HH:mm:ss") : "—";

const parseNumber = (text) => {
  const trimmed = String(text).trim();
  return trimmed === "" ? NaN : Number(trimmed);
};

const parseGeofenceInput = (latitudeText, longitudeText, radiusText) => {
  const latitude = parseNumber(latitudeText);
  const longitude = parseNumber(longitudeText);
  const radius = parseNumber(radiusText);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: "Latitude must be a number between -90 and 90." };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: "Longitude must be a number between -180 and 180." };
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return { error: "Radius must be a positive number of meters." };
  }
  return { latitude, longitude, radius };
};

function InfoRow({ label, value }) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-semibold text-gray-800">{value}</Text>
    </View>
  );
}

function InputRow({ label, value, onChangeText, editable }) {
  return (
    <View className="flex-row justify-between items-center py-1.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <TextInput
        className="text-sm font-semibold text-gray-800 bg-gray-100 rounded-lg px-3 py-1.5"
        style={{ minWidth: 160, textAlign: "right", opacity: editable ? 1 : 0.5 }}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType="numeric"
        autoCorrect={false}
        placeholderTextColor={COLORS.gray2}
      />
    </View>
  );
}

function SectionCard({ title, children }) {
  return (
    <View className="bg-white rounded-xl px-4 py-3 mb-4">
      <Text className="text-base font-semibold mb-1 text-gray-800">
        {title}
      </Text>
      {children}
    </View>
  );
}

// __DEV__-only radio row used to simulate each server geotagging policy.
function DevPolicyRow({ title, description, selected, onPress }) {
  return (
    <TouchableOpacity className="flex-row items-start py-2.5" onPress={onPress}>
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? COLORS.primary : COLORS.gray2}
        style={{ marginTop: 1 }}
      />
      <View className="ml-2.5 flex-1">
        <Text className="text-sm font-semibold text-gray-800">{title}</Text>
        <Text className="text-xs text-gray-500 mt-0.5">{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

// The three server-side policy values, ordered for the dev simulator.
const DEV_POLICY_OPTIONS = [
  GEOTAGGING.DISABLED,
  GEOTAGGING.WARNINGS_ONLY,
  GEOTAGGING.ALL_ACTIONS,
];

export default function AutoAttendanceScreen() {
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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Automatic Attendance",
      headerTitleAlign: "center",
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
        "[AutoAttendance] Failed to refresh geotagging policy:",
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
        foreground.status === "granted" && background.status === "granted",
      );
    } catch (error) {
      console.log(
        "[AutoAttendance] Failed to read permission status:",
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
          "Precise Location is off for this app. A 100 m geofence needs it to detect check-in/out reliably — turn it on in Settings > Privacy & Security > Location Services.",
        );
      } else if (isLowPowerModeEnabled()) {
        setReliabilityWarning(
          Platform.OS === "ios"
            ? "Low Power Mode is on. iOS may delay or suppress automatic check-in/out until it's turned off."
            : "Battery Saver is on. Android may delay or block automatic check-in/out until it's turned off.",
        );
      } else if (Platform.OS === "android" && !isIgnoringBatteryOptimizations()) {
        setReliabilityWarning(
          "Battery optimization is restricting this app. Open Settings > Apps > Claudion Checkin > Battery and choose \"Unrestricted\" so check-in/out keeps working in the background.",
        );
      } else {
        setReliabilityWarning(null);
      }
    } catch (error) {
      console.log("[AutoAttendance] Failed to read reliability status:", error);
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
      console.log("[AutoAttendance] Failed to read native state:", error);
    }
    refreshReliabilityStatus();
    refreshPermissionStatus();
    refreshGeotagging();

    const subscriptions = [
      addGeofenceEnterListener((event) => {
        console.log("[AutoAttendance] ENTER detected", event);
        setMonitoring(isMonitoring());
        setLastEvent(event);
        appendLog(event);
      }),
      addGeofenceExitListener((event) => {
        console.log("[AutoAttendance] EXIT detected", event);
        setMonitoring(isMonitoring());
        setLastEvent(event);
        appendLog(event);
      }),
      addErrorListener((event) => {
        console.log("[AutoAttendance] Geofence error", event);
        appendLog({ transition: "ERROR", ...event });
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
  ]);

  // Settings toggles and the policy itself can change outside this screen, and
  // monitoring can be (re)started by AutoAttendanceBootstrap in the background
  // — re-check everything on focus rather than only once on mount.
  useEffect(() => {
    if (!available) return undefined;
    return navigation.addListener("focus", () => {
      setMonitoring(isMonitoring());
      refreshReliabilityStatus();
      refreshPermissionStatus();
      refreshGeotagging();
    });
  }, [
    available,
    navigation,
    refreshReliabilityStatus,
    refreshPermissionStatus,
    refreshGeotagging,
  ]);

  const requestPermissions = async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== "granted") {
      console.log("[AutoAttendance] Permission denied (foreground location)");
      setPermissionError(
        "Location permission was denied. Allow location access to use automatic attendance.",
      );
      return false;
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== "granted") {
      console.log("[AutoAttendance] Permission denied (background location)");
      setPermissionError(
        'Background location was denied. Choose "Allow all the time" (Android) or "Always" (iOS) in system settings so check-in works when the app is closed.',
      );
      return false;
    }

    console.log("[AutoAttendance] Permission granted (fine + background)");
    setPermissionError(null);
    return true;
  };

  // The administrator sets the policy (server-side geotagging); this is the
  // user's own opt-in. Turning it on persists `userEnabled` (redux-persist),
  // so the service stays on across relaunches, then grants location permission
  // and registers the office geofence. AutoAttendanceBootstrap re-establishes
  // monitoring on every launch while `userEnabled` remains true, and owns the
  // ENTER/EXIT listeners that perform the real check-in/checkout.
  const handleToggleEnabled = async (value) => {
    if (busy) return;

    if (!value) {
      dispatch(setAutoAttendanceUserEnabled(false));
      setBusy(true);
      try {
        await stopGeofence();
        setMonitoring(false);
      } catch (error) {
        console.log("[AutoAttendance] Failed to stop monitoring:", error);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Persist the opt-in first, so it survives even if the user backgrounds the
    // app during the permission prompt.
    dispatch(setAutoAttendanceUserEnabled(true));

    setBusy(true);
    try {
      const granted = await requestPermissions();
      setPermissionGranted(granted);
      // Opt-in stays saved even if permission is declined — the user can grant
      // it later (or on the next launch) and monitoring resumes.
      if (!granted) return;

      // Secure notification permission + Android channel now, in the
      // foreground, so the automatic check-out alert can fire later from the
      // background. Non-blocking: monitoring still starts if the user declines.
      await ensureNotificationSetup();

      if (!employeeCode) {
        Alert.alert(
          "Not available yet",
          "Your employee record hasn't finished loading. Try again in a moment.",
        );
        return;
      }

      const nearest = await getOfficeLocation(employeeCode);
      if (!nearest) {
        Alert.alert(
          "No office location configured",
          "Your account has no reporting location set up. Contact HR/admin to enable automatic attendance.",
        );
        return;
      }

      await startGeofence({
        identifier: OFFICE_GEOFENCE_IDENTIFIER,
        latitude: nearest.latitude,
        longitude: nearest.longitude,
        radius: nearest.radius > 0 ? nearest.radius : 100,
      });
      setMonitoring(true);
      console.log("[AutoAttendance] Monitoring enabled", nearest);
    } catch (error) {
      console.log("[AutoAttendance] Failed to enable monitoring:", error);
      Alert.alert(
        "Could not turn on monitoring",
        error?.message || "Something went wrong.",
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
      Alert.alert("Invalid geofence", parsed.error);
      return;
    }
    const geofence = { ...parsed, identifier: OFFICE_GEOFENCE_IDENTIFIER };

    setBusy(true);
    try {
      const granted = await requestPermissions();
      if (!granted) return;

      await startGeofence(geofence);
      setMonitoring(true);
      console.log("[AutoAttendance] Monitoring started", geofence);
    } catch (error) {
      console.log("[AutoAttendance] Failed to start monitoring:", error);
      Alert.alert(
        "Could not start monitoring",
        error?.message || "Failed to register the geofence.",
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
      console.log("[AutoAttendance] Monitoring stopped");
    } catch (error) {
      console.log("[AutoAttendance] Failed to stop monitoring:", error);
      Alert.alert(
        "Could not stop monitoring",
        error?.message || "Failed to remove the geofence.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setBusy(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        console.log("[AutoAttendance] Permission denied (foreground location)");
        setPermissionError(
          "Location permission was denied. Allow location access to use automatic attendance.",
        );
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        Alert.alert(
          "Location is off",
          "Turn on Location in the device settings (on an emulator: Settings → Location).",
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
              () => reject(new Error("Timed out waiting for a GPS fix")),
              10000,
            ),
          ),
        ]);
      } catch (positionError) {
        console.log(
          "[AutoAttendance] getCurrentPosition failed, trying last known:",
          positionError?.message,
        );
        position = await Location.getLastKnownPositionAsync({
          maxAge: 600000,
        });
      }

      if (!position) {
        Alert.alert(
          "No location fix",
          'The device has no location yet. On an emulator, open Extended Controls (⋮ next to the emulator) → Location, pick a point and press "Set location", then try again. Opening Google Maps once also helps.',
        );
        return;
      }

      setLatitudeText(position.coords.latitude.toFixed(6));
      setLongitudeText(position.coords.longitude.toFixed(6));
      console.log(
        "[AutoAttendance] Filled inputs from current location",
        position.coords,
      );
    } catch (error) {
      console.log("[AutoAttendance] Failed to get current location:", error);
      Alert.alert(
        "Location error",
        error?.message || "Could not get the current location.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClearStatus = () => {
    try {
      clearLastEvent();
    } catch (error) {
      console.log("[AutoAttendance] Failed to clear native status:", error);
    }
    setLastEvent(null);
    setEventLog([]);
    console.log("[AutoAttendance] Status cleared");
  };

  // __DEV__ only: force a geotagging policy locally (bypassing the server) so
  // all three states can be exercised without an HR change. It dispatches into
  // the same Redux state the real policy uses, so AutoAttendanceBootstrap reacts
  // to it exactly as it would to a server value.
  const handleSimulatePolicy = (value) => {
    devPolicyOverrideRef.current = true;
    dispatch(setAutoAttendanceGeotagging(value));
    console.log("[AutoAttendance] Simulating geotagging policy", value);
  };

  const handleResetPolicy = () => {
    devPolicyOverrideRef.current = false;
    refreshGeotagging();
    console.log("[AutoAttendance] Reset to server geotagging policy");
  };

  if (!available) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: COLORS.white }}
        edges={["bottom"]}
      >
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons
            name="location-outline"
            size={SIZES.xxxLarge + 10}
            color={COLORS.gray}
          />
          <Text className="text-base text-center text-gray-500 mt-3">
            Automatic attendance needs a development or production build that
            includes the geofencing module. Rebuild the app to use it here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.offwhite }}
      edges={["bottom"]}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard title="Geotagging">
          <View className="flex-row items-center mb-2">
            <Ionicons
              name="lock-closed-outline"
              size={13}
              color={COLORS.gray}
            />
            <Text className="text-xs text-gray-400 ml-1">
              Set by your administrator
            </Text>
          </View>

          <View className="flex-row items-start">
            <Ionicons
              name={
                geotagging === GEOTAGGING.ALL_ACTIONS
                  ? "checkmark-circle"
                  : geotagging === GEOTAGGING.WARNINGS_ONLY
                    ? "alert-circle"
                    : "close-circle"
              }
              size={20}
              color={allowed ? COLORS.primary : COLORS.gray2}
              style={{ marginTop: 1 }}
            />
            <View className="ml-2.5 flex-1">
              <Text className="text-sm font-semibold text-gray-800">
                {policy.title}
              </Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                {policy.description}
              </Text>
            </View>
          </View>

          {allowed ? (
            <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-semibold text-gray-800">
                  Turn on automatic attendance
                </Text>
                <Text className="text-xs text-gray-500 mt-0.5">
                  Stays on across app restarts until you turn it off.
                </Text>
              </View>
              <Switch
                value={userEnabled}
                onValueChange={handleToggleEnabled}
                disabled={busy}
                trackColor={{ true: COLORS.primary }}
              />
            </View>
          ) : null}

          {allowed && userEnabled && !permissionGranted ? (
            <>
              <TouchableOpacity
                className="flex-row items-center justify-center mt-3 py-2.5 rounded-lg"
                style={{
                  backgroundColor: COLORS.primary,
                  opacity: busy ? 0.5 : 1,
                }}
                onPress={() => handleToggleEnabled(true)}
                disabled={busy}
              >
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={COLORS.white}
                />
                <Text className="text-sm font-semibold text-white ml-1.5">
                  Grant location access
                </Text>
              </TouchableOpacity>
              <Text className="text-xs text-gray-400 mt-2">
                Automatic attendance needs "Allow all the time" (Android) or
                "Always" (iOS) location access to work while the app is closed.
              </Text>
            </>
          ) : null}
        </SectionCard>

        <SectionCard title="Status">
          <View className="flex-row items-center py-1.5">
            <View
              className="h-3 w-3 rounded-full mr-2"
              style={{
                backgroundColor: monitoring ? "#22C55E" : COLORS.gray2,
              }}
            />
            <Text className="text-sm font-semibold text-gray-800">
              {monitoring ? "Monitoring" : "Not Monitoring"}
            </Text>
          </View>
          <InfoRow
            label="Automatic check-in/out"
            value={active && fullActions ? "On" : "Off"}
          />
          <InfoRow
            label="Last event"
            value={lastEvent?.transition || "None yet"}
          />
          <InfoRow
            label="Timestamp"
            value={formatTimestamp(lastEvent?.timestamp)}
          />
          {active && permissionError ? (
            <View className="flex-row items-start bg-red-50 rounded-lg px-3 py-2 mt-2">
              <Ionicons name="warning-outline" size={18} color="#DC2626" />
              <Text className="text-xs text-red-600 ml-2 flex-1">
                {permissionError}
              </Text>
            </View>
          ) : null}
          {active && reliabilityWarning ? (
            <View className="flex-row items-start bg-amber-50 rounded-lg px-3 py-2 mt-2">
              <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
              <Text className="text-xs ml-2 flex-1" style={{ color: "#B45309" }}>
                {reliabilityWarning}
              </Text>
            </View>
          ) : null}
        </SectionCard>

        {active ? (
          // Neither OS gives a reliable code-level signal for these, so this
          // is user education, not detection. iOS: a swipe-kill from the App
          // Switcher stops Core Location from relaunching the app for a
          // region crossing until it's reopened — locking the screen or Home
          // is fine. Android: swiping from Recents is fine (the OS can still
          // wake the app for the geofence broadcast); the real risks are an
          // explicit "Force stop" from Settings, or OEM battery management
          // (common on Xiaomi, Huawei, Oppo, Vivo, OnePlus, Samsung) killing
          // it in the background.
          <View className="bg-gray-100 rounded-lg px-3 py-2 mb-4">
            <View className="flex-row items-start">
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={COLORS.gray}
              />
              <Text className="text-xs text-gray-500 ml-2 flex-1">
                {Platform.OS === "ios"
                  ? "Don't swipe this app away from the App Switcher while monitoring — it stops automatic check-in/out until you reopen the app. Locking the screen or pressing Home is fine."
                  : "Don't \"Force stop\" this app from Settings while monitoring — it stops automatic check-in/out until you reopen the app. Swiping it away from Recents is fine. Also check your phone maker's battery settings (Xiaomi, Huawei, Oppo, Vivo, OnePlus, Samsung, etc. often restrict background apps by default)."}
              </Text>
            </View>
            {Platform.OS === "android" ? (
              <TouchableOpacity
                className="mt-2 self-start"
                onPress={() => Linking.openSettings()}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: COLORS.primary }}
                >
                  Open app settings
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {__DEV__ ? (
          <>
            <Text className="text-xs font-semibold text-gray-400 mb-2">
              DEVELOPER TESTING TOOLS (hidden in production builds)
            </Text>

            <SectionCard title="Simulate Policy">
              <Text className="text-xs text-gray-400 mb-1">
                Overrides the server geotagging value locally so you can test
                each state. Pauses the automatic server refresh until reset.
              </Text>
              {DEV_POLICY_OPTIONS.map((value) => (
                <DevPolicyRow
                  key={value}
                  title={GEOTAGGING_LABELS[value].title}
                  description={GEOTAGGING_LABELS[value].description}
                  selected={geotagging === value}
                  onPress={() => handleSimulatePolicy(value)}
                />
              ))}
              <TouchableOpacity
                className="mt-1 self-start"
                onPress={handleResetPolicy}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: COLORS.primary }}
                >
                  Reset to server policy
                </Text>
              </TouchableOpacity>
            </SectionCard>

            <SectionCard title="Manual Geofence Override">
              <InputRow
                label="Latitude"
                value={latitudeText}
                onChangeText={setLatitudeText}
                editable={!monitoring && !busy}
              />
              <InputRow
                label="Longitude"
                value={longitudeText}
                onChangeText={setLongitudeText}
                editable={!monitoring && !busy}
              />
              <InputRow
                label="Radius (m)"
                value={radiusText}
                onChangeText={setRadiusText}
                editable={!monitoring && !busy}
              />
              <InfoRow label="Identifier" value={OFFICE_GEOFENCE_IDENTIFIER} />
              {monitoring ? (
                <Text className="text-xs text-gray-400 mt-1">
                  Stop monitoring to change the location.
                </Text>
              ) : (
                <TouchableOpacity
                  className="flex-row items-center justify-center mt-2 py-2 rounded-lg bg-gray-100"
                  style={{ opacity: busy ? 0.5 : 1 }}
                  onPress={handleUseCurrentLocation}
                  disabled={busy}
                >
                  <Ionicons
                    name="locate-outline"
                    size={16}
                    color={COLORS.primary}
                  />
                  <Text
                    className="text-sm font-semibold ml-1.5"
                    style={{ color: COLORS.primary }}
                  >
                    Use my current location
                  </Text>
                </TouchableOpacity>
              )}
              <Text className="text-xs text-gray-400 mt-2">
                Overrides the office geofence with these coordinates. Note: if
                the policy above is "all attendance actions", crossing this
                manual fence will still trigger the real check-in/checkout API
                — this is the same listener, not a separate sandbox.
              </Text>
            </SectionCard>

            <TouchableOpacity
              className="rounded-xl py-3.5 items-center mb-3"
              style={{
                backgroundColor: COLORS.primary,
                opacity: busy || monitoring ? 0.5 : 1,
              }}
              onPress={handleStart}
              disabled={busy || monitoring}
            >
              <Text className="text-white text-base font-semibold">
                Start Monitoring
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="rounded-xl py-3.5 items-center mb-3"
              style={{
                backgroundColor: COLORS.primary2,
                opacity: busy || !monitoring ? 0.5 : 1,
              }}
              onPress={handleStop}
              disabled={busy || !monitoring}
            >
              <Text className="text-white text-base font-semibold">
                Stop Monitoring
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="rounded-xl py-3.5 items-center mb-4 bg-white"
              onPress={handleClearStatus}
              disabled={busy}
            >
              <Text
                className="text-base font-semibold"
                style={{ color: COLORS.primary }}
              >
                Clear Status
              </Text>
            </TouchableOpacity>

            <SectionCard title="Event Log">
              {eventLog.length === 0 ? (
                <Text className="text-sm text-gray-400 py-1.5">
                  No events received in this session.
                </Text>
              ) : (
                eventLog.map((entry) => (
                  <View
                    key={`${entry.transition}-${entry.receivedAt}`}
                    className="flex-row justify-between items-center py-1.5 border-b border-gray-100"
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{
                        color:
                          entry.transition === "ENTER"
                            ? "#16A34A"
                            : entry.transition === "EXIT"
                              ? "#DC2626"
                              : COLORS.primary2,
                      }}
                    >
                      {entry.transition}
                      {entry.message ? ` — ${entry.message}` : ""}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {formatTimestamp(entry.timestamp || entry.receivedAt)}
                    </Text>
                  </View>
                ))
              )}
            </SectionCard>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
