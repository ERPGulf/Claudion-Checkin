import { formatExpenseDate } from '../../utils/expenseClaims';
import { t, getLanguage, useTranslation } from '../../localization';
import React from "react";
import { View, TouchableOpacity, Image, ScrollView } from 'react-native';
import TextInput from '../../localization/LocalizedTextInput';
import Text from '../../localization/LocalizedText';
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
  useTranslation();
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
    needsDoneAffordance,
    closeDatePicker,
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
      <Text className="text-xl font-semibold mb-4 text-gray-800">{t("Expense Claim Form")}</Text>

      {/* Expense Date */}
      <Label text={t("Expense Date")} required />
      <TouchableOpacity
        onPress={showDatePicker}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50"
      >
        <Text className="text-gray-700">
          {expenseDate ? formatExpenseDate(expenseDate) : t("Select Expense Date")}
        </Text>
      </TouchableOpacity>

      {showPicker && (
        <>
          <DateTimePicker locale={getLanguage()}
            value={expenseDate ? new Date(expenseDate) : new Date()}
            mode="date"
            display="default"
            onChange={handleDateChange}
          />
          {needsDoneAffordance && (
            <TouchableOpacity
              onPress={closeDatePicker}
              className="self-end px-3 py-2 mb-2"
            >
              <Text className="text-blue-600 font-medium">{t("Done")}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Expense Type */}
      <Label text={t("Expense Type")} required />
      <View className="border border-gray-300 rounded mb-3 bg-gray-50">
        <Picker
          selectedValue={expenseType}
          onValueChange={setExpenseType}
          style={{ color: "#111827" }}
        >
          <Picker.Item label={t("Select type")} value="" color="#9CA3AF" />

          {expenseTypes.map((type) => (
            <Picker.Item key={type} label={type} value={type} color="#111827" />
          ))}
        </Picker>
      </View>

      {/* Description */}
      <Label text={t("Description")} optional />
      <TextInput
        placeholder={t("Enter description")}
        placeholderTextColor="#6B7280"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50  text-gray-900"
      />

      {/* Amount */}
      <Label text={t("Amount")} required />
      <TextInput
        placeholder={t("Enter amount")}
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
            ? t("Attached: {{name}} ✅", { name: fileUrl?.name || t("File") })
            : t("Attach Receipt / File")}
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
            accessibilityRole="button"
            accessibilityLabel={t("Remove attachment")}
            className="absolute top-2 bg-red-500 p-1 rounded-full"
           style={{ end: 8 }}>
            <Text className="text-white text-sm font-semibold">×</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Submit Button */}
      <SubmitButton
        title={t("Submit Claim")}
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
const Label = ({ text, required, optional }) => {
  useTranslation();
  return (
  <Text className="text-gray-700 mb-1">
    {text} {required && <Text className="text-red-500">*</Text>}
    {optional && <Text className="text-gray-400">{t("(Optional)")}</Text>}
  </Text>
  );
};

Label.propTypes = {
  text: PropTypes.string.isRequired,
  required: PropTypes.bool,
  optional: PropTypes.bool,
};
