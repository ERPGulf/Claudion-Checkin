import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  ToastAndroid,
  Image,
  StatusBar,
  StyleSheet,
} from "react-native";

import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { LinearGradient } from "expo-linear-gradient";
import { Entypo } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import SubmitButton from "../components/common/SubmitButton";
import AttachmentBottomSheet from "../components/attachment/AttachmentBottomSheet";
import { useAttachmentPicker } from "../hooks/useAttachmentPicker";

import {
  getExpenseTypes,
  createExpenseClaim,
} from "../services/api/expense.service";

export default function ClaimForm({ isLoading, resetSignal }) {
  const [expenseDate, setExpenseDate] = useState("");
  const [expenseType, setExpenseType] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [fileUrl, setFileUrl] = useState(null);

  const [showPicker, setShowPicker] = useState(false);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [expenseTypes, setExpenseTypes] = useState([]);

  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const {
    pickFromCamera,
    pickFromGallery,
    pickDocument,
  } = useAttachmentPicker();

  useEffect(() => {
    resetForm();
  }, [resetSignal]);

  useEffect(() => {
    loadExpenseTypes();
  }, []);

  const resetForm = () => {
    setExpenseDate("");
    setExpenseType("");
    setDescription("");
    setAmount("");
    setFileUrl(null);
  };

  const showToast = (msg) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      Alert.alert("Notice", msg);
    }
  };

  const loadExpenseTypes = async () => {
    try {
      const res = await getExpenseTypes();

      if (res?.error) {
        return showToast(res.error);
      }

      setExpenseTypes(res.message || []);
    } catch (err) {
      console.log("EXPENSE TYPE ERROR:", err);
      showToast("Unable to load expense types.");
    }
  };

  const handleDateChange = (event, selectedDate) => {
    setShowPicker(false);

    if (selectedDate) {
      // timezone-safe format
      const formatted =
        selectedDate.getFullYear() +
        "-" +
        String(selectedDate.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(selectedDate.getDate()).padStart(2, "0");

      setExpenseDate(formatted);
    }
  };

  const pickFile = () => {
    setBottomSheetVisible(true);
  };

  const handlePickCamera = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const file = await pickFromCamera();

      if (file) {
        setFileUrl(file);
        showToast(`✅ Photo attached: ${file.name}`);
      }
    }, 300);
  };

  const handlePickGallery = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const file = await pickFromGallery();

      if (file) {
        setFileUrl(file);
        showToast(`✅ Image attached: ${file.name}`);
      }
    }, 300);
  };

  const handlePickDocument = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const file = await pickDocument();

      if (file) {
        setFileUrl(file);
        showToast(`✅ File attached: ${file.name}`);
      }
    }, 300);
  };

  const handleRemoveAttachment = () => {
    setFileUrl(null);
  };

  const handleSubmit = async () => {
    if (isLoading) return;

    if (!expenseDate.trim()) {
      return showToast("Please select an expense date.");
    }

    if (!expenseType) {
      return showToast("Please select an expense type.");
    }

    const parsedAmount = parseFloat(amount);

    if (
      !amount.trim() ||
      isNaN(parsedAmount) ||
      parsedAmount <= 0
    ) {
      return showToast("Please enter a valid amount.");
    }

    const payload = {
      expense_date: expenseDate.trim(),
      expense_type: expenseType,
      description: description.trim(),
      amount: parsedAmount,
      file_url: fileUrl,
    };

    console.log("SUBMIT CLICKED", payload);

    try {
      const res = await createExpenseClaim(payload);

      console.log("API RESPONSE:", res);

      if (res?.error) {
        return showToast(res.error);
      }

      showToast("Claim submitted successfully");

      resetForm();

      navigation.goBack();
    } catch (err) {
      console.log("SUBMIT ERROR:", err);
      showToast("Failed to submit claim.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          height: insets.top,
          backgroundColor: "#77224C",
        }}
      />

      {/* HEADER */}
      <LinearGradient
        colors={["#77224C", "#8E273B"]}
        style={styles.header}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Entypo
            name="chevron-left"
            size={28}
            color="#fff"
          />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          Expense Claim
        </Text>
      </LinearGradient>

      {/* BODY */}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 120,
        }}
      >
        {/* DATE */}
        <Text style={styles.label}>Expense Date</Text>

        <TouchableOpacity
          onPress={() => setShowPicker(true)}
          style={styles.inputBox}
        >
          <Text style={styles.inputText}>
            {expenseDate || "Select expense date"}
          </Text>
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            value={
              expenseDate
                ? new Date(expenseDate)
                : new Date()
            }
            mode="date"
            display="default"
            onChange={handleDateChange}
          />
        )}

        {/* TYPE */}
        <Text style={styles.label}>Expense Type</Text>

        <View style={[styles.inputBox, { padding: 0 }]}>
          <Picker
            selectedValue={expenseType}
            onValueChange={setExpenseType}
          >
            <Picker.Item
              label="Select type"
              value=""
            />

            {expenseTypes.map((type) => (
              <Picker.Item
                key={type}
                label={type}
                value={type}
              />
            ))}
          </Picker>
        </View>

        {/* DESCRIPTION */}
        <Text style={styles.label}>Description</Text>

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Enter description"
          style={styles.inputBox}
        />

        {/* AMOUNT */}
        <Text style={styles.label}>Amount</Text>

        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="Enter amount"
          style={styles.inputBox}
        />

        {/* ATTACHMENT */}
        <TouchableOpacity
          onPress={pickFile}
          style={styles.attachBox}
        >
          <Text style={{ color: "#6B7280" }}>
            {fileUrl
              ? `Attached: ${fileUrl.name}`
              : "Attach Receipt"}
          </Text>
        </TouchableOpacity>

        {fileUrl && (
          <View style={{ marginTop: 10 }}>
            {fileUrl?.type?.startsWith("image") ? (
              <Image
                source={{ uri: fileUrl.uri }}
                style={{
                  width: "100%",
                  height: 150,
                  borderRadius: 10,
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: "#f3f4f6",
                }}
              >
                <Text>{fileUrl.name}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleRemoveAttachment}
              style={styles.removeBtn}
            >
              <Text style={styles.removeBtnText}>
                X
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* BUTTON */}
      <View style={styles.bottomContainer}>
        <SubmitButton
          title="Submit Claim"
          loading={isLoading}
          onPress={handleSubmit}
        />
      </View>

      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={() => setBottomSheetVisible(false)}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },

  backBtn: {
    position: "absolute",
    left: 16,
    top: "50%",
    transform: [{ translateY: -14 }],
  },

  headerTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "600",
  },

  label: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 6,
    marginTop: 10,
  },

  inputBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fff",
    marginBottom: 10,
  },

  inputText: {
    color: "#111",
  },

  attachBox: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 10,
  },

  bottomContainer: {
    padding: 16,
    paddingBottom: 26,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#eee",
  },

  removeBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },

  removeBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});

