import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useResignation from "../hooks/useResignation";
import { formatLogDate } from "../utils/attendanceHistory";
import { earliestResignationDate } from "../utils/resignation";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import ModuleCard from "../components/common/ModuleCard";
import StatusBanner from "../components/common/StatusBanner";
import FormField from "../components/common/FormField";
import PickerField from "../components/common/PickerField";
import UploadField from "../components/common/UploadField";
import AttachmentSheet from "../components/common/AttachmentSheet";
import PickerWithDone from "../components/common/PickerWithDone";

/**
 * Employee resignation.
 *
 * Presentation only — state, validation, the confirmation prompt and the API
 * call live in hooks/useResignation.js. Laid out like Complaints: an intro card,
 * one dense form card, an inline submit button and a "what happens next" note.
 *
 * The inline error appears only after the first submit attempt, as on Loan
 * Application. It gates nothing — the hook still raises its Alert.
 */
function Resignation() {
  const { colors, isDark } = useAppTheme();
  useModernScreenHeader("Resignation");

  const {
    resignationDate,
    showDatePicker,
    reason,
    loading,
    submitted,
    file1,
    file2,
    isBottomSheetVisible,
    setReason,
    pickFile1,
    pickFile2,
    closeBottomSheet,
    removeFile1,
    removeFile2,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    openDatePicker,
    closeDatePicker,
    needsDoneAffordance,
    handleDateChange,
    submitResignation,
  } = useResignation();

  const [attempted, setAttempted] = useState(false);

  const onSubmitPress = useCallback(() => {
    setAttempted(true);
    submitResignation();
  }, [submitResignation]);

  const reasonMissing = !reason.trim();

  // The hook blanks the reason once a resignation is sent; clear the error mark
  // with it, so a fresh form isn't pre-marked as invalid.
  useEffect(() => {
    if (reasonMissing) setAttempted(false);
  }, [reasonMissing]);

  // iOS-only. Keeps the native wheel on the same palette as the screen.
  const pickerTheme =
    Platform.OS === "ios" ? (isDark ? "dark" : "light") : undefined;

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

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
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        // iOS only: lifts the focused field above the keyboard. Android pans
        // the window instead (softwareKeyboardLayoutMode "pan").
        automaticallyAdjustKeyboardInsets
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
                name="exit-outline"
                size={ICON.sm}
                color={colors.accentText}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.headline, color: colors.textPrimary }}
              >
                Resignation
              </Text>
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted }}
                numberOfLines={2}
              >
                Submit your resignation with the date and your reason for
                leaving.
              </Text>
            </View>
          </View>
        </Card>

        {/* ---------- Confirmation of the last submission ---------- */}
        {submitted && (
          <StatusBanner
            tone="success"
            title="Resignation submitted"
            message={`Reference ${submitted.name}. You'll be notified once it has been reviewed.`}
            style={{ marginBottom: SPACING.md }}
          />
        )}

        {/* ---------- Resignation details ---------- */}
        <ModuleCard
          dense
          icon="document-text-outline"
          title="Resignation details"
          subtitle="When you're leaving and why"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <PickerField
              label="Resignation date *"
              value={formatLogDate(resignationDate)}
              icon="calendar-outline"
              onPress={openDatePicker}
              active={showDatePicker}
            />

            {/* Next to the field it edits: on iOS `display="spinner"` lays out
                inline. */}
            {showDatePicker && (
              <PickerWithDone
                needsDone={needsDoneAffordance}
                onDone={closeDatePicker}
              >
                <DateTimePicker
                  value={resignationDate}
                  mode="date"
                  minimumDate={earliestResignationDate()}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  themeVariant={pickerTheme}
                  onChange={handleDateChange}
                />
              </PickerWithDone>
            )}

            <View style={{ marginTop: SPACING.md }}>
              <FormField
                label="Reason *"
                value={reason}
                onChangeText={setReason}
                placeholder="Tell us why you're resigning..."
                multiline
                minLines={4}
                align="auto"
                accessibilityLabel="Resignation reason"
                accessibilityHint="Describe your reason for resigning"
                invalid={attempted && reasonMissing}
              />
            </View>
          </View>
        </ModuleCard>

        {/* ---------- Attachments ---------- */}
        {/* Two independent optional slots, laid out like Loan application's
            and posted as the `file1` / `file2` fields the endpoint reads. */}
        <ModuleCard
          dense
          icon="attach-outline"
          title="Attachments"
          subtitle="Add a resignation letter or supporting document"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <UploadField
              compact
              label="Attachment 1"
              file={file1}
              onPick={pickFile1}
              onRemove={removeFile1}
            />

            <UploadField
              compact
              label="Attachment 2"
              file={file2}
              onPick={pickFile2}
              onRemove={removeFile2}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </ModuleCard>

        {/* Mirrors the check submitResignation already makes, surfaced after
            the first attempt. It gates nothing — the hook still raises its
            Alert. */}
        {attempted && reasonMissing && (
          <StatusBanner
            tone="error"
            title="Finish the form first"
            message="Add a reason for your resignation."
            style={{ marginBottom: SPACING.md }}
          />
        )}

        {/* ---------- Submit ---------- */}
        <ActionButton
          label="Submit resignation"
          icon="paper-plane-outline"
          variant="filled"
          size="lg"
          elevated
          loading={loading}
          disabled={loading}
          onPress={onSubmitPress}
        />

        {/* ---------- What happens next ---------- */}
        <StatusBanner
          tone="info"
          icon="information-circle"
          title="What happens next"
          message="Your resignation goes to HR for review. You'll be notified about the next steps, including your notice period."
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

export default Resignation;
