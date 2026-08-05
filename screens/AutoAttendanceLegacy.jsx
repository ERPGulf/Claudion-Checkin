import React, { useLayoutEffect } from "react";
import {
  ActivityIndicator,
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
import Entypo from "@expo/vector-icons/Entypo";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SIZES } from "../constants";
import {
  GEOTAGGING,
  GEOTAGGING_LABELS,
} from "../redux/Slices/AutoAttendanceSlice";
import useAutoAttendance from "../hooks/useAutoAttendance";
import {
  DEV_POLICY_OPTIONS,
  formatDistance,
  formatTimestamp,
} from "../utils/autoAttendance";

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

// At-a-glance card telling the user whether they're currently inside or outside
// the office boundary, plus the info that makes the automatic check-in/out
// understandable: which office, how far, the boundary size, whether monitoring
// is running, and the last entry/exit. `presence` is null until a fix + a
// registered fence are both available.
function PresenceCard({
  presence,
  loading,
  monitoring,
  permissionGranted,
  lastEvent,
  onRefresh,
}) {
  const known = presence != null;
  const inside = presence?.withinRadius === true;

  const accent = !known ? COLORS.gray : inside ? "#16A34A" : "#B45309";
  const background = !known ? "#F3F4F6" : inside ? "#ECFDF5" : "#FFFBEB";
  const icon = !known
    ? "help-circle-outline"
    : inside
      ? "business"
      : "navigate-outline";

  let title;
  let subtitle;
  if (loading && !known) {
    title = "Checking your location…";
    subtitle = "Reading your current position";
  } else if (!known) {
    title = "Location unavailable";
    subtitle = permissionGranted
      ? "No location fix or office boundary yet — tap refresh to retry."
      : "Grant location access to see whether you're at the office.";
  } else if (inside) {
    title = "You're at the office";
    subtitle = `Inside the ${formatDistance(presence.radius)} boundary`;
  } else {
    title = "You're away from the office";
    subtitle = `About ${formatDistance(presence.distance)} from the office`;
  }

  return (
    <View
      className="rounded-xl px-4 py-4 mb-4"
      style={{ backgroundColor: background }}
    >
      <View className="flex-row items-center">
        <View
          className="h-11 w-11 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: accent }}
        >
          <Ionicons name={icon} size={22} color={COLORS.white} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-bold" style={{ color: accent }}>
            {title}
          </Text>
          <Text className="text-xs text-gray-500 mt-0.5">{subtitle}</Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          disabled={loading}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {loading ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <Ionicons name="refresh" size={20} color={accent} />
          )}
        </TouchableOpacity>
      </View>

      {known ? (
        <View
          className="mt-3 pt-3 border-t"
          style={{ borderColor: "rgba(0,0,0,0.06)" }}
        >
          <InfoRow label="Nearest office" value={presence.locationName || "Your office"} />
          <InfoRow label="Distance to office" value={formatDistance(presence.distance)} />
          <InfoRow label="Boundary radius" value={formatDistance(presence.radius)} />
          <InfoRow label="Monitoring" value={monitoring ? "Active" : "Paused"} />
          <InfoRow
            label="Last change"
            value={
              lastEvent?.transition
                ? `${lastEvent.transition === "ENTER" ? "Arrived" : "Left"} · ${formatTimestamp(lastEvent.timestamp)}`
                : "None yet"
            }
          />
        </View>
      ) : null}
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

/**
 * Classic Automatic Attendance — the original screen, kept for users on Classic UI.
 *
 * Presentation is unchanged from before the redesign: same white SectionCards,
 * same InfoRow/InputRow text lists, same PresenceCard, same chevron header, same
 * dev-only testing block. The only edit is that the state, the native listeners
 * and the handlers now come from useAutoAttendance() instead of being declared
 * inline, so this screen and the modern one can never disagree about geofencing,
 * monitoring or permissions.
 *
 * Do not restyle this file. It is the before-picture in an A/B comparison.
 */
export default function AutoAttendanceScreen() {
  const navigation = useNavigation();

  const {
    available,
    identifier,
    geotagging,
    policy,
    allowed,
    userEnabled,
    active,
    fullActions,
    monitoring,
    permissionGranted,
    lastEvent,
    eventLog,
    permissionError,
    reliabilityWarning,
    busy,
    presence,
    presenceLoading,
    latitudeText,
    setLatitudeText,
    longitudeText,
    setLongitudeText,
    radiusText,
    setRadiusText,
    refreshPresence,
    handleToggleEnabled,
    handleStart,
    handleStop,
    handleUseCurrentLocation,
    handleClearStatus,
    handleSimulatePolicy,
    handleResetPolicy,
  } = useAutoAttendance();

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
        {active || monitoring ? (
          <PresenceCard
            presence={presence}
            loading={presenceLoading}
            monitoring={monitoring}
            permissionGranted={permissionGranted}
            lastEvent={lastEvent}
            onRefresh={refreshPresence}
          />
        ) : null}

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
              <InfoRow label="Identifier" value={identifier} />
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
