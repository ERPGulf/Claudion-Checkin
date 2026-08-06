import React from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useLeaveRequest, { NO_LEAVE_TYPE } from "../hooks/useLeaveRequest";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import ModuleCard from "../components/common/ModuleCard";
import StatusBanner from "../components/common/StatusBanner";
import PickerField from "../components/common/PickerField";
import FormField from "../components/common/FormField";
import UploadField from "../components/common/UploadField";
import OptionSheet from "../components/common/OptionSheet";
import AttachmentSheet from "../components/common/AttachmentSheet";
import PressableScale from "../components/common/PressableScale";
// "6 Aug 2026" — the app's canonical date string, already what Attendance
// History, Attendance Request and Expense Claims render.
import { formatLogDate } from "../utils/attendanceHistory";
import {
  countLeaveDays,
  formatLeaveDuration,
  leaveTypeIcon,
} from "../utils/leaveRequest";

/**
 * A picker's starting value. Falls back to now, so a field can never open on a
 * missing or invalid date.
 */
const pickerValue = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();

/**
 * Modern Leave Application.
 *
 * Presentation only — the form state, the leave-type fetch, the date-picker
 * plumbing, the attachment handlers and the submit flow all live in
 * hooks/useLeaveRequest.js, shared with LeaveRequestLegacy. Nothing here
 * validates, formats a payload or calls an API.
 *
 * Every control is a shared component already used by Attendance Request and
 * Expense Claims: <PickerField> for the type and the dates, <FormField> for the
 * reason, <UploadField> for the attachment, <OptionSheet> in place of the
 * oversized wheel, <AttachmentSheet> for the picker, <ActionButton> for submit.
 * Nothing on this screen is a Leave-only layout.
 *
 * The submit button stays inline rather than pinned: the "what happens next"
 * card sits below it, and a sticky button would either cover that or push it off
 * the screen. Same arrangement as Attendance Request.
 */
