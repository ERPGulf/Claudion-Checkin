import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import AttachmentBottomSheet from "../components/attachment/AttachmentBottomSheet";
import LeaveApplicationCard from "../components/LeaveApplication/LeaveApplicationCard";
import AttachmentPicker from "../components/attachment/AttachmentPicker";
import { SafeAreaView } from "react-native-safe-area-context";
import Entypo from "@expo/vector-icons/Entypo";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import SubmitButton from "../components/common/SubmitButton";
import Checkbox from "expo-checkbox";
import { COLORS, SIZES } from "../constants";
import useLeaveRequest from "../hooks/useLeaveRequest";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Leave Application
 * screen, preserved exactly as it shipped.
 *
 * The markup below is the original `screens/LeaveRequest.jsx` unchanged: same
 * header, same @react-native-picker/picker wheel, same gray-50 inputs, same
 * <AttachmentPicker>, same remote-work agreement block, same read-only posting
 * date, same <SubmitButton>. Only the source of its state moved — every field,
 * the leave-type fetch, the date handlers, the attachment pickers and
 * `handleSubmit` now come from hooks/useLeaveRequest.js, shared with the modern
 * screen, so validation and the submitted payload are identical on both.
 *
 * On removal of the experiment: delete this file and point the "Leave request"
 * route at `screens/LeaveRequest.jsx` unconditionally.
 */
export default function LeaveRequestLegacy() {
  const navigation = useNavigation();

  const {
    leaveType,
    setLeaveType,
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
    remoteAgreementText,
    formatDate,
    showFromPicker,
    showToPicker,
    setShowFromPicker,
    setShowToPicker,
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
    visibleLeaves,
    hasMoreLeaves,
    showMoreLeaves,
    isFetchingHistory,
  } = useLeaveRequest();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Leave Application",
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
      <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-xl font-semibold mb-4 text-gray-800">
          Leave Application
        </Text>

        {/* Leave Type Picker */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          Select Leave Type
        </Text>
        <View className="border border-gray-300 rounded mb-4 bg-gray-50">
          <Picker
            selectedValue={leaveType}
            onValueChange={setLeaveType}
            style={{ color: "#111827" }}
          >
            <Picker.Item
              label="Select Leave Type"
              value="__none__"
              color="#9CA3AF"
            />

            {leaveTypes.map((item, index) => (
              <Picker.Item
                key={index}
                label={item}
                value={item}
                color="#111827"
              />
            ))}
          </Picker>
        </View>

        {/* Reason */}
        <Text className="text-sm font-medium text-gray-700 mb-1">Reason</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Enter reason for leave"
          placeholderTextColor="#6B7280"
          multiline
          className="border border-gray-300 rounded-lg px-3 py-2 mb-3 text-gray-900"
        />
        <AttachmentPicker
          file={attachment}
          onPick={pickAttachment}
          onRemove={removeAttachment}
        />

        {/* From Date */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          From Date
        </Text>
        <TouchableOpacity
          onPress={() => setShowFromPicker(true)}
          className="border border-gray-300 rounded-lg px-3 py-2 mb-3"
        >
          <Text>{formatDate(fromDate)}</Text>
        </TouchableOpacity>
        {showFromPicker && (
          <DateTimePicker
            value={
              fromDate instanceof Date && !isNaN(fromDate)
                ? fromDate
                : new Date()
            }
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleFromChange}
          />
        )}

        {/* To Date */}
        <Text className="text-sm font-medium text-gray-700 mb-1">To Date</Text>
        <TouchableOpacity
          onPress={() => setShowToPicker(true)}
          className="border border-gray-300 rounded-lg px-3 py-2 mb-3"
        >
          <Text>{formatDate(toDate)}</Text>
        </TouchableOpacity>
        {showToPicker && (
          <DateTimePicker
            value={
              toDate instanceof Date && !isNaN(toDate) ? toDate : new Date()
            }
            mode="date"
            minimumDate={fromDate} //
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleToChange}
          />
        )}
        {/* Remote Work Acknowledgement Section */}
        {leaveType === "Remote" && (
          <View className="border border-gray-200 bg-gray-100 p-4 rounded-lg mb-5">
            {/* Agreement text only when NOT agreed */}
            {!agreed && (
              <ScrollView
                style={{
                  maxHeight: 200,
                  padding: 8,
                  backgroundColor: "#fff",
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                <Text
                  style={{ color: "#374151", fontSize: 13, lineHeight: 18 }}
                >
                  {remoteAgreementText}
                </Text>
              </ScrollView>
            )}

            {/* Checkbox always visible */}
            <View className="flex-row items-center mt-3">
              <Checkbox
                value={agreed}
                onValueChange={setAgreed}
                color={agreed ? COLORS.primary : undefined}
              />
              <Text className="ml-2 text-gray-700 text-sm flex-1">
                I have read and agree to the full remote work policy.
              </Text>
            </View>
          </View>
        )}

        {/* Posting Date */}
        <Text className="text-sm font-medium text-gray-700 mb-1">
          Posting Date
        </Text>
        <View className="border border-gray-300 rounded-lg px-3 py-2 mb-4 bg-gray-100">
          <Text>{formatDate(postingDate)}</Text>
        </View>

        {/* Submit button */}
        <SubmitButton
          title="Submit Leave Request"
          loading={loading}
          onPress={handleSubmit}
        />

        {/* Leave Application History */}
        <Text className="text-lg font-semibold mt-6 mb-3 text-gray-800">
          Leave Application History
        </Text>

        {isFetchingHistory ? (
          <View className="items-center py-6">
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text className="text-gray-500 mt-2">
              Loading leave applications...
            </Text>
          </View>
        ) : visibleLeaves.length === 0 ? (
          <Text className="text-gray-500 text-center mt-6">
            No leave applications yet.
          </Text>
        ) : (
          <>
            {visibleLeaves.map((item, index) => (
              <View key={item?.name || index} className="mb-4">
                <LeaveApplicationCard leave={item} />
              </View>
            ))}

            {hasMoreLeaves && (
              <TouchableOpacity
                onPress={showMoreLeaves}
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
