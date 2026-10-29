import { formatFieldTime } from '../utils/attendanceRequest';
import { formatExpenseDate } from '../utils/expenseClaims';
import { t, getLanguage, useTranslation } from '../localization';
import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { View, TouchableOpacity, ScrollView, Platform, ActivityIndicator } from 'react-native';
import Text from '../localization/LocalizedText';
import { SafeAreaView } from "react-native-safe-area-context";
import Entypo from "@expo/vector-icons/Entypo";
import DateTimePicker from "@react-native-community/datetimepicker";
import Checkbox from "expo-checkbox";
import { COLORS, SIZES } from "../constants";
import SubmitButton from "../components/common/SubmitButton";
import useAttendanceRequest from "../hooks/useAttendanceRequest";
import AttachmentBottomSheet from "../components/attachment/AttachmentBottomSheet";
import AttachmentPicker from "../components/attachment/AttachmentPicker";
import AttendanceRequestCard from "../components/AttendanceRequest/AttendanceRequestCard";

/**
 * Classic Attendance Request — the original screen, kept for users on Classic UI.
 *
 * Presentation is unchanged from before the redesign: same bare bordered
 * pressables, same expo-checkbox reason list, same AttachmentPicker, same
 * chevron header, same Alert-driven validation. The only edit is that the form
 * state and submit flow now come from useAttendanceRequest() instead of being
 * declared inline, so this screen and the modern one can never disagree about
 * how a request is built or sent.
 *
 * Do not restyle this file. It is the before-picture in an A/B comparison.
 */
export default function AttendanceRequestScreen() {
  const { language, isRTL } = useTranslation();
  const navigation = useNavigation();

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
    needsDoneAffordance,
    closeFromPicker,
    closeToPicker,
    closeFromTimePicker,
    closeToTimePicker,
    visibleRequests,
    hasMoreRequests,
    showMoreRequests,
    isFetchingHistory,
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
  } = useAttendanceRequest();

  // ✅ SAME HEADER
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: t("Attendance Request"),
      headerTitleAlign: "center",
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name={isRTL ? "chevron-right" : "chevron-left"}
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation, language, isRTL]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* TITLE */}
        <Text className="text-lg font-semibold mb-4 text-gray-800">{t("Attendance Request")}</Text>

        {/* FROM DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">{t("From Date")}</Text>
        <TouchableOpacity
          onPress={openFromPicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>{formatExpenseDate(fromDate)}</Text>
        </TouchableOpacity>

        {showFromPicker && (
          <>
            <DateTimePicker locale={getLanguage()}
              value={fromDate}
              mode="date"
              maximumDate={today}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onFromDateChange}
            />
            {needsDoneAffordance && (
              <TouchableOpacity
                onPress={closeFromPicker}
                className="self-end px-3 py-2 mb-2"
              >
                <Text className="text-blue-600 font-medium">{t("Done")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* TO DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">{t("To Date")}</Text>
        <TouchableOpacity
          onPress={openToPicker}
          className="border border-gray-300 rounded px-3 py-2 mb-4"
        >
          <Text>{formatExpenseDate(toDate)}</Text>
        </TouchableOpacity>

        {showToPicker && (
          <>
            <DateTimePicker locale={getLanguage()}
              value={toDate}
              mode="date"
              maximumDate={today}
              minimumDate={fromDate}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onToDateChange}
            />
            {needsDoneAffordance && (
              <TouchableOpacity
                onPress={closeToPicker}
                className="self-end px-3 py-2 mb-2"
              >
                <Text className="text-blue-600 font-medium">{t("Done")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {/* FROM TIME */}
        <Text className="text-sm font-medium text-gray-700 mb-1">{t("From Time")}</Text>
        <TouchableOpacity
          onPress={openFromTimePicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>
            {formatFieldTime(fromTime)}
          </Text>
        </TouchableOpacity>

        {showFromTimePicker && (
          <>
            <DateTimePicker locale={getLanguage()}
              value={fromTime}
              mode="time"
              display="default"
              onChange={onFromTimeChange}
            />
            {needsDoneAffordance && (
              <TouchableOpacity
                onPress={closeFromTimePicker}
                className="self-end px-3 py-2 mb-2"
              >
                <Text className="text-blue-600 font-medium">{t("Done")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* TO TIME */}
        <Text className="text-sm font-medium text-gray-700 mb-1">{t("To Time")}</Text>
        <TouchableOpacity
          onPress={openToTimePicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>
            {formatFieldTime(toTime)}
          </Text>
        </TouchableOpacity>

        {showToTimePicker && (
          <>
            <DateTimePicker locale={getLanguage()}
              value={toTime}
              mode="time"
              display="default"
              onChange={onToTimeChange}
            />
            {needsDoneAffordance && (
              <TouchableOpacity
                onPress={closeToTimePicker}
                className="self-end px-3 py-2 mb-2"
              >
                <Text className="text-blue-600 font-medium">{t("Done")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {/* REASON */}
        <Text className="text-sm font-medium text-gray-700 mb-2">{t("Select Reason")}</Text>

        {reasons.map((item, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setSelectedReason(item)}
            className="flex-row items-center mb-3"
          >
            <Checkbox
              value={selectedReason === item}
              onValueChange={() => setSelectedReason(item)}
              color={selectedReason === item ? COLORS.primary : undefined}
            />
            <Text className="text-gray-700" style={{ marginStart: 8 }}>{t(item)}</Text>
          </TouchableOpacity>
        ))}
        <AttachmentPicker
          file={attachment}
          onPick={pickAttachment}
          onRemove={removeAttachment}
        />

        {/* SUBMIT */}
        <View style={{ marginTop: 16 }}>
          <SubmitButton
            title={t("Submit Attendance Request")}
            loading={loading}
            onPress={handleSubmit}
            disabled={loading}
          />
        </View>

        {/* HISTORY */}
        <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">{t("Attendance Request History")}</Text>

        {isFetchingHistory ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text className="text-gray-500 mt-2">{t("Loading attendance requests...")}</Text>
          </View>
        ) : visibleRequests.length === 0 ? (
          <Text className="text-gray-500 text-center mt-6">{t("No attendance requests yet.")}</Text>
        ) : (
          <>
            {visibleRequests.map((item, index) => (
              <View key={item?.name || index} className="mb-4">
                <AttendanceRequestCard request={item} />
              </View>
            ))}

            {hasMoreRequests && (
              <TouchableOpacity
                onPress={showMoreRequests}
                className="p-3 mb-6 rounded bg-gray-300"
              >
                <Text className="text-center font-semibold">{t("Load More")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </SafeAreaView>
  );
}
