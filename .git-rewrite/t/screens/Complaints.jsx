import React, { useState, useLayoutEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import Entypo from "@expo/vector-icons/Entypo";

import { COLORS, SIZES } from "../constants";

import SubmitButton from "../components/common/SubmitButton";
import AttachmentPicker from "../components/attachment/AttachmentPicker";
import AttachmentBottomSheet from "../components/attachment/AttachmentBottomSheet";

import { useAttachmentPicker } from "../hooks/useAttachmentPicker";

import {
  createComplaint,
  uploadComplaintAttachment,
} from "../services/api/complaint.service";

const Complaints = () => {
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);

  const navigation = useNavigation();

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Complaints",
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

  /**
   * Open Bottom Sheet
   */
  const pickFile = () => {
    setBottomSheetVisible(true);
  };

  const handlePickCamera = () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromCamera();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  };

  const handlePickGallery = () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromGallery();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  };

  const handlePickDocument = () => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickDocument();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  };

  const submitComplaint = async () => {
    if (!message.trim()) {
      Alert.alert("Validation", "Please enter complaint message");
      return;
    }

    setLoading(true);

    try {
      const date = new Date().toISOString().replace("T", " ").slice(0, 19);

      const result = await createComplaint({ date, message });

      if (result.error) {
        throw new Error(result.error);
      }

      const docname = result?.message?.message?.name;

      if (!docname) {
        throw new Error("Complaint created but docname missing");
      }

      if (file) {
        await uploadComplaintAttachment(file, docname);
      }

      Alert.alert("Success", "Complaint submitted successfully");

      setMessage("");
      setFile(null);
    } catch (error) {
      Alert.alert("Error", error?.message || "Failed to submit complaint");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-xl font-semibold mb-4 text-gray-800">
          Complaint Details
        </Text>

        {/* MESSAGE BOX */}
        <TextInput
          style={{
            minHeight: 160,
            maxHeight: 240,
            backgroundColor: "#fff",
            borderRadius: 10,
            padding: 16,
            marginBottom: 14,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 6,
            elevation: 3,
          }}
          placeholder="Enter your message here..."
          multiline
          value={message}
          onChangeText={setMessage}
          textAlignVertical="top"
        />

        {/* ATTACH FILE */}
        <AttachmentPicker
          file={file}
          onPick={pickFile}
          onRemove={() => setFile(null)}
          label="Attach file (optional)"
        />

        {/* FOOTER */}
        <View
          style={{
            padding: 16,
            paddingBottom: 24,
            borderTopWidth: 1,
            borderTopColor: "#f1f5f9",
            backgroundColor: "#fff",
          }}
        ></View>
        <SubmitButton
          title="Submit Complaint"
          loading={loading}
          onPress={submitComplaint}
        />
      </ScrollView>

      {/* Attachment Bottom Sheet */}
      <AttachmentBottomSheet
        visible={isBottomSheetVisible}
        onClose={() => setBottomSheetVisible(false)}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </SafeAreaView>
  );
};

export default Complaints;
