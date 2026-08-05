import React, { useState, useEffect } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  ToastAndroid,
  Alert,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import PropTypes from "prop-types";
import { COLORS } from "../../constants";
import SubmitButton from "../common/SubmitButton";
import { getLoanProducts } from "../../services/api/loanApplication.service";
import { Picker } from "@react-native-picker/picker";
import AttachmentPicker from "../attachment/AttachmentPicker";
import AttachmentBottomSheet from "../attachment/AttachmentBottomSheet";
import { useAttachmentPicker } from "../../hooks/useAttachmentPicker";

function LoanApplicationForm({ onSubmit, isLoading, resetSignal }) {
  const [productName, setProductName] = useState("");
  const [amount, setAmount] = useState("");
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [activeAttachment, setActiveAttachment] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();
  const [loanProducts, setLoanProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  useEffect(() => {
    setProductName("");
    setAmount("");
    setFile1(null);
    setFile2(null);
  }, [resetSignal]);

  useEffect(() => {
    fetchLoanProducts();
  }, []);

  const fetchLoanProducts = async () => {
    try {
      setLoadingProducts(true);

      const response = await getLoanProducts();

      console.log("Loan Products:", response);

      setLoanProducts(response || []);
    } catch (error) {
      console.log("Loan Products Error:", error);
      showToast("Unable to load loan products.");
    } finally {
      setLoadingProducts(false);
    }
  };

  const showToast = (msg) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      Alert.alert("Notice", msg);
    }
  };

  const openAttachmentPicker = (type) => {
    setActiveAttachment(type);
    setBottomSheetVisible(true);
  };

  const handlePickCamera = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromCamera();

      if (pickedFile) {
        activeAttachment === "file1"
          ? setFile1(pickedFile)
          : setFile2(pickedFile);
      }
    }, 300);
  };

  const handlePickGallery = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromGallery();

      if (pickedFile) {
        activeAttachment === "file1"
          ? setFile1(pickedFile)
          : setFile2(pickedFile);
      }
    }, 300);
  };

  const handlePickDocument = async () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickDocument();

      if (pickedFile) {
        activeAttachment === "file1"
          ? setFile1(pickedFile)
          : setFile2(pickedFile);
      }
    }, 300);
  };

  const handleSubmit = async () => {
    const amountValue = Number(amount);

    if (!productName.trim()) {
      return showToast("Please enter loan product.");
    }

    if (!amount.trim()) {
      return showToast("Please enter amount.");
    }

    if (isNaN(amountValue) || amountValue <= 0) {
      return showToast("Please enter a valid amount.");
    }

    if (!file1) {
      return showToast("Please upload File 1.");
    }

    const payload = {
      product_name: productName.trim(),
      amount: amountValue,
      file1,
      file2,
    };

    try {
      await onSubmit?.(payload);
    } catch (error) {
      console.log(error);
      showToast("Failed to submit loan application.");
    }
  };

  return (
    <>
      <ScrollView
        className="bg-white p-4 rounded-lg shadow"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold mb-4 text-gray-800">
          Loan Application
        </Text>

        {/* Loan Product */}

        <Label text="Loan Product" required />

        <View
          style={{
            borderWidth: 1,
            borderColor: "#D1D5DB",
            borderRadius: 8,
            backgroundColor: "#F9FAFB",
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <Picker
            selectedValue={productName}
            onValueChange={(value) => setProductName(value)}
            style={{
              height: 50,
              color: "#111827",
            }}
          >
            <Picker.Item label="Select Loan Product" value="" />

            {loanProducts.map((item) => (
              <Picker.Item
                key={item.product_name}
                label={item.product_name}
                value={item.product_name}
              />
            ))}
          </Picker>
        </View>

        {/* Loan Amount */}
        <Label text="Loan Amount" required />

        <TextInput
          placeholder="Enter amount"
          placeholderTextColor="#6B7280"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 text-gray-900"
        />

        {/* Attachment 1 */}
        <AttachmentPicker
          file={file1}
          onPick={() => openAttachmentPicker("file1")}
          onRemove={() => setFile1(null)}
          label="Attachment 1"
        />

        {/* Attachment 2 */}
        <AttachmentPicker
          file={file2}
          onPick={() => openAttachmentPicker("file2")}
          onRemove={() => setFile2(null)}
          label="Attachment 2"
        />

        <SubmitButton
          title="Submit Application"
          loading={isLoading}
          onPress={handleSubmit}
        />
      </ScrollView>

      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={() => setBottomSheetVisible(false)}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </>
  );
}
export default LoanApplicationForm;

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
