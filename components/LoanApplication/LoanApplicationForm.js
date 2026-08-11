import React, { useState, useEffect, useMemo } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  Platform,
  ToastAndroid,
  Alert,
} from "react-native";
import PropTypes from "prop-types";

import SubmitButton from "../common/SubmitButton";
import { getLoanProducts } from "../../services/api/loanApplication.service";
import SelectField from "../common/SelectField";
import AttachmentPicker from "../attachment/AttachmentPicker";
import AttachmentBottomSheet from "../attachment/AttachmentBottomSheet";
import { useAttachmentPicker } from "../../hooks/useAttachmentPicker";

function LoanApplicationForm({ onSubmit, isLoading, resetSignal }) {
  const [productName, setProductName] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // Repayment
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [repaymentMethod, setRepaymentMethod] = useState("");

  // Attachments
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);

  const [activeAttachment, setActiveAttachment] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);

  const [loanProducts, setLoanProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  /* ===========================
     Reset Form
  =========================== */

  useEffect(() => {
    setProductName("");
    setAmount("");
    setReason("");
    setRepaymentAmount("");
    setRepaymentMethod("");
    setFile1(null);
    setFile2(null);
  }, [resetSignal]);

  /* ===========================
     Get Loan Products
  =========================== */

  useEffect(() => {
    fetchLoanProducts();
  }, []);

  const fetchLoanProducts = async () => {
    try {
      setLoadingProducts(true);

      const response = await getLoanProducts();

      setLoanProducts(response || []);
    } catch (error) {
      console.log("Loan Products Error:", error);
      showToast("Unable to load loan products.");
    } finally {
      setLoadingProducts(false);
    }
  };

  /* ===========================
     Loan Product Options
  =========================== */

  const productOptions = useMemo(
    () =>
      loanProducts
        .filter((item) => item?.name || item?.product_name)
        .map((item) => ({
          label: item.product_name || item.name,

          value: item.name || item.product_name,
        })),
    [loanProducts],
  );

  /* ===========================
     Repayment Method Options
  =========================== */

  const repaymentMethodOptions = [
    {
      label: "Repay Fixed Amount per Period",
      value: "Repay Fixed Amount per Period",
    },
  ];

  /* ===========================
     Toast
  =========================== */

  const showToast = (msg) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(msg, ToastAndroid.SHORT);
    } else {
      Alert.alert("Notice", msg);
    }
  };

  /* ===========================
     Attachment Picker
  =========================== */

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

  /* ===========================
     Submit
  =========================== */

  const handleSubmit = async () => {
    const amountValue = Number(amount);
    const repaymentAmountValue = Number(repaymentAmount);

    if (!productName.trim()) {
      return showToast("Please select loan product.");
    }

    if (!amount.trim()) {
      return showToast("Please enter amount.");
    }

    if (isNaN(amountValue) || amountValue <= 0) {
      return showToast("Please enter a valid amount.");
    }

    if (!repaymentAmount.trim()) {
      return showToast("Please enter repayment amount.");
    }

    if (isNaN(repaymentAmountValue) || repaymentAmountValue <= 0) {
      return showToast("Please enter a valid repayment amount.");
    }

    if (!repaymentMethod) {
      return showToast("Please select repayment method.");
    }

    if (!reason.trim()) {
      return showToast("Please enter the reason.");
    }

    if (!file1) {
      return showToast("Please upload File 1.");
    }

    const payload = {
      product_name: productName.trim(),

      amount: amountValue,

      repayment_amount: repaymentAmountValue,

      repayment_method: repaymentMethod,

      reason: reason.trim(),

      file1,

      file2,
    };

    console.log("Loan Form Payload:", payload);

    try {
      await onSubmit?.(payload);
    } catch (error) {
      console.log("Loan submit error:", error);
    }
  };

  /* ===========================
     UI
  =========================== */

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 30,
        }}
      >
        <Text className="text-xl font-semibold text-gray-900 mb-5">
          Loan Application
        </Text>

        {/* Loan Product */}

        <Label text="Loan Product" required />

        <SelectField
          value={productName}
          options={productOptions}
          onChange={setProductName}
          placeholder="Select Loan Product"
          title="Loan Product"
          loading={loadingProducts}
          emptyText="No loan products available"
        />

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

        {/* Repayment Amount */}

        <Label text="Repayment Amount" required />

        <TextInput
          placeholder="Enter repayment amount"
          placeholderTextColor="#6B7280"
          value={repaymentAmount}
          onChangeText={setRepaymentAmount}
          keyboardType="numeric"
          className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 text-gray-900"
        />

        {/* Repayment Method */}

        <Label text="Repayment Method" required />

        <SelectField
          value={repaymentMethod}
          options={repaymentMethodOptions}
          onChange={setRepaymentMethod}
          placeholder="Select Repayment Method"
          title="Repayment Method"
        />

        {/* Reason */}

        <Label text="Reason" required />

        <TextInput
          placeholder="Enter reason"
          placeholderTextColor="#6B7280"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          className="border border-gray-300 rounded p-2 mb-3 bg-gray-50 text-gray-900"
          style={{
            height: 100,
          }}
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

        {/* Submit */}

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

/* ===========================
   Label
=========================== */

const Label = ({ text, required, optional }) => (
  <Text className="text-sm font-medium text-gray-700 mb-2">
    {text} {required && <Text className="text-red-500">*</Text>}
    {optional && <Text className="text-gray-500"> (Optional)</Text>}
  </Text>
);

Label.propTypes = {
  text: PropTypes.string.isRequired,
  required: PropTypes.bool,
  optional: PropTypes.bool,
};

LoanApplicationForm.propTypes = {
  onSubmit: PropTypes.func,
  isLoading: PropTypes.bool,
  resetSignal: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
};

export default LoanApplicationForm;
