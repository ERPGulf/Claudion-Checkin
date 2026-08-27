import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
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
    formatDate,
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
      headerTitle: "Attendance Request",
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
        className="flex-1 bg-white"
        contentContainerStyle={{ padding: 16 }}
      >
        {/* TITLE */}
        <Text className="text-lg font-semibold mb-4 text-gray-800">
          Attendance Request
        </Text>

        {/* FROM DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          From Date
        </Text>
        <TouchableOpacity
          onPress={openFromPicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>{formatDate(fromDate)}</Text>
        </TouchableOpacity>

        {showFromPicker && (
          <>
            <DateTimePicker
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
                <Text className="text-blue-600 font-medium">Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* TO DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">To Date</Text>
        <TouchableOpacity
          onPress={openToPicker}
          className="border border-gray-300 rounded px-3 py-2 mb-4"
        >
          <Text>{formatDate(toDate)}</Text>
        </TouchableOpacity>

        {showToPicker && (
          <>
            <DateTimePicker
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
                <Text className="text-blue-600 font-medium">Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {/* FROM TIME */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          From Time
        </Text>
        <TouchableOpacity
          onPress={openFromTimePicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>
            {fromTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </TouchableOpacity>

        {showFromTimePicker && (
          <>
            <DateTimePicker
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
                <Text className="text-blue-600 font-medium">Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* TO TIME */}
        <Text className="text-sm font-medium text-gray-700 mb-1">To Time</Text>
        <TouchableOpacity
          onPress={openToTimePicker}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>
            {toTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </TouchableOpacity>

        {showToTimePicker && (
          <>
            <DateTimePicker
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
                <Text className="text-blue-600 font-medium">Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {/* REASON */}
        <Text className="text-sm font-medium text-gray-700 mb-2">
          Select Reason
        </Text>

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
            <Text className="ml-2 text-gray-700">{item}</Text>
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
            title="Submit Attendance Request"
            loading={loading}
            onPress={handleSubmit}
            disabled={loading}
          />
        </View>

        {/* HISTORY */}
        <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">
          Attendance Request History
        </Text>

        {isFetchingHistory ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text className="text-gray-500 mt-2">
              Loading attendance requests...
            </Text>
          </View>
        ) : visibleRequests.length === 0 ? (
          <Text className="text-gray-500 text-center mt-6">
            No attendance requests yet.
          </Text>
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
                <Text className="text-center font-semibold">Load More</Text>
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
