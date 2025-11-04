
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Checkbox from "expo-checkbox";
import { useSelector } from "react-redux";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { createLeaveApplication } from "../api/userApi";
import { COLORS } from "../constants";

export default function LeaveRequestScreen() {
  const employeeCode = useSelector(selectEmployeeCode);

  const [leaveType, setLeaveType] = useState("");
  const [reason, setReason] = useState("");
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [postingDate] = useState(new Date());
  const [agreed, setAgreed] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  // ✅ Helper: format date as YYYY-MM-DD
  const formatDate = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  const handleFromChange = (event, selectedDate) => {
    setShowFromPicker(false);
    if (selectedDate) setFromDate(selectedDate);
  };

  const handleToChange = (event, selectedDate) => {
    setShowToPicker(false);
    if (selectedDate) setToDate(selectedDate);
  };

  const handleSubmit = async () => {
    if (!leaveType) {
      Alert.alert("Missing Field", "Please select a leave type.");
      return;
    }

    if (leaveType === "Remote" && !agreed) {
      Alert.alert(
        "Agreement Required",
        "Please scroll through and agree to the remote work policy before submitting."
      );
      return;
    }

    const leaveData = {
      employee: employeeCode,
      leave_type: leaveType,
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      posting_date: formatDate(postingDate),
      reason,
      acknowledgement_policy: leaveType === "Remote" && agreed ? 1 : undefined,
    };

    try {
      setLoading(true);
      const { message, error } = await createLeaveApplication(leaveData);

      if (error) {
        Alert.alert(
          "Error",
          typeof error === "string" ? error : JSON.stringify(error)
        );
      } else {
        Alert.alert(
          "Success",
          typeof message === "string"
            ? message
            : "Leave request submitted successfully!"
        );
      }
    } catch (err) {
      console.error("⚠️ Submit error:", err);
      Alert.alert("Error", err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView className="p-4 bg-white">
      <Text className="text-xl font-semibold mb-4 text-gray-800">
        Leave Application
      </Text>

      {/* Leave Type Selection */}
      <Text className="text-sm font-medium text-gray-700 mb-2">Leave Type</Text>
      <View className="flex-row justify-between mb-4">
        {["Remote", "Annual", "Out Of Office"].map((type) => (
          <TouchableOpacity
            key={type}
            onPress={() => setLeaveType(type)}
            className={`flex-1 mx-1 p-3 rounded-xl border ${
              leaveType === type
                ? "bg-gray-600 border-gray-600 shadow-md"
                : "border-gray-300 bg-gray-100"
            }`}
          >
            <Text
              className={`text-center font-semibold ${
                leaveType === type ? "text-white" : "text-gray-700"
              }`}
            >
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Reason */}
      <Text className="text-sm font-medium text-gray-700 mb-1">Reason</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Enter reason for leave"
        multiline
        className="border border-gray-300 rounded-lg px-3 py-2 mb-3"
      />

      {/* From Date */}
      <Text className="text-sm font-medium text-gray-700 mb-1">From Date</Text>
      <TouchableOpacity
        onPress={() => setShowFromPicker(true)}
        className="border border-gray-300 rounded-lg px-3 py-2 mb-3"
      >
        <Text>{formatDate(fromDate)}</Text>
      </TouchableOpacity>
      {showFromPicker && (
        <DateTimePicker
          value={fromDate}
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
          value={toDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleToChange}
        />
      )}

      {/* Remote Work Acknowledgement Section */}
      {leaveType === "Remote" && (
        <View className="border border-blue-200 bg-blue-20 p-4 rounded-lg mb-5">
          <ScrollView
            style={{
              maxHeight: 200,
              padding: 8,
              backgroundColor: "#fff",
              borderRadius: 6,
              borderWidth: 1,
              borderColor: "#bfdbfe",
            }}
            nestedScrollEnabled={true}
          >
            <Text style={{ color: "#374151", fontSize: 13, lineHeight: 18 }}>
              I acknowledge and agree to the proposed remote work arrangement.
              {"\n\n"}I understand and agree to fulfil all my job
              responsibilities while working remotely, as outlined in my job
              description or as assigned by the Company.{"\n\n"}I will maintain
              regular communication (30 minutes span) with my team members,
              supervisors, and other stakeholders through the designated
              communication channels established by the Company.{"\n\n"}I will
              be available during the Company's regular working hours, making
              any necessary adjustments to accommodate time zone differences, if
              applicable. I will promptly notify my supervisor or designated
              point of contact of any anticipated unavailability or need for
              schedule adjustments.{"\n\n"}I confirm that I possess the
              necessary equipment and technology required to perform my job
              remotely, including a reliable internet connection, a suitable
              computer or device, and any other tools specified by the Company.
              {"\n\n"}I will be responsible for maintaining and securing my
              equipment and promptly reporting any technical issues or concerns
              to the designated IT support team.{"\n\n"}I agree to maintain the
              confidentiality of all company information, trade secrets,
              customer data, and other sensitive information, both during and
              after the remote work arrangement.{"\n\n"}I acknowledge that the
              remote work arrangement may be subject to reasonable changes and
              adjustments based on the Company's evolving needs, operational
              requirements, or changing circumstances.{"\n\n"}I acknowledge
              that, at the Company's discretion, I may be required to return to
              the office for important meetings, collaborative work, training
              sessions, or as directed by the Company.{"\n\n"}
              The employer reserves the right to approve or deny the leave
              request based on business needs and operational requirements.{"\n\n"}
            </Text>
          </ScrollView>

          {/* Checkbox agreement */}
          <View className="flex-row items-center mt-2">
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
      <TouchableOpacity
        onPress={handleSubmit}
        disabled={loading}
        className={`p-3 rounded-lg ${loading ? "bg-gray-400" : "bg-green-600"}`}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-center font-semibold">
            Submit Leave Request
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
