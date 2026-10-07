import React, { useLayoutEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import Entypo from "@expo/vector-icons/Entypo";
import DateTimePicker from "@react-native-community/datetimepicker";

import { COLORS, SIZES } from "../constants";

import SubmitButton from "../components/common/SubmitButton";
import AttachmentPicker from "../components/attachment/AttachmentPicker";
import AttachmentBottomSheet from "../components/attachment/AttachmentBottomSheet";
import useResignation from "../hooks/useResignation";
import {
  earliestResignationDate,
  formatResignationDayLabel,
} from "../utils/resignation";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Resignation screen.
 *
 * Styled after ComplaintsLegacy and LeaveRequestLegacy (same header, the same
 * shadowed message box, the same bordered date field, the same SubmitButton)
 * so it sits with the other classic screens. The flow — validation, the
 * confirmation prompt and the API call — is shared with the modern screen
 * through hooks/useResignation.js.
 *
 * On removal of the experiment: delete this file and point the "Resignation"
 * route at `screens/Resignation.jsx` unconditionally.
 */
const ResignationLegacy = () => {
  const navigation = useNavigation();

  const {
    resignationDate,
    showDatePicker,
    reason,
    loading,
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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Resignation",
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView
        className="p-4"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold mb-4 text-gray-800">
          Resignation Details
        </Text>

        {/* RESIGNATION DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          Resignation Date
        </Text>
        <TouchableOpacity
          onPress={openDatePicker}
          className="border border-gray-300 rounded-lg px-3 py-2 mb-4"
          accessibilityRole="button"
          accessibilityLabel={`Resignation date: ${formatResignationDayLabel(resignationDate)}`}
        >
          <Text>{formatResignationDayLabel(resignationDate)}</Text>
        </TouchableOpacity>
        {showDatePicker && (
          <>
            <DateTimePicker
              value={resignationDate}
              mode="date"
              minimumDate={earliestResignationDate()}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={handleDateChange}
            />
            {needsDoneAffordance && (
              <TouchableOpacity
                onPress={closeDatePicker}
                className="self-end px-3 py-2 mb-2"
              >
                <Text className="text-blue-600 font-medium">Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* REASON */}
        <Text className="text-sm font-medium text-gray-700 mb-1">Reason</Text>
        <TextInput
          style={{
            minHeight: 160,
            maxHeight: 240,
            backgroundColor: "#fff",
            borderRadius: 10,
            padding: 16,
            marginBottom: 14,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 6,
            elevation: 3,
          }}
          placeholder="Enter your reason for resigning..."
          multiline
          value={reason}
          onChangeText={setReason}
          textAlignVertical="top"
          accessibilityLabel="Resignation reason"
        />

        {/* Attachment 1 */}
        <AttachmentPicker
          file={file1}
          onPick={pickFile1}
          onRemove={removeFile1}
          label="Attachment 1 (optional)"
        />

        {/* Attachment 2 */}
        <AttachmentPicker
          file={file2}
          onPick={pickFile2}
          onRemove={removeFile2}
          label="Attachment 2 (optional)"
        />

        {/* FOOTER */}
        <View
          style={{
            padding: 16,
            paddingBottom: 24,
            borderTopWidth: 1,
            borderTopColor: "#f1f5f9",
            backgroundColor: "#fff",
          }}
        ></View>
        <SubmitButton
          title="Submit Resignation"
          loading={loading}
          onPress={submitResignation}
        />
      </ScrollView>

      {/* Attachment Bottom Sheet */}
      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </SafeAreaView>
  );
};

export default ResignationLegacy;
