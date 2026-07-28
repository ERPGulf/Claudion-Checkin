import React, { useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from "react-native";
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
import StatusCard from "../components/AttendanceAction/StatusCard";
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
    liveBreakTime,
    breakMinutes,
    breakCompleted,
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
  const breakBlocked =
    actionLoading ||
    (restrictLocation === 1 && !inTarget) ||
    breakCompleted ||
    breakMinutes >= 120;

  const locationValue =
    restrictLocation === 0
      ? "Not Required"
      : !ready
        ? "Getting Location..."
        : inTarget
          ? "In bound"
          : "Out of bound";

  if (!restrictionLoaded) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
        edges={["bottom", "left", "right"]}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator size="large" color={colors.textMuted} />
          <Text
            style={{
              ...TYPO.subhead,
              color: colors.textMuted,
              marginTop: SPACING.sm,
            }}
          >
            Loading settings...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      {actionLoading && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 50,
              backgroundColor: "rgba(0,0,0,0.5)",
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <ActivityIndicator size="large" color="white" />
          <Text
            style={{
              ...TYPO.body,
              color: "white",
              marginTop: SPACING.sm,
            }}
          >
            Processing...
          </Text>
        </View>
      )}

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
              {liveBreakTime || "00:00:00"}
            </Text>
            <Text
              style={{
                ...TYPO.caption,
                textAlign: "center",
                color: colors.textMuted,
                marginTop: 2,
              }}
            >
              Auto-ends at 02:00:00
            </Text>
          </Card>
        )}

        {/* -------------------- STATUS -------------------- */}
        <StatusCard />

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
            onPress={handlePrimaryAction}
            loading={actionLoading}
            disabled={checkoutBlocked}
          />

          {checkoutBlocked && (
            <StatusBanner
              tone="warning"
              title="You're outside the allowed area"
              message="Move within the office radius to record this action."
              style={{ marginTop: SPACING.md }}
            />
          )}

          {checkin && (
            <>
              <ActionButton
                size="lg"
                variant="outline"
                icon={
                  breakBlocked
                    ? "cafe-outline"
                    : onBreak
                      ? "play-outline"
                      : "cafe-outline"
                }
                label={
                  breakBlocked
                    ? "Break not allowed"
                    : onBreak
                      ? "End break"
                      : "Take break"
                }
                onPress={handleBreak}
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
                onPress={() => setDevOpen(open => !open)}
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
                    onPress={() => setDevBreakMockMode(prev => !prev)}
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
                    {DEV_BREAK_PRESETS.map(preset => (
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
    </SafeAreaView>
  );
}

export default AttendanceAction;
