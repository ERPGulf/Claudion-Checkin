import React, { useRef, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useAttendanceAction from "../hooks/useAttendanceAction";
import Card from "../components/common/Card";
import PressableScale from "../components/common/PressableScale";
import ActionButton from "../components/common/ActionButton";
import SectionHeader from "../components/common/SectionHeader";
import SettingsRow, { RowDivider } from "../components/common/SettingsRow";
import StatusBanner from "../components/common/StatusBanner";
import BottomSheet from "../components/common/BottomSheet";
import FormField from "../components/common/FormField";
import StatusCard from "../components/AttendanceAction/StatusCard";
import BreakClock from "../components/AttendanceAction/BreakClock";
import { SESSION_ORIGIN } from "../utils/attendanceSessionState";

/** Break presets, previously nine hand-styled buttons in six different colours. */
const DEV_BREAK_PRESETS = [
  { key: "idle-0", label: "Idle 00:00" },
  { key: "idle-45", label: "Idle 00:45" },
  { key: "running-30", label: "Running +30m" },
  { key: "cap-120", label: "Cap 02:00" },
  { key: "completed", label: "Completed 1/day" },
  { key: "monthly-cap", label: "Monthly Cap 8h" },
];

function AttendanceAction() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const [devOpen, setDevOpen] = useState(false);

  // Break reason — collected when a break is started, optional throughout.
  const [isBreakSheetVisible, setBreakSheetVisible] = useState(false);
  const [breakReasonInput, setBreakReasonInput] = useState("");
  // Which button started the in-flight request, so only that one spins. Both
  // stay disabled while `actionLoading`, so a double tap is still impossible.
  const tapRef = useRef(null);

  const {
    checkin,
    sessionOrigin,
    autoActionsEnabled,
    dateTime,
    restrictLocation,
    restrictionLoaded,
    allowCheckoutAnywhere,
    inTarget,
    ready,
    distanceInfo,
    onBreak,
    breakStartTime,
    breakMinutes,
    breakCompleted,
    breakFeatureEnabled,
    monthlyCapMessage,
    actionLoading,
    refresh,
    setRefresh,
    fetchStatusAndLocation,
    handlePrimaryAction,
    handleBreak,
    devBreakMockMode,
    setDevBreakMockMode,
    applyDevBreakPreset,
    handleInvalidateAccessToken,
  } = useAttendanceAction();

  useModernScreenHeader("Attendance Action");

  // Identical gating to the classic screen — only the presentation differs.
  const checkoutBlocked =
    restrictLocation === 1 && !inTarget && !allowCheckoutAnywhere;
  // The rule decides the label; a request in flight only disables the button.
  // Folding `actionLoading` into the rule made every check-in/out read
  // "Break not allowed" for the length of the request.
  const breakUnavailable =
    (restrictLocation === 1 && !inTarget) ||
    breakCompleted ||
    breakMinutes >= 120;
  const breakBlocked = actionLoading || breakUnavailable;

  const locationValue =
    restrictLocation === 0
      ? "Not Required"
      : !ready
        ? "Getting Location..."
        : inTarget
          ? "In bound"
          : "Out of bound";

  // A local AsyncStorage read, over in a frame or two. A spinner and "Loading
  // settings..." here only flashed on every visit; a blank page does not.
  if (!restrictionLoaded) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
        edges={["bottom", "left", "right"]}
      />
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: Math.max(insets.bottom, SPACING.lg) + SPACING.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            tintColor={colors.textMuted}
            onRefresh={() => {
              setRefresh(true);
              fetchStatusAndLocation().finally(() => setRefresh(false));
            }}
          />
        }
      >
        {/* -------------------- BREAK IN PROGRESS -------------------- */}
        {onBreak && (
          <Card
            padded
            style={{
              marginBottom: SPACING.lg,
              backgroundColor: colors.warningSurface,
              borderColor: colors.warningBorder,
            }}
          >
            <Text
              style={{
                ...TYPO.caption2,
                fontWeight: "700",
                letterSpacing: 1.2,
                textAlign: "center",
                color: colors.warningText,
              }}
            >
              BREAK IN PROGRESS
            </Text>
            <Text
              style={{
                ...TYPO.title1,
                textAlign: "center",
                color: colors.textPrimary,
                marginTop: SPACING.xs,
                fontVariant: ["tabular-nums"],
              }}
            >
              <BreakClock startTime={breakStartTime} />
            </Text>
            <Text
              style={{
                ...TYPO.caption,
                textAlign: "center",
                color: colors.textMuted,
                marginTop: SPACING.xs,
              }}
            >
              Auto-ends at 02:00:00
            </Text>
          </Card>
        )}

        {/* -------------------- STATUS -------------------- */}
        <StatusCard onBreak={onBreak} breakStartTime={breakStartTime} />

        {checkin && autoActionsEnabled && (
          <StatusBanner
            tone="success"
            title="Automatic checkout is enabled"
            message={
              sessionOrigin === SESSION_ORIGIN.AUTO
                ? "Checked in automatically. You'll be checked out when you leave the office."
                : "You'll be checked out automatically when you leave the office."
            }
            style={{ marginTop: SPACING.lg }}
          />
        )}

        {/* -------------------- SESSION DETAILS -------------------- */}
        <SectionHeader
          title="Session details"
          style={{ marginTop: SPACING.xxl }}
        />

        <Card>
          <SettingsRow
            icon="calendar-outline"
            title="Date and time"
            value={dateTime}
          />
          <RowDivider />
          <SettingsRow
            icon="location-outline"
            iconTint={
              restrictLocation === 1 && !inTarget
                ? colors.errorSurface
                : colors.iconBackground
            }
            iconColor={
              restrictLocation === 1 && !inTarget
                ? colors.errorText
                : colors.textPrimary
            }
            title="Location"
            description={
              restrictLocation === 1 && distanceInfo
                ? `Distance: ${distanceInfo.distance} m | Allowed: ${distanceInfo.radius} m`
                : undefined
            }
            value={locationValue}
          />
        </Card>

        {/* -------------------- ACTIONS -------------------- */}
        <View style={{ marginTop: SPACING.xxl }}>
          <ActionButton
            size="lg"
            elevated
            icon={checkin ? "log-out-outline" : "log-in-outline"}
            label={checkin ? "Check out" : "Check in"}
            onPress={() => {
              tapRef.current = "primary";
              handlePrimaryAction();
            }}
            loading={actionLoading && tapRef.current === "primary"}
            disabled={checkoutBlocked || actionLoading}
          />

          {checkoutBlocked && (
            <>
              <StatusBanner
                tone="warning"
                title="You're outside the allowed area"
                message="Move within the office radius to record this action."
                style={{ marginTop: SPACING.md }}
              />
              {/* Location is otherwise only read on mount and pull-to-refresh,
                  so walking into the office left this screen stuck here. */}
              <ActionButton
                variant="outline"
                icon="locate-outline"
                label="Check my location again"
                loading={!ready}
                onPress={fetchStatusAndLocation}
                style={{ marginTop: SPACING.sm }}
              />
            </>
          )}

          {/* Hidden, not disabled, when the tenant has breaks switched off: a
              greyed-out "Break not allowed" button reads as a rule the employee
              has hit, when in fact the feature does not exist for them. */}
          {checkin && breakFeatureEnabled && (
            <>
              <ActionButton
                size="lg"
                variant="outline"
                icon={
                  breakUnavailable
                    ? "cafe-outline"
                    : onBreak
                      ? "play-outline"
                      : "cafe-outline"
                }
                label={
                  breakUnavailable
                    ? "Break not allowed"
                    : onBreak
                      ? "End break"
                      : "Take break"
                }
                onPress={() => {
                  // A reason is asked for when starting a break and never when
                  // ending one — the same rule the classic screen follows.
                  if (onBreak) {
                    tapRef.current = "break";
                    handleBreak();
                  } else {
                    setBreakReasonInput("");
                    setBreakSheetVisible(true);
                  }
                }}
                loading={actionLoading && tapRef.current === "break"}
                disabled={breakBlocked}
                style={{ marginTop: SPACING.lg }}
              />

              {!!monthlyCapMessage && (
                <StatusBanner
                  tone="error"
                  message={monthlyCapMessage}
                  style={{ marginTop: SPACING.md }}
                />
              )}
            </>
          )}
        </View>

        {/* -------------------- DEVELOPER TOOLS -------------------- */}
        {__DEV__ && (
          <>
            <SectionHeader
              title="Developer tools"
              subtitle="Debug builds only — never shipped to users."
              style={{ marginTop: SPACING.xxl }}
            />

            <Card>
              <SettingsRow
                icon="construct-outline"
                iconTint={colors.warningSurface}
                iconColor={colors.warningText}
                title="Developer tools"
                description={devOpen ? "Tap to collapse" : "Tap to expand"}
                onPress={() => setDevOpen((open) => !open)}
              >
                <Ionicons
                  name={devOpen ? "chevron-up" : "chevron-down"}
                  size={ICON.md}
                  color={colors.textMuted}
                />
              </SettingsRow>

              {devOpen && (
                <View
                  style={{
                    paddingHorizontal: SPACING.lg,
                    paddingBottom: SPACING.lg,
                  }}
                >
                  <ActionButton
                    variant="tinted"
                    tone="error"
                    icon="key-outline"
                    label="DEV: Invalidate access token"
                    onPress={handleInvalidateAccessToken}
                  />

                  <PressableScale
                    onPress={() => setDevBreakMockMode((prev) => !prev)}
                    scaleTo={0.98}
                    hitSlop={0}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: devBreakMockMode }}
                    accessibilityLabel="DEV local break flow"
                    style={{
                      marginTop: SPACING.md,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: SPACING.md,
                      height: 44,
                      borderRadius: RADIUS.md,
                      borderWidth: 1,
                      borderColor: devBreakMockMode
                        ? colors.successBorder
                        : colors.cardBorder,
                      backgroundColor: devBreakMockMode
                        ? colors.successSurface
                        : colors.surfaceSecondary,
                    }}
                  >
                    <Text
                      style={{ ...TYPO.subhead, color: colors.textPrimary }}
                    >
                      DEV local break flow
                    </Text>
                    <Text
                      style={{
                        ...TYPO.caption2,
                        fontWeight: "700",
                        color: devBreakMockMode
                          ? colors.successText
                          : colors.textMuted,
                      }}
                    >
                      {devBreakMockMode ? "ON" : "OFF"}
                    </Text>
                  </PressableScale>

                  <Text
                    style={{
                      ...TYPO.caption2,
                      fontWeight: "700",
                      letterSpacing: 0.8,
                      color: colors.textMuted,
                      marginTop: SPACING.lg,
                      marginBottom: SPACING.sm,
                    }}
                  >
                    BREAK UI PRESETS
                  </Text>

                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {DEV_BREAK_PRESETS.map((preset) => (
                      <PressableScale
                        key={preset.key}
                        onPress={() => applyDevBreakPreset(preset.key)}
                        scaleTo={0.96}
                        hitSlop={0}
                        accessibilityLabel={`Preset ${preset.label}`}
                        style={{
                          minHeight: 34,
                          justifyContent: "center",
                          paddingHorizontal: SPACING.md,
                          marginEnd: SPACING.sm,
                          marginBottom: SPACING.sm,
                          borderRadius: RADIUS.pill,
                          borderWidth: 1,
                          borderColor: colors.cardBorder,
                          backgroundColor: isDark
                            ? colors.surfaceSecondary
                            : colors.iconBackground,
                        }}
                      >
                        <Text
                          style={{
                            ...TYPO.caption,
                            color: colors.textSecondary,
                          }}
                        >
                          {preset.label}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              )}
            </Card>
          </>
        )}
      </ScrollView>

      {/* The modern equivalent of the classic screen's reason Modal: the same
          shared sheet the attachment and option pickers use, so it dismisses,
          animates and themes like everything else here. */}
      <BottomSheet
        visible={isBreakSheetVisible}
        onClose={() => setBreakSheetVisible(false)}
        title="Take a break"
        subtitle="Add a reason for this break (optional)"
        closeLabel="Cancel"
        maxHeightRatio={0.6}
      >
        <View
          style={{
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.lg,
            paddingBottom: SPACING.md,
          }}
        >
          <FormField
            label="Reason"
            optional
            value={breakReasonInput}
            onChangeText={setBreakReasonInput}
            placeholder="What's the break for?"
            multiline
            minLines={3}
            align="auto"
            accessibilityLabel="Break reason"
          />

          <ActionButton
            label="Start break"
            icon="cafe-outline"
            variant="filled"
            size="lg"
            onPress={() => {
              setBreakSheetVisible(false);
              tapRef.current = "break";
              handleBreak(breakReasonInput.trim());
            }}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

export default AttendanceAction;
