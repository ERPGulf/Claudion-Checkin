import React, { useState,useEffect } from "react";
import {
  ToastAndroid,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import PropTypes from "prop-types";
import { COLORS } from "../../constants";
import SubmitButton from "../common/SubmitButton";
import { useAttachmentPicker } from "../../hooks/useAttachmentPicker";
import AttachmentBottomSheet from "../attachment/AttachmentBottomSheet";
import { getExpenseTypes } from "../../services/api/expense.service";
function ClaimForm({ onSubmit, isLoading, resetSignal }) {
  const [expenseDate, setExpenseDate] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [fileUrl, setFileUrl] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  useEffect(() => {
    setExpenseDate("");
    setExpenseType("");
    setDescription("");
    setAmount("");
    setFileUrl(null);
  }, [resetSignal]);

  useEffect(() => {
    loadExpenseTypes();
  }, []);

  const loadExpenseTypes = async () => {
    const res = await getExpenseTypes();

    if (res?.error) {
      showToast(res.error);
      return;
    }

    setExpenseTypes(res.message || []);
  };

  const handleDateChange = (event, selectedDate) => {
    setShowPicker(false);
    if (selectedDate) {
      const formatted = selectedDate.toISOString().split("T")[0];
      setExpenseDate(formatted);
    }
  };

  const showDatePicker = () => setShowPicker(true);

  const pickFile = () => setBottomSheetVisible(true);

  const handlePickCamera = () => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromCamera();
      if (file) {
        setFileUrl(file);
        showToast(`✅ Photo attached: ${file.name}`);
      }
    }, 500);
  };

  const handlePickGallery = () => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromGallery();
      if (file) {
        setFileUrl(file);
        showToast(`✅ Image attached: ${file.name}`);
      }
    }, 500);
  };

  const handlePickDocument = () => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickDocument();
      if (file) {
        setFileUrl(file);
        showToast(`✅ File attached: ${file.name}`);
      }
    }, 500);
  };

  const handleRemoveAttachment = () => setFileUrl(null);

  const showToast = (msg) => {
    if (Platform.OS === "android") ToastAndroid.show(msg, ToastAndroid.SHORT);
    else Alert.alert("Notice", msg);
  };

  const handleSubmit = async () => {
    if (!expenseDate.trim()) return showToast("Please select an expense date.");
    if (!expenseType) return showToast("Please select an expense type.");
    if (!amount.trim() || Number.isNaN(Number(amount))) {
      return showToast("Please enter a valid amount.");
    }

    const payload = {
      expense_date: expenseDate.trim(),
      expense_type: expenseType,
      description: description.trim(),
      amount: Number.parseFloat(amount),
      file_url: fileUrl,
    };

    try {
      await onSubmit?.(payload);
    } catch {
      showToast("Failed to submit claim. Please try again.");
    }
  };

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
        <Picker selectedValue={expenseType} onValueChange={setExpenseType}>
          <Picker.Item label="Select type" value="" />

          {expenseTypes.map((type) => (
            <Picker.Item key={type} label={type} value={type} />
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
        onClose={() => setBottomSheetVisible(false)}
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
