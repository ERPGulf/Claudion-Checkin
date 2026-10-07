import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useComplaint from "../hooks/useComplaint";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import ModuleCard from "../components/common/ModuleCard";
import StatusBanner from "../components/common/StatusBanner";
import FormField from "../components/common/FormField";
import UploadField from "../components/common/UploadField";
import AttachmentSheet from "../components/common/AttachmentSheet";

/**
 * Modern Complaints.
 *
 * Presentation only — the message state, the attachment handlers and the submit
 * flow all live in hooks/useComplaint.js, a verbatim lift of what
 * ComplaintsLegacy still runs inline. Nothing here validates, builds a payload or
 * calls an API, and the submit button is disabled only while a request is in
 * flight: an empty message still raises the same Alert on press, so the
 * validation the user experiences is unchanged.
 *
 * Every control is a shared component already used by Attendance Request, Leave
 * Application and Expense Claims: <Card> for the intro, <ModuleCard> for the
 * form, <FormField multiline> for the message, <UploadField> for the attachment,
 * <AttachmentSheet> for the picker, <ActionButton> for submit, <StatusBanner>
 * for what happens next. There is no Complaint-only layout on this screen.
 *
 * This form holds one field, so it is laid out on the dense rhythm — a roomy
 * card header above a single input is most of a screenful of chrome for one
 * question.
 *
 * The inline error appears only after the first submit attempt, as on Loan
 * Application and Expense Claims. It gates nothing — pressing submit still raises
 * the hook's Alert.
 */
function Complaints() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Complaints");

  const {
    message,
    setMessage,
    file,
    loading,
    isBottomSheetVisible,
    pickFile,
    closeBottomSheet,
    removeFile,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    submitComplaint,
    hasMessage,
  } = useComplaint();

  const [attempted, setAttempted] = useState(false);

  const onSubmitPress = useCallback(() => {
    setAttempted(true);
    submitComplaint();
  }, [submitComplaint]);

  // The hook blanks the message once a complaint is sent; clear the error mark
  // with it, so a fresh form isn't pre-marked as invalid.
  useEffect(() => {
    if (!hasMessage) setAttempted(false);
  }, [hasMessage]);

  const messageMissing = attempted && !hasMessage;

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
                name="chatbox-ellipses-outline"
                size={ICON.sm}
                color={colors.accentText}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.headline, color: colors.textPrimary }}
              >
                Complaint
              </Text>
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted }}
                numberOfLines={2}
              >
                Submit feedback or report an issue. The relevant department
                reviews it.
              </Text>
            </View>
          </View>
        </Card>

        {/* ---------- Complaint details ---------- */}
        <ModuleCard
          dense
          icon="chatbox-ellipses-outline"
          title="Complaint details"
          subtitle="Describe the issue you're experiencing"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            {/* Four lines to start, growing as it fills — the same field Leave
                Application uses for its reason, so a typed paragraph sits on the
                same grid as every other input in the app. `align="auto"` follows
                the script the user types; the stored value is the raw string
                either way. */}
            <FormField
              label="Message *"
              value={message}
              onChangeText={setMessage}
              placeholder="Enter your message here..."
              multiline
              minLines={4}
              align="auto"
              accessibilityLabel="Complaint message"
              accessibilityHint="Describe the issue you want to report"
              invalid={messageMissing}
            />

            {/* The same upload target as Attendance Request, Leave Application
                and Expense Claims: the prompt, the accepted formats, the
                Optional chip, and the filename / file glyph / remove button once
                something is picked. `compact` because this is the only other
                control on the screen. */}
            <UploadField
              compact
              label="Attachment"
              file={file}
              onPick={pickFile}
              onRemove={removeFile}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </ModuleCard>

        {/* Mirrors the check submitComplaint already makes, surfaced after the
            first attempt. It gates nothing — the hook still raises its Alert. */}
        {messageMissing && (
          <StatusBanner
            tone="error"
            title="Finish the form first"
            message="Add a message."
            style={{ marginBottom: SPACING.md }}
          />
        )}

        {/* ---------- Submit ---------- */}
        {/* Inline rather than pinned: the "what happens next" card sits below it,
            and a sticky button would either cover that or push it off the
            screen. Same arrangement as Attendance Request and Leave
            Application. The bottom safe-area inset comes from <SafeAreaView>. */}
        <ActionButton
          label="Submit complaint"
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
          message="Your complaint goes to the relevant department. You'll be notified once it has been reviewed or resolved."
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

export default Complaints;
