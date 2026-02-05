import { useState, useLayoutEffect, useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { uploadLeaveAttachment } from "../services/api";
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
import Entypo from "@expo/vector-icons/Entypo";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import Checkbox from "expo-checkbox";
import { useSelector } from "react-redux";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { COLORS, SIZES } from "../constants";
import { createLeaveApplication, getLeaveTypes } from "../services/api";
const REMOTE_AGREEMENT_TEXT = `I acknowledge and agree to the proposed remote work arrangement.

I understand and agree to fulfil all my job responsibilities while working remotely, as outlined in my job description or as assigned by the Company.

I will maintain regular communication (30 minutes span) with my team members, supervisors, and other stakeholders through the designated communication channels established by the Company.

I will be available during the Company's regular working hours, making any necessary adjustments to accommodate time zone differences, if applicable. I will promptly notify my supervisor or designated point of contact of any anticipated unavailability or need for schedule adjustments.

I confirm that I possess the necessary equipment and technology required to perform my job remotely, including a reliable internet connection, a suitable computer or device, and any other tools specified by the Company.

I will be responsible for maintaining and securing my equipment and promptly reporting any technical issues or concerns to the designated IT support team.

I agree to maintain the confidentiality of all company information, trade secrets, customer data, and other sensitive information, both during and after the remote work arrangement.

I acknowledge that the remote work arrangement may be subject to reasonable changes and adjustments based on the Company's evolving needs, operational requirements, or changing circumstances.

I acknowledge that, at the Company's discretion, I may be required to return to the office for important meetings, collaborative work, training sessions, or as directed by the Company.

The employer reserves the right to approve or deny the leave request based on business needs and operational requirements.`;

export default function LeaveRequestScreen() {
  const employeeCode = useSelector(selectEmployeeCode);
  const [leaveType, setLeaveType] = useState("__none__");
  const [reason, setReason] = useState("");
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [postingDate] = useState(new Date());
  const [agreed, setAgreed] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [attachment, setAttachment] = useState(null);

  const navigation = useNavigation();
  useEffect(() => {
    fetchLeaveTypes();
  }, []);
  useEffect(() => {
    if (leaveType !== "Remote") {
      setAgreed(false);
    }
  }, [leaveType]);

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

  // ✅ Helper: format date as YYYY-MM-DD
  const formatDate = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  };
  const fetchLeaveTypes = async () => {
    const { message, error } = await getLeaveTypes();

    if (error) {
      Alert.alert("Error", error);
    } else {
      setLeaveTypes(message || []);
    }
  };
  const pickAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const file = result.assets[0];

    setAttachment({
      uri: file.uri,
      name: file.name,
      type: file.mimeType || "application/octet-stream",
    });
  };

  const handleFromChange = (event, selectedDate) => {
    setShowFromPicker(false);
    if (event.type === "dismissed") return;
    if (selectedDate) setFromDate(selectedDate);
  };

  const handleToChange = (event, selectedDate) => {
    setShowToPicker(false);
    if (event.type === "dismissed") return;
    if (selectedDate) setToDate(selectedDate);
  };

  const handleSubmit = async () => {
    const normalizeDate = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const from = normalizeDate(fromDate);
    const to = normalizeDate(toDate);

    // ❌ Only block if To date is BEFORE From date
    if (to < from) {
      Alert.alert("Invalid Date", "To date cannot be before From date.");
      return;
    }
    if (!leaveType || leaveType === "__none__") {
      Alert.alert("Missing Field", "Please select a leave type.");
      return;
    }

    // 🟢 Single day leave when dates are same
    const isSingleDayLeave = from.getTime() === to.getTime();

    if (leaveType === "Remote" && !agreed) {
      Alert.alert(
        "Agreement Required",
        "Please scroll through and agree to the remote work policy before submitting.",
      );
      return;
    }

    const leaveData = {
      leave_type: leaveType,
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      posting_date: formatDate(new Date()),
      reason: reason.trim(),
      acknowledgement_policy: leaveType === "Remote" ? 1 : undefined,
    };

    try {
      setLoading(true);
      const { message, error } = await createLeaveApplication(leaveData);

      if (error) {
        Alert.alert("Error", error);
        return;
      }
      const docname = message?.id;

      if (!docname) {
        throw new Error("Leave docname missing");
      }

      if (attachment) {
        console.log("Uploading leave attachment:", {
          attachment,
          docname,
        });
        await uploadLeaveAttachment(attachment, docname);
        console.log("Leave upload OK:", docname);
      }

      Alert.alert("Success", "Leave request submitted successfully!");
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

      {/* Leave Type Picker */}
      <Text className="text-sm font-medium text-gray-700 mb-1">
        Select Leave Type
      </Text>
      <View className="border border-gray-300 rounded mb-4 bg-gray-50">
        <Picker selectedValue={leaveType} onValueChange={setLeaveType}>
          <Picker.Item label="Select Leave Type" value="__none__" />

          {leaveTypes.map((item, index) => (
            <Picker.Item
              key={index}
              label={String(item?.leave_type || "")}
              value={String(item?.leave_type || "")}
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
      {/* Attachment */}
      <Text className="text-sm font-medium text-gray-700 mb-1">
        Attachment (optional)
      </Text>

      <TouchableOpacity
        onPress={pickAttachment}
        className="border border-dashed border-gray-400 rounded-lg p-3 mb-3"
      >
        <Text className="text-gray-600 text-center">
          {attachment ? attachment.name : "Upload Attachment (Image / PDF)"}
        </Text>
      </TouchableOpacity>

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
              <Text style={{ color: "#374151", fontSize: 13, lineHeight: 18 }}>
                {REMOTE_AGREEMENT_TEXT}
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
