import React from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useAutoAttendance from "../hooks/useAutoAttendance";
import { GEOTAGGING_LABELS } from "../redux/Slices/AutoAttendanceSlice";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import PressableScale from "../components/common/PressableScale";
import SectionHeader from "../components/common/SectionHeader";
import SettingsRow, { RowDivider } from "../components/common/SettingsRow";
import StatusBanner from "../components/common/StatusBanner";
import {
  CollapsibleCard,
  CoordinateField,
  EventLogItem,
  PolicyOption,
  StatusBadge,
} from "../components/AutoAttendance";
import {
  DEV_POLICY_OPTIONS,
  MAX_LOG_ENTRIES,
  describeAutomatic,
  describeMonitoring,
  describePolicy,
  describePresence,
  describeTransition,
  formatDistance,
  formatTimestamp,
} from "../utils/autoAttendance";

/**
 * A labelled group inside the developer card. Typography carries the hierarchy —
 * a nested card per group would have meant cards three deep.
 */
function DevGroup({ title, subtitle, children, showDivider = true }) {
  const { colors } = useAppTheme();

  return (
    <View>
      <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>
        {title}
      </Text>
      {!!subtitle && (
        <Text
          style={{
            ...TYPO.caption,
            color: colors.textMuted,
            marginTop: 1,
            marginBottom: SPACING.sm,
          }}
        >
          {subtitle}
        </Text>
      )}

      {children}

      {showDivider && (
        <View
          style={{
            height: 1,
            backgroundColor: colors.dividerSubtle,
            marginVertical: SPACING.md,
          }}
        />
      )}
    </View>
  );
}

/**
 * Modern Automatic Attendance.
 *
 * Presentation only — the Redux policy, the native geofence listeners, the focus
 * re-checks, the permission flow and all seven handlers live in
 * hooks/useAutoAttendance.js, shared byte-for-byte with AutoAttendanceLegacy.
 * Nothing here starts a fence, requests a permission or calls an API.
 *
 * Shape: an overview card answering "am I at the office and is this working",
 * then the two things a user can actually act on (the administrator's policy and
 * their own opt-in), then live status. The developer tools — most of the screen's
 * height and none of its everyday value — fold into one collapsed card at the
 * bottom, so the page opens on the part people came for.
 *
 * Every state string resolves through the `describe*` helpers, so a badge cannot
 * end up with a success tint and an error label.
 */
