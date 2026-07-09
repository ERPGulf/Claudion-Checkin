import React, { useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  ToastAndroid,
  Alert,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import PropTypes from "prop-types";
import { COLORS } from "../../constants";
import SubmitButton from "../common/SubmitButton";

function SalaryAdvanceForm({ onSubmit, isLoading, resetSignal }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setAmount("");
    setReason("");
    setDate("");
  }, [resetSignal]);

  const showToast = (msg) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      Alert.alert("Notice", msg);
    }
  };

  const handleDateChange = (event, selectedDate) => {
    setShowPicker(false);

    if (selectedDate) {
      const formatted = selectedDate.toISOString().split("T")[0];
      setDate(formatted);
    }
  };

  const handleSubmit = async () => {
    if (!amount.trim()) {
      return showToast("Please enter amount.");
    }

    if (Number(amount) <= 0) {
      return showToast("Amount should be greater than zero.");
    }

    const payload = {
      amount: Number(amount),
      date,
      reason: reason.trim() || "nill",
    };

    try {
      await onSubmit?.(payload);
    } catch {
      showToast("Failed to submit salary advance request.");
    }
  };

  return (
    <ScrollView
      className="bg-white p-4 rounded-lg shadow"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-xl font-semibold mb-4 text-gray-800">
        Salary Advance Form
      </Text>

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

      {/* Date */}
      <Label text="Date" required />

      <TouchableOpacity
        onPress={() => setShowPicker(true)}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 flex-row justify-between items-center"
      >
        <Text className={date ? "text-gray-700" : "text-gray-400"}>
          {date || "Select Date"}
        </Text>

        <Ionicons name="calendar-outline" size={22} color={COLORS.primary} />
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker
          value={date ? new Date(date) : new Date()}
          mode="date"
          display="default"
          minimumDate={new Date()}
          onChange={handleDateChange}
        />
      )}

      {/* Reason */}
      <Label text="Reason" optional />

      <TextInput
        placeholder="Enter reason"
        placeholderTextColor="#6B7280"
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={3}
        className="border border-gray-300 rounded p-2 mb-5 bg-gray-50 text-gray-900"
      />

      {/* Submit */}
      <SubmitButton
        title="Submit Request"
        loading={isLoading}
        onPress={handleSubmit}
      />
    </ScrollView>
  );
}

export default SalaryAdvanceForm;

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
