import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import Entypo from "@expo/vector-icons/Entypo";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { format } from "date-fns";
import { COLORS, SIZES } from "../constants";
import {
  addErrorListener,
  addGeofenceEnterListener,
  addGeofenceExitListener,
  clearLastEvent,
  getLastEvent,
  getRegisteredGeofences,
  isAvailable,
  isMonitoring,
  startGeofence,
  stopGeofence,
} from "../modules/expo-auto-attendance";

// Default test values — editable on screen. Later the geofence will come from
// the backend (employee_locations), like the existing location-restricted check-in.
const DEFAULT_GEOFENCE = {
  latitude: 25.286106,
  longitude: 51.534817,
  radius: 100,
  identifier: "office-main",
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

export default function AutoAttendanceScreen() {
  const navigation = useNavigation();
  const available = isAvailable();

  const [monitoring, setMonitoring] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const [permissionError, setPermissionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [latitudeText, setLatitudeText] = useState(
    String(DEFAULT_GEOFENCE.latitude),
  );
  const [longitudeText, setLongitudeText] = useState(
    String(DEFAULT_GEOFENCE.longitude),
  );
  const [radiusText, setRadiusText] = useState(String(DEFAULT_GEOFENCE.radius));

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

  // Load native state + subscribe to geofence events.
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

    const subscriptions = [
      addGeofenceEnterListener((event) => {
        console.log("[AutoAttendance] ENTER detected", event);
        setLastEvent(event);
        appendLog(event);
      }),
      addGeofenceExitListener((event) => {
        console.log("[AutoAttendance] EXIT detected", event);
        setLastEvent(event);
        appendLog(event);
      }),
      addErrorListener((event) => {
        console.log("[AutoAttendance] Geofence error", event);
        appendLog({ transition: "ERROR", ...event });
      }),
    ];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [available, appendLog]);

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

  const handleStart = async () => {
    const parsed = parseGeofenceInput(latitudeText, longitudeText, radiusText);
    if (parsed.error) {
      Alert.alert("Invalid geofence", parsed.error);
      return;
    }
    const geofence = { ...parsed, identifier: DEFAULT_GEOFENCE.identifier };

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
        <SectionCard title="Office Location">
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
          <InfoRow label="Identifier" value={DEFAULT_GEOFENCE.identifier} />
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
            label="Last event"
            value={lastEvent?.transition || "None yet"}
          />
          <InfoRow
            label="Timestamp"
            value={formatTimestamp(lastEvent?.timestamp)}
          />
          {permissionError ? (
            <View className="flex-row items-start bg-red-50 rounded-lg px-3 py-2 mt-2">
              <Ionicons name="warning-outline" size={18} color="#DC2626" />
              <Text className="text-xs text-red-600 ml-2 flex-1">
                {permissionError}
              </Text>
            </View>
          ) : null}
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
      </ScrollView>
    </SafeAreaView>
  );
}