function LeaveRequest() {
  const { colors, isDark } = useAppTheme();
  useModernScreenHeader("Leave Application");

  const {
    leaveType,
    reason,
    setReason,
    fromDate,
    toDate,
    postingDate,
    agreed,
    setAgreed,
    leaveTypes,
    attachment,
    loading,
    isRemote,
    remoteAgreementText,
    isTypeSheetVisible,
    openTypeSheet,
    closeTypeSheet,
    selectLeaveType,
    showFromPicker,
    showToPicker,
    openFromPicker,
    openToPicker,
    handleFromChange,
    handleToChange,
    isBottomSheetVisible,
    pickAttachment,
    closeBottomSheet,
    removeAttachment,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleSubmit,
    dateRangeInvalid,
  } = useLeaveRequest();

  // iOS-only. Keeps the native wheel on the same palette as the screen; has no
  // bearing on how a date is picked.
  const pickerTheme =
    Platform.OS === "ios" ? (isDark ? "dark" : "light") : undefined;

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

  const typeChosen = !!leaveType && leaveType !== NO_LEAVE_TYPE;
  const duration = formatLeaveDuration(countLeaveDays(fromDate, toDate));

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          padding: SPACING.lg,
          paddingBottom: SPACING.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---------- Introduction ---------- */}
        <Card style={{ marginBottom: SPACING.md, padding: SPACING.md }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: RADIUS.sm,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accentSurface,
                borderWidth: 1,
                borderColor: colors.accentBorder,
                marginEnd: SPACING.md,
              }}
            >
              <Ionicons
                name="airplane-outline"
                size={ICON.sm}
                color={colors.accentText}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.headline, color: colors.textPrimary }}
              >
                Leave request
              </Text>
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted }}
                numberOfLines={2}
              >
                Pick a leave type, dates and reason. Your manager reviews it.
              </Text>
            </View>
          </View>
        </Card>

        {/* ---------- Leave details ---------- */}
        <ModuleCard
          icon="document-text-outline"
          title="Leave details"
          subtitle="Type, reason and any supporting document"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            {/* The same compact field the dates use, so the form reads as one
                grid. Opens a sheet instead of the inline wheel — the value it
                hands back is the identical raw leave-type string. */}
            <PickerField
              label="Leave type *"
              value={typeChosen ? leaveType : ""}
              placeholder="Select leave type"
              icon={typeChosen ? leaveTypeIcon(leaveType) : "list-outline"}
              onPress={openTypeSheet}
              active={isTypeSheetVisible}
            />

            <FormField
              label="Reason"
              value={reason}
              onChangeText={setReason}
              placeholder="Enter reason for leave"
              multiline
              optional
              style={{ marginTop: SPACING.md }}
            />

            <View style={{ marginTop: SPACING.md }}>
              <Text
                style={{
                  ...TYPO.caption,
                  color: colors.textSecondary,
                  marginBottom: SPACING.xs,
                }}
              >
                Attachment
              </Text>
              <UploadField
                file={attachment}
                onPick={pickAttachment}
                onRemove={removeAttachment}
              />
            </View>
          </View>
        </ModuleCard>

        {/* ---------- Remote work acknowledgement ---------- */}
        {/* Same condition, same text, same single `agreed` flag the classic
            screen uses — and the policy still collapses once accepted. Only the
            checkbox is drawn rather than expo-checkbox's unthemed control, so it
            follows the palette like everything else. */}
        {isRemote && (
          <ModuleCard
            icon="home-outline"
            title="Remote work policy"
            subtitle="Required for a remote request"
            style={{ marginBottom: SPACING.md }}
          >
            <View style={cardBody}>
              {!agreed && (
                <ScrollView
                  style={{
                    maxHeight: 180,
                    padding: SPACING.md,
                    borderRadius: RADIUS.lg,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    backgroundColor: colors.surfaceSecondary,
                  }}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                >
                  <Text
                    style={{
                      ...TYPO.subhead,
                      fontWeight: "400",
                      color: colors.textSecondary,
                    }}
                  >
                    {remoteAgreementText}
                  </Text>
                </ScrollView>
              )}

              <PressableScale
                onPress={() => setAgreed(!agreed)}
                scaleTo={0.99}
                hitSlop={0}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                accessibilityLabel="I have read and agree to the full remote work policy."
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 44,
                  marginTop: agreed ? 0 : SPACING.md,
                }}
              >
                <Ionicons
                  name={agreed ? "checkbox" : "square-outline"}
                  size={ICON.lg}
                  color={agreed ? colors.successText : colors.textMuted}
                />
                <Text
                  style={{
                    ...TYPO.subhead,
                    fontWeight: "400",
                    flex: 1,
                    minWidth: 0,
                    marginStart: SPACING.sm,
                    color: colors.textPrimary,
                  }}
                >
                  I have read and agree to the full remote work policy.
                </Text>
              </PressableScale>
            </View>
          </ModuleCard>
        )}

        {/* ---------- Leave period ---------- */}
        <ModuleCard
          icon="calendar-outline"
          title="Leave period"
          subtitle="The days this request covers"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <PickerField
              label="From date *"
              value={formatLogDate(fromDate)}
              icon="calendar-outline"
              onPress={openFromPicker}
              active={showFromPicker}
              invalid={dateRangeInvalid}
            />

            {/* Rendered next to the field it edits: on iOS `display="spinner"`
                lays out inline, so hoisting it would move the wheel away from
                the control it belongs to. */}
            {showFromPicker && (
              <DateTimePicker
                value={pickerValue(fromDate)}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant={pickerTheme}
                onChange={handleFromChange}
              />
            )}

            <PickerField
              label="To date *"
              value={formatLogDate(toDate)}
              icon="calendar-outline"
              onPress={openToPicker}
              active={showToPicker}
              invalid={dateRangeInvalid}
              style={{ marginTop: SPACING.md }}
            />

            {showToPicker && (
              <DateTimePicker
                value={pickerValue(toDate)}
                mode="date"
                minimumDate={fromDate}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant={pickerTheme}
                onChange={handleToChange}
              />
            )}

            {/* Read-only: the form sets this to today and there is nothing to
                open. No chevron, no press target, announced as disabled. */}
            <PickerField
              readOnly
              label="Posting date"
              value={formatLogDate(postingDate)}
              icon="today-outline"
              style={{ marginTop: SPACING.md }}
            />

            {/* Mirrors the check handleSubmit already makes. It gates nothing —
                submitting still raises the same Alert, exactly as on the classic
                screen. Choosing From after To also still pushes To forward, so
                this is close to unreachable by hand. */}
            {dateRangeInvalid && (
              <StatusBanner
                tone="error"
                title="Check the date range"
                message="To date cannot be before From date."
                style={{ marginTop: SPACING.md }}
              />
            )}
          </View>
        </ModuleCard>

        {/* ---------- Summary ---------- */}
        {/* Only what is already on this screen: the type the user picked and the
            span of the dates they picked. No status row — nothing has been
            created yet, so there is no state to report — and no entitlement
            figure, which only the backend can decide. */}
        {typeChosen && !!duration && (
          <Card
            style={{ padding: SPACING.md, marginBottom: SPACING.md }}
            accessible
            accessibilityLabel={`Summary. ${leaveType}, ${duration}.`}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                  Duration
                </Text>
                <Text
                  style={{
                    ...TYPO.title3,
                    color: colors.textPrimary,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {duration}
                </Text>
              </View>

              <View
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  backgroundColor: colors.dividerSubtle,
                  marginHorizontal: SPACING.md,
                }}
              />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                  Leave type
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  {leaveType}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* ---------- Submit ---------- */}
        <ActionButton
          label="Submit leave request"
          icon="paper-plane-outline"
          variant="filled"
          size="lg"
          elevated
          loading={loading}
          disabled={loading}
          onPress={handleSubmit}
        />

        {/* ---------- What happens next ---------- */}
        <StatusBanner
          tone="info"
          icon="information-circle"
          title="What happens next"
          message="Your leave request will be sent to your manager for approval. You'll be notified once it has been approved or rejected."
          style={{ marginTop: SPACING.md }}
        />
      </ScrollView>

      <OptionSheet
        visible={isTypeSheetVisible}
        onClose={closeTypeSheet}
        title="Leave type"
        subtitle="What kind of leave are you requesting?"
        options={leaveTypes}
        selected={leaveType}
        onSelect={selectLeaveType}
        iconForOption={leaveTypeIcon}
        emptyIcon="calendar-outline"
        emptyTitle="No leave types"
        emptyDescription="Your administrator hasn't configured any leave types yet."
      />

      <AttachmentSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </SafeAreaView>
  );
}

export default LeaveRequest;