function AutoAttendance() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Automatic Attendance");

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

  const page = { flex: 1, backgroundColor: colors.surfaceSecondary };

  // The module is missing from Expo Go and from any build made before it was
  // added — same condition the classic screen checks, same explanation.
  if (!available) {
    return (
      <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
        <View style={{ padding: SPACING.lg }}>
          <Card>
            <EmptyState
              icon="hardware-chip-outline"
              title="Not available in this build"
              description="Automatic attendance needs a development or production build that includes the geofencing module. Rebuild the app to use it here."
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const presenceState = describePresence(presence, presenceLoading);
  const monitoringState = describeMonitoring(monitoring);
  const automaticState = describeAutomatic(active, fullActions);
  const transitionState = describeTransition(lastEvent?.transition);
  const policyState = describePolicy(geotagging);
  const known = presence != null;

  const headline = (() => {
    if (presenceLoading && !known) return "Checking your location…";
    if (!known) {
      return permissionGranted ? "Location unavailable" : "Location access needed";
    }
    return presence.withinRadius
      ? "You're at the office"
      : "You're away from the office";
  })();

  const supporting = (() => {
    if (presenceLoading && !known) return "Reading your current position.";
    if (!known) {
      return permissionGranted
        ? "No location fix or office boundary yet."
        : "Grant location access to see whether you're at the office.";
    }
    return presence.withinRadius
      ? `Inside the ${formatDistance(presence.radius)} boundary.`
      : `About ${formatDistance(presence.distance)} away.`;
  })();

  return (
    <SafeAreaView style={page} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{
          padding: SPACING.lg,
          paddingBottom: SPACING.xxxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---------- Overview ---------- */}
        <Card style={{ padding: SPACING.md }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: RADIUS.md,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor:
                  colors[`${presenceState.tone}Border`] || colors.cardBorder,
                backgroundColor:
                  colors[`${presenceState.tone}Surface`] ||
                  colors.neutralSurface,
                marginEnd: SPACING.md,
              }}
            >
              <Ionicons
                name={presenceState.icon}
                size={ICON.md}
                color={
                  colors[`${presenceState.tone}Text`] || colors.textSecondary
                }
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.title3, color: colors.textPrimary }}
              >
                {headline}
              </Text>
              <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                {supporting}
              </Text>
            </View>

            {active || monitoring ? (
              <PressableScale
                onPress={refreshPresence}
                disabled={presenceLoading}
                accessibilityLabel="Refresh location"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: RADIUS.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.iconBackground,
                  marginStart: SPACING.sm,
                }}
              >
                {presenceLoading ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : (
                  <Ionicons
                    name="refresh"
                    size={ICON.sm}
                    color={colors.textPrimary}
                  />
                )}
              </PressableScale>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: SPACING.md,
            }}
          >
            <StatusBadge
              tone={monitoringState.tone}
              label={monitoringState.label}
              dot
              style={{ marginEnd: SPACING.sm, marginBottom: SPACING.xs }}
            />
            <StatusBadge
              tone={policyState.tone}
              label={policyState.label}
              icon={policyState.icon}
              style={{ marginEnd: SPACING.sm, marginBottom: SPACING.xs }}
            />
            {known ? (
              <StatusBadge
                tone="neutral"
                label={`${formatDistance(presence.distance)} away`}
                icon="navigate-outline"
                style={{ marginBottom: SPACING.xs }}
              />
            ) : null}
          </View>
        </Card>

        {/* ---------- Geotagging ---------- */}
        <SectionHeader
          title="Geotagging"
          subtitle="Set by your administrator"
          style={{ marginTop: SPACING.xl }}
        />

        <Card>
          <SettingsRow
            size="comfortable"
            icon={policyState.icon}
            iconTint={colors[`${policyState.tone}Surface`]}
            iconColor={colors[`${policyState.tone}Text`]}
            title={policy.title}
            description={policy.description}
          >
            <StatusBadge tone={policyState.tone} label={policyState.label} />
          </SettingsRow>

          {allowed ? (
            <>
              <RowDivider size="comfortable" />
              <SettingsRow
                size="comfortable"
                icon="walk-outline"
                title="Automatic attendance"
                description="Stays on across app restarts until you turn it off."
              >
                <Switch
                  value={userEnabled}
                  onValueChange={handleToggleEnabled}
                  disabled={busy}
                  trackColor={{ true: colors.primary2 }}
                  accessibilityLabel="Turn on automatic attendance"
                />
              </SettingsRow>
            </>
          ) : null}
        </Card>

        {allowed && userEnabled && !permissionGranted ? (
          <>
            <ActionButton
              label="Grant location access"
              icon="location-outline"
              variant="filled"
              size="md"
              loading={busy}
              disabled={busy}
              onPress={() => handleToggleEnabled(true)}
              style={{ marginTop: SPACING.md }}
            />
            <Text
              style={{
                ...TYPO.caption,
                color: colors.textMuted,
                marginTop: SPACING.sm,
              }}
            >
              Automatic attendance needs &quot;Allow all the time&quot; (Android)
              or &quot;Always&quot; (iOS) location access to work while the app is
              closed.
            </Text>
          </>
        ) : null}

        {/* ---------- Status ---------- */}
        <SectionHeader
          title="Status"
          subtitle="What the monitoring service is doing right now"
          style={{ marginTop: SPACING.xl }}
        />

        <Card>
          <SettingsRow size="comfortable" icon="radio-outline" title="Monitoring">
            <StatusBadge
              tone={monitoringState.tone}
              label={monitoringState.label}
              dot
            />
          </SettingsRow>
          <RowDivider size="comfortable" />
          <SettingsRow
            size="comfortable"
            icon="flash-outline"
            title="Automatic check-in/out"
          >
            <StatusBadge
              tone={automaticState.tone}
              label={automaticState.label}
            />
          </SettingsRow>
          <RowDivider size="comfortable" />
          <SettingsRow
            size="comfortable"
            icon="swap-vertical-outline"
            title="Last event"
          >
            <StatusBadge
              tone={transitionState.tone}
              label={transitionState.label}
              icon={transitionState.icon}
            />
          </SettingsRow>
          <RowDivider size="comfortable" />
          <SettingsRow
            size="comfortable"
            icon="time-outline"
            title="Last update"
            value={formatTimestamp(lastEvent?.timestamp)}
          />
        </Card>

        {active && permissionError ? (
          <StatusBanner
            tone="error"
            title="Location permission needed"
            message={permissionError}
            style={{ marginTop: SPACING.md }}
          />
        ) : null}

        {active && reliabilityWarning ? (
          <StatusBanner
            tone="warning"
            title="Monitoring may be delayed"
            message={reliabilityWarning}
            style={{ marginTop: SPACING.md }}
          />
        ) : null}

        {active ? (
          // Neither OS gives a reliable code-level signal for these, so this is
          // user education, not detection. iOS: a swipe-kill from the App
          // Switcher stops Core Location from relaunching the app for a region
          // crossing until it's reopened — locking the screen or Home is fine.
          // Android: swiping from Recents is fine (the OS can still wake the app
          // for the geofence broadcast); the real risks are an explicit "Force
          // stop" from Settings, or OEM battery management (common on Xiaomi,
          // Huawei, Oppo, Vivo, OnePlus, Samsung) killing it in the background.
          <>
            <StatusBanner
              tone="info"
              title="Keep the app running"
              message={
                Platform.OS === "ios"
                  ? "Don't swipe this app away from the App Switcher while monitoring — it stops automatic check-in/out until you reopen the app. Locking the screen or pressing Home is fine."
                  : "Don't \"Force stop\" this app from Settings while monitoring — it stops automatic check-in/out until you reopen the app. Swiping it away from Recents is fine. Also check your phone maker's battery settings (Xiaomi, Huawei, Oppo, Vivo, OnePlus, Samsung, etc. often restrict background apps by default)."
              }
              style={{ marginTop: SPACING.md }}
            />
            {Platform.OS === "android" ? (
              <ActionButton
                label="Open app settings"
                icon="settings-outline"
                variant="outline"
                size="md"
                onPress={() => Linking.openSettings()}
                style={{ marginTop: SPACING.sm }}
              />
            ) : null}
          </>
        ) : null}

        {/* ---------- Developer tools (dev builds only) ---------- */}
        {__DEV__ ? (
          <CollapsibleCard
            icon="construct-outline"
            title="Developer Tools"
            subtitle="Hidden in production builds"
            badgeLabel="Debug only"
            badgeTone="warning"
            style={{ marginTop: SPACING.xl }}
          >
            <DevGroup
              title="Policy simulation"
              subtitle="Overrides the server geotagging value locally so you can test each state. Pauses the automatic server refresh until reset."
            >
              {DEV_POLICY_OPTIONS.map((value, index) => (
                <PolicyOption
                  key={value}
                  title={GEOTAGGING_LABELS[value].title}
                  description={GEOTAGGING_LABELS[value].description}
                  selected={geotagging === value}
                  onPress={() => handleSimulatePolicy(value)}
                  showDivider={index < DEV_POLICY_OPTIONS.length - 1}
                />
              ))}
              <ActionButton
                label="Reset to server policy"
                icon="cloud-download-outline"
                variant="outline"
                size="md"
                onPress={handleResetPolicy}
                style={{ marginTop: SPACING.md }}
              />
            </DevGroup>

            <DevGroup
              title="Manual geofence override"
              subtitle="Replaces the office geofence with these coordinates."
            >
              <View style={{ flexDirection: "row" }}>
                <CoordinateField
                  label="Latitude"
                  value={latitudeText}
                  onChangeText={setLatitudeText}
                  editable={!monitoring && !busy}
                />
                <View style={{ width: SPACING.sm }} />
                <CoordinateField
                  label="Longitude"
                  value={longitudeText}
                  onChangeText={setLongitudeText}
                  editable={!monitoring && !busy}
                />
              </View>

              <View style={{ marginTop: SPACING.md }}>
                <CoordinateField
                  label="Radius (metres)"
                  value={radiusText}
                  onChangeText={setRadiusText}
                  editable={!monitoring && !busy}
                  hint={`Identifier: ${identifier}`}
                />
              </View>

              {monitoring ? (
                <Text
                  style={{
                    ...TYPO.caption,
                    color: colors.textMuted,
                    marginTop: SPACING.sm,
                  }}
                >
                  Stop monitoring to change the location.
                </Text>
              ) : (
                <ActionButton
                  label="Use my current location"
                  icon="locate-outline"
                  variant="outline"
                  size="md"
                  loading={busy}
                  disabled={busy}
                  onPress={handleUseCurrentLocation}
                  style={{ marginTop: SPACING.md }}
                />
              )}

              <StatusBanner
                tone="warning"
                title="This is not a sandbox"
                message={'If the policy above is "all attendance actions", crossing this manual fence still triggers the real check-in/checkout API — it is the same listener.'}
                style={{ marginTop: SPACING.md }}
              />
            </DevGroup>

            <DevGroup
              title="Monitoring controls"
              subtitle="Registers the fence above directly, bypassing the bootstrap."
            >
              <ActionButton
                label="Start monitoring"
                icon="play-outline"
                variant="filled"
                size="md"
                disabled={busy || monitoring}
                onPress={handleStart}
              />
              <ActionButton
                label="Stop monitoring"
                icon="stop-outline"
                variant="tinted"
                tone="error"
                size="md"
                disabled={busy || !monitoring}
                onPress={handleStop}
                style={{ marginTop: SPACING.sm }}
              />
              <ActionButton
                label="Clear status"
                icon="trash-outline"
                variant="outline"
                size="md"
                disabled={busy}
                onPress={handleClearStatus}
                style={{ marginTop: SPACING.sm }}
              />
            </DevGroup>

            <DevGroup
              title="Event log"
              subtitle={`Geofence events received this session (newest first, max ${MAX_LOG_ENTRIES}).`}
              showDivider={false}
            >
              {eventLog.length === 0 ? (
                <EmptyState
                  compact
                  icon="pulse-outline"
                  title="No events yet"
                  description="Cross the geofence boundary, or start monitoring, to see events appear here."
                />
              ) : (
                eventLog.map((entry, index) => (
                  <EventLogItem
                    key={`${entry.transition}-${entry.receivedAt}`}
                    entry={entry}
                    isLast={index === eventLog.length - 1}
                  />
                ))
              )}
            </DevGroup>
          </CollapsibleCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default AutoAttendance;
