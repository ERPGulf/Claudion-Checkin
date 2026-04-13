import { useState, useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Entypo from "@expo/vector-icons/Entypo";
import DateTimePicker from "@react-native-community/datetimepicker";
import Checkbox from "expo-checkbox";
import { COLORS, SIZES } from "../constants";
import SubmitButton from "../components/common/SubmitButton";
import { createAttendanceRequest } from "../services/api/attendance.service";
import { useSelector } from "react-redux";
import { selectEmployeeCode } from "../redux/Slices/UserSlice";

export default function AttendanceRequestScreen() {
  const navigation = useNavigation();
  const employeeCode = useSelector(selectEmployeeCode);

  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const [selectedReason, setSelectedReason] = useState("");

  const today = new Date();

  const reasons = ["Work From Home", "On Duty"];
  const [loading, setLoading] = useState(false);

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

  // ✅ FORMAT DATE
  const formatDate = (d) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const handleSubmit = async () => {
    if (!employeeCode) {
      Alert.alert("Error", "Employee not found. Please login again.");
      return;
    }

    if (toDate < fromDate) {
      Alert.alert("Invalid Date", "To date cannot be before From date.");
      return;
    }

    if (!selectedReason) {
      Alert.alert("Missing Field", "Please select a reason.");
      return;
    }

    const payload = {
      employee: employeeCode,
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      reason: selectedReason,
    };

    try {
      setLoading(true);

      const res = await createAttendanceRequest(payload);

      if (!res.success) {
        Alert.alert("Error", res.message);
      } else {
        Alert.alert("Success", res.message);

        setFromDate(new Date());
        setToDate(new Date());
        setSelectedReason("");
      }
    } catch (error) {
      Alert.alert("Error", "Something went wrong");
    } finally {
      setLoading(false);
    }
  };
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
          onPress={() => setShowFromPicker(true)}
          className="border border-gray-300 rounded px-3 py-2 mb-3"
        >
          <Text>{formatDate(fromDate)}</Text>
        </TouchableOpacity>

        {showFromPicker && (
          <DateTimePicker
            value={fromDate}
            mode="date"
            maximumDate={today}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(e, selected) => {
              setShowFromPicker(false);
              if (selected) setFromDate(selected);
            }}
          />
        )}

        {/* TO DATE */}
        <Text className="text-sm font-medium text-gray-700 mb-1">To Date</Text>
        <TouchableOpacity
          onPress={() => setShowToPicker(true)}
          className="border border-gray-300 rounded px-3 py-2 mb-4"
        >
          <Text>{formatDate(toDate)}</Text>
        </TouchableOpacity>

        {showToPicker && (
          <DateTimePicker
            value={toDate}
            mode="date"
            maximumDate={today}
            minimumDate={fromDate}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(e, selected) => {
              setShowToPicker(false);
              if (selected) setToDate(selected);
            }}
          />
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

        {/* SUBMIT */}
        <SubmitButton
          title="Submit Attendance Request"
          loading={loading}
          onPress={handleSubmit}
          disabled={loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
