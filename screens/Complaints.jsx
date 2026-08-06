import React from "react";
import { ScrollView, Text, View } from "react-native";
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
    attachmentCount,
  } = useComplaint();

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: SPACING.xl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
              {/* The same upload target as Attendance Request, Leave
                  Application and Expense Claims: the prompt, the accepted
                  formats, the Optional chip, and the filename / file glyph /
                  remove button once something is picked. `compact` because this
                  is the only other control on the screen. */}
              <UploadField
                compact
                file={file}
                onPick={pickFile}
                onRemove={removeFile}
              />
            </View>
          </View>
        </ModuleCard>

        {/* ---------- Summary ---------- */}
        {/* Only what is already on this screen: that there is something to send,
            and whether a file is going with it. No status, no reference number —
            nothing has been created yet, so there is nothing else to report. */}
        {hasMessage && (
          <Card
            style={{ padding: SPACING.md, marginBottom: SPACING.md }}
            accessible
            accessibilityLabel={`Summary. Complaint ready to submit. ${
              attachmentCount === 1 ? "1 file attached" : "No attachment"
            }.`}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                  Complaint
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  Ready to submit
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
                  Attachment
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  {attachmentCount === 1 ? "1 file attached" : "None"}
                </Text>
              </View>
            </View>
          </Card>
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
          onPress={submitComplaint}
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
