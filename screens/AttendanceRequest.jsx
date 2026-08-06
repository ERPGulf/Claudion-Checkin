import React from "react";
import {
  Platform,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useAttendanceRequest from "../hooks/useAttendanceRequest";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import ModuleCard from "../components/common/ModuleCard";
import StatusBanner from "../components/common/StatusBanner";
// The modern picker. components/attachment/AttachmentBottomSheet is hardcoded
// light and stays where it is — the classic screens still render it.
import AttachmentSheet from "../components/common/AttachmentSheet";
import {
  PickerField,
  ReasonOption,
  UploadField,
  fitsTwoColumns,
} from "../components/AttendanceRequest";
// "5 Aug 2026" — the app's canonical date string, already unit-tested and
// already what modern Attendance History renders, so the two screens can't
// disagree.
import { formatLogDate } from "../utils/attendanceHistory";
// "11:30 PM", or "23:30" where the locale expects a 24-hour clock. Both format
// through date-fns, which reads local date components; `toLocaleTimeString` went
// through Intl and rendered these values in UTC, which is what showed a correct
// "now" as 5:30 AM on a UTC+05:30 device.
import { formatFieldTime } from "../utils/attendanceRequest";

/** Glyph per reason. Falls back to a neutral tag for anything new. */
const REASON_ICON = {
  "Work From Home": "home-outline",
  "On Duty": "briefcase-outline",
};

/**
 * A picker's starting value. Falls back to now, so a field can never open on a
 * missing or invalid date — the reason a picker would otherwise land on the
 * epoch rather than the user's last choice.
 */
const pickerValue = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();

/**
 * Renders a pair of fields side by side when there is room for both values, and
 * stacks them full-width when there isn't — so the date is never truncated just
 * because the device is narrow.
 *
 * Each field's picker renders immediately after it (stacked) or after the row
 * (two columns), because on iOS `display="spinner"` lays out inline: the wheel
 * has to stay next to the field it edits.
 */
function FieldGroup({ fields, twoColumns }) {
  if (twoColumns) {
    return (
      <>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          {fields.map(({ key, picker, ...field }, index) => (
            <React.Fragment key={key}>
              {index > 0 && <View style={{ width: SPACING.sm }} />}
              <PickerField {...field} style={{ flex: 1 }} />
            </React.Fragment>
          ))}
        </View>

        {fields.map(({ key, picker }) => (
          <React.Fragment key={`picker-${key}`}>{picker}</React.Fragment>
        ))}
      </>
    );
  }

  return (
    <>
      {fields.map(({ key, picker, ...field }, index) => (
        <React.Fragment key={key}>
          <PickerField
            {...field}
            style={index > 0 ? { marginTop: SPACING.md } : null}
          />
          {picker}
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * Modern Attendance Request.
 *
 * Presentation only — the form state, the date/time picker plumbing, the
 * attachment handlers and the submit flow all live in
 * hooks/useAttendanceRequest.js, shared with AttendanceRequestLegacy. Nothing
 * here validates, formats a payload or calls an API.
 *
 * The one long form is grouped into three module cards (when, why, evidence),
 * matching the card rhythm on modern Home. Each DateTimePicker is still rendered
 * next to the field that owns it, because on iOS `display="spinner"` renders
 * inline in the layout flow — hoisting them to the bottom of the screen would
 * move the wheel away from the field it edits.
 *
 * Date and time fields pair up into two columns only while a value still fits on
 * one line, and stack full-width when it doesn't (see `fitsTwoColumns`). Dates
 * render through the app's shared formatters, so they read the same here as in
 * Attendance History.
 */
function AttendanceRequest() {
  const { colors, isDark } = useAppTheme();
  useModernScreenHeader("Attendance Request");

  const {
    fromDate,
    toDate,
    fromTime,
    toTime,
    selectedReason,
    attachment,
    loading,
    reasons,
    today,
    showFromPicker,
    showToPicker,
    showFromTimePicker,
    showToTimePicker,
    openFromPicker,
    openToPicker,
    openFromTimePicker,
    openToTimePicker,
    onFromDateChange,
    onToDateChange,
    onFromTimeChange,
    onToTimeChange,
    setSelectedReason,
    isBottomSheetVisible,
    pickAttachment,
    closeBottomSheet,
    removeAttachment,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleSubmit,
    dateRangeInvalid,
  } = useAttendanceRequest();

  // iOS-only. Keeps the native wheel on the same palette as the screen; has no
  // bearing on how a value is picked.
  const pickerTheme = Platform.OS === "ios" ? (isDark ? "dark" : "light") : undefined;

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

  // Two columns only while a value still fits in one; otherwise the fields
  // stack full-width. Re-reads on rotation and on a foldable unfolding.
  const { width: windowWidth } = useWindowDimensions();
  const twoColumns = fitsTwoColumns(windowWidth);

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
        {/* Icon centred against the two text lines rather than top-aligned, so
            the block reads as one unit at this height. */}
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
                name="clipboard-outline"
                size={ICON.sm}
                color={colors.accentText}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.headline, color: colors.textPrimary }}
              >
                Attendance request
              </Text>
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted }}
                numberOfLines={2}
              >
                For a work-from-home or on-duty day.
              </Text>
            </View>
          </View>
        </Card>

        {/* ---------- Date & time ---------- */}
        <ModuleCard
          icon="calendar-outline"
          title="Date & time"
          subtitle="The period this request covers"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <FieldGroup
              twoColumns={twoColumns}
              fields={[
                {
                  key: "fromDate",
                  label: "From date",
                  value: formatLogDate(fromDate),
                  icon: "calendar-outline",
                  onPress: openFromPicker,
                  active: showFromPicker,
                  invalid: dateRangeInvalid,
                  picker: showFromPicker && (
                    <DateTimePicker
                      value={pickerValue(fromDate)}
                      mode="date"
                      maximumDate={today}
                      themeVariant={pickerTheme}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={onFromDateChange}
                    />
                  ),
                },
                {
                  key: "toDate",
                  label: "To date",
                  value: formatLogDate(toDate),
                  icon: "calendar-outline",
                  onPress: openToPicker,
                  active: showToPicker,
                  invalid: dateRangeInvalid,
                  picker: showToPicker && (
                    <DateTimePicker
                      value={pickerValue(toDate)}
                      mode="date"
                      maximumDate={today}
                      minimumDate={fromDate}
                      themeVariant={pickerTheme}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={onToDateChange}
                    />
                  ),
                },
              ]}
            />

            {/* Mirrors the check handleSubmit already makes, surfaced before the
                user commits. It gates nothing — submitting still raises the same
                Alert, exactly as on the classic screen. */}
            {dateRangeInvalid && (
              <StatusBanner
                tone="error"
                title="Check the date range"
                message="To date cannot be before From date."
                style={{ marginTop: SPACING.md }}
              />
            )}

            <View style={{ marginTop: SPACING.md }}>
              <FieldGroup
                twoColumns={twoColumns}
                fields={[
                  {
                    key: "fromTime",
                    label: "From time",
                    value: formatFieldTime(fromTime),
                    icon: "time-outline",
                    onPress: openFromTimePicker,
                    active: showFromTimePicker,
                    picker: showFromTimePicker && (
                      <DateTimePicker
                        value={pickerValue(fromTime)}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={pickerTheme}
                        onChange={onFromTimeChange}
                      />
                    ),
                  },
                  {
                    key: "toTime",
                    label: "To time",
                    value: formatFieldTime(toTime),
                    icon: "time-outline",
                    onPress: openToTimePicker,
                    active: showToTimePicker,
                    picker: showToTimePicker && (
                      <DateTimePicker
                        value={pickerValue(toTime)}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={pickerTheme}
                        onChange={onToTimeChange}
                      />
                    ),
                  },
                ]}
              />
            </View>
          </View>
        </ModuleCard>

        {/* ---------- Reason ---------- */}
        <ModuleCard
          icon="help-circle-outline"
          title="Reason"
          subtitle="Choose one"
          style={{ marginBottom: SPACING.md }}
        >
          <View
            style={cardBody}
            accessibilityRole="radiogroup"
            accessibilityLabel="Reason for the request"
          >
            {reasons.map((item, index) => (
              <ReasonOption
                key={item}
                label={item}
                icon={REASON_ICON[item] || "pricetag-outline"}
                selected={selectedReason === item}
                onPress={() => setSelectedReason(item)}
                // A hairline between rows instead of a gap: separation without
                // the height a margin would cost.
                showDivider={index < reasons.length - 1}
              />
            ))}
          </View>
        </ModuleCard>

        {/* ---------- Attachment ---------- */}
        <ModuleCard
          icon="attach-outline"
          title="Attachment"
          subtitle="Optional supporting document"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <UploadField
              file={attachment}
              onPick={pickAttachment}
              onRemove={removeAttachment}
            />
          </View>
        </ModuleCard>

        {/* ---------- Submit ---------- */}
        <ActionButton
          label="Submit attendance request"
          icon="paper-plane-outline"
          variant="filled"
          size="lg"
          elevated
          loading={loading}
          disabled={loading}
          onPress={handleSubmit}
        />

        {/* ---------- What happens next ---------- */}
        {/* No title: the sentence is the whole message, and a heading above it
            would cost a line to say the same thing. */}
        <StatusBanner
          tone="info"
          icon="information-circle"
          message="Your manager will review this request. You'll be notified once it's approved or rejected."
          style={{ marginTop: SPACING.md }}
        />
      </ScrollView>

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

export default AttendanceRequest;
