import { formatExpenseDate } from '../../utils/expenseClaims';
import { translateMessage, t, getLanguage, useTranslation } from '../../localization';
import React, { useEffect, useState } from "react";
import { ScrollView, TouchableOpacity, Platform, ToastAndroid, Alert } from 'react-native';
import TextInput from '../../localization/LocalizedTextInput';
import Text from '../../localization/LocalizedText';
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import PropTypes from "prop-types";
import { COLORS } from "../../constants";
import SubmitButton from "../common/SubmitButton";

function SalaryAdvanceForm({ onSubmit, isLoading, resetSignal }) {
  useTranslation();
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setAmount("");
    setPurpose("");
    setDate("");
  }, [resetSignal]);

  const showToast = (msg) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(translateMessage(msg), ToastAndroid.SHORT);
    } else {
      Alert.alert(t("Notice"), translateMessage(msg));
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
    const amountValue = Number(amount);

    if (!amount.trim()) {
      return showToast(t("Please enter amount."));
    }

    if (isNaN(amountValue) || amountValue <= 0) {
      return showToast(t("Please enter a valid amount greater than zero."));
    }

    if (!date) {
      return showToast(t("Please select a date."));
    }

    if (!purpose.trim()) {
      return showToast(t("Please enter the purpose."));
    }

    const payload = {
      amount: amountValue,
      date,
      purpose: purpose.trim(),
    };

    try {
      const response = await onSubmit?.(payload);
    
    } catch (error) {
      console.log("Submit Error:", error);
      showToast(t("Failed to submit salary advance request."));
    }
  };

  return (
    <ScrollView
      className="bg-white p-4 rounded-lg shadow"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-xl font-semibold mb-4 text-gray-800">{t("Salary Advance Form")}</Text>

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

      {/* Date */}
      <Label text={t("Date")} required />

      <TouchableOpacity
        onPress={() => setShowPicker(true)}
        className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 flex-row justify-between items-center"
      >
        <Text className={date ? "text-gray-700" : "text-gray-400"}>
          {date ? formatExpenseDate(date) : t("Select Date")}
        </Text>

        <Ionicons name="calendar-outline" size={22} color={COLORS.primary} />
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker locale={getLanguage()}
          value={date ? new Date(date) : new Date()}
          mode="date"
          display="default"
          minimumDate={new Date()}
          onChange={handleDateChange}
        />
      )}

      {/* Purpose */}
      <Label text={t("Purpose")} required />

      <TextInput
        placeholder={t("Enter purpose")}
        placeholderTextColor="#6B7280"
        value={purpose}
        onChangeText={setPurpose}
        multiline
        numberOfLines={5}
        maxLength={250}
        textAlignVertical="top"
        className="border border-gray-300 rounded p-2 mb-5 bg-gray-50 text-gray-900"
        style={{ height: 120 }}
      />

      {/* Submit */}
      <SubmitButton
        title={t("Submit Request")}
        loading={isLoading}
        onPress={handleSubmit}
      />
    </ScrollView>
  );
}

export default SalaryAdvanceForm;

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
