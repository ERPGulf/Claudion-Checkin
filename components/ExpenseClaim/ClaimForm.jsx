import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import PropTypes from "prop-types";
import SubmitButton from "../common/SubmitButton";
import AttachmentBottomSheet from "../attachment/AttachmentBottomSheet";
import useExpenseClaimForm from "../../hooks/useExpenseClaimForm";

/**
 * TEMPORARY (New Home Experience experiment) — the classic Expense Claim form.
 *
 * The markup is unchanged from what shipped: same labels, same gray-50 inputs,
 * same @react-native-picker/picker dropdown, same green "Attached" button, same
 * <SubmitButton>. Only the state moved — every field, the expense-type fetch,
 * the date handler, the attachment pickers and `handleSubmit` now come from
 * hooks/useExpenseClaimForm.js, shared with the modern screen, so validation and
 * the submitted payload are the same on both.
 *
 * On removal of the experiment: delete this file along with ExpenseClaimLegacy.
 */
function ClaimForm({ onSubmit, isLoading, resetSignal }) {
  const {
    expenseDate,
    expenseType,
    description,
    amount,
    fileUrl,
    expenseTypes,
    setExpenseType,
    setDescription,
    setAmount,
    showPicker,
    showDatePicker,
    handleDateChange,
    isBottomSheetVisible,
    pickFile,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleRemoveAttachment,
    handleSubmit,
  } = useExpenseClaimForm({ onSubmit, resetSignal });

  return (
    <ScrollView
      className="bg-white p-4 rounded-lg shadow"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-xl font-semibold mb-4 text-gray-800">
        Expense Claim Form
      </Text>

      {/* Expense Date */}
      <Label text="Expense Date" required />
      <TouchableOpacity
        onPress={showDatePicker}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50"
      >
        <Text className="text-gray-700">
          {expenseDate || "Select Expense Date"}
        </Text>
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker
          value={expenseDate ? new Date(expenseDate) : new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}

      {/* Expense Type */}
      <Label text="Expense Type" required />
      <View className="border border-gray-300 rounded mb-3 bg-gray-50">
        <Picker
          selectedValue={expenseType}
          onValueChange={setExpenseType}
          style={{ color: "#111827" }}
        >
          <Picker.Item label="Select type" value="" color="#9CA3AF" />

          {expenseTypes.map((type) => (
            <Picker.Item key={type} label={type} value={type} color="#111827" />
          ))}
        </Picker>
      </View>

      {/* Description */}
      <Label text="Description" optional />
      <TextInput
        placeholder="Enter description"
        placeholderTextColor="#6B7280"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50  text-gray-900"
      />

      {/* Amount */}
      <Label text="Amount" required />
      <TextInput
        placeholder="Enter amount"
        placeholderTextColor="#6B7280"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 text-gray-900"
      />

      {/* File Upload */}
      <TouchableOpacity
        onPress={pickFile}
        className={`border p-3 mb-3 rounded items-center ${
          fileUrl
            ? "bg-green-100 border-green-500"
            : "bg-gray-50 border-gray-300"
        }`}
      >
        <Text
          className={`${
            fileUrl ? "text-green-700 font-semibold" : "text-gray-700"
          }`}
        >
          {fileUrl
            ? `Attached: ${fileUrl?.name || "File"} ✅`
            : "Attach Receipt / File"}
        </Text>
      </TouchableOpacity>

      {fileUrl && (
        <View className="mb-2 relative">
          {fileUrl.type?.startsWith("image") ? (
            <Image
              source={{ uri: fileUrl.uri }}
              className="w-full h-40 rounded"
              resizeMode="cover"
            />
          ) : (
            <View className="border p-3 bg-gray-200 rounded mb-1">
              <Text>{fileUrl.name}</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={handleRemoveAttachment}
            className="absolute top-2 right-2 bg-red-500 p-1 rounded-full"
          >
            <Text className="text-white text-sm font-semibold">X</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Submit Button */}
      <SubmitButton
        title="Submit Claim"
        loading={isLoading}
        onPress={handleSubmit}
      />

      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </ScrollView>
  );
}

export default ClaimForm;

//
// ✅ Label Component Added Below
//
const Label = ({ text, required, optional }) => (
  <Text className="text-gray-700 mb-1">
    {text} {required && <Text className="text-red-500">*</Text>}
    {optional && <Text className="text-gray-400">(Optional)</Text>}
  </Text>
);

Label.propTypes = {
  text: PropTypes.string.isRequired,
  required: PropTypes.bool,
  optional: PropTypes.bool,
};
